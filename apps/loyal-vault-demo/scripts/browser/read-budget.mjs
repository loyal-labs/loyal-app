/** Two real browser sessions against the dev app, with a read-only counting RPC relay. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const base = 'http://127.0.0.1:3038';
const session = `vault-budget-${process.pid}`;
const cli = (...args) => execFileSync('bunx', ['agent-browser', '--session', session, ...args], {encoding:'utf8', timeout:30000});
const allowed = new Set(['getGenesisHash','getMultipleAccounts','getProgramAccounts','getTokenAccountsByOwner']);
const counts = {total:0, vault:0, kamino:0, tokens:0, batches:0, rejected:0};
const snapshot = () => ({...counts});
const relay = createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'POST');
    let raw = ''; for await (const chunk of req) { raw += chunk; assert(raw.length < 100000); }
    const body = JSON.parse(raw);
    if (!allowed.has(body.method) || counts.total >= 60) { counts.rejected++; res.writeHead(403).end(); return; }
    counts.total++;
    if (body.method === 'getMultipleAccounts') {
      counts.batches++;
      if (body.params[0].includes('HXtk15EA5pBg3rSKxBm8sWPExScPkTknSRp37fXNHgNA')) counts.vault++;
    }
    if (body.method === 'getProgramAccounts') counts.kamino++;
    if (body.method === 'getTokenAccountsByOwner') counts.tokens++;
    const upstream = await fetch('https://api.mainnet-beta.solana.com', {method:'POST',headers:{'content-type':'application/json'},body:raw,signal:AbortSignal.timeout(10000)});
    res.writeHead(upstream.status, {'content-type':'application/json'}).end(await upstream.text());
  } catch { res.writeHead(502).end('{}'); }
});
let child, browser;
try {
  await new Promise(resolve => relay.listen(0,'127.0.0.1',resolve));
  const env = {...process.env, NEXT_TELEMETRY_DISABLED:'1', LOYAL_VAULT_DEMO_RPC_URL:`http://127.0.0.1:${relay.address().port}`};
  delete env.LOYAL_VAULT_DEMO_OBSERVATION_DATABASE_URL;
  child = spawn('node',['--input-type=module','-e',`
    import next from 'next';
    import { createServer } from 'node:http';
    const app=next({dev:true,hostname:'127.0.0.1',port:3038,conf:{distDir:'.next-read-budget'}});
    await app.prepare();
    createServer(app.getRequestHandler()).listen(3038,'127.0.0.1');
  `],{env,stdio:'ignore'});
  let ready = false;
  for (let n=0;n<60;n++) {
    if (child.exitCode !== null) throw new Error('Owned dev server exited');
    try { if ((await fetch(base,{signal:AbortSignal.timeout(1000)})).ok) {ready=true;break;} } catch {}
    await new Promise(resolve => setTimeout(resolve,500));
  }
  assert(ready,'Dev server readiness deadline exceeded');
  cli('open','about:blank');
  const cdp=cli('get','cdp-url').trim(); assert.equal(new URL(cdp).hostname,'127.0.0.1');
  browser=await chromium.connectOverCDP(cdp);
  const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
  for (const context of contexts) {
    // Controlled concurrent visible viewers; native OS visibility is a separate claim.
    await context.addInitScript(() => Object.defineProperty(document,'hidden',{configurable:true,get:()=>false}));
    await context.route('**/*',route => {
      const req=route.request(), url=new URL(req.url());
      return url.origin===base && !url.pathname.startsWith('/api/transactions/') && req.method()==='GET' ? route.continue() : route.abort();
    });
  }
  const pages=await Promise.all(contexts.map(context=>context.newPage()));
  const browserReads=[0,0];
  pages.forEach((page,index)=>page.on('request',request=>{if(new URL(request.url()).pathname==='/api/vault') browserReads[index]++;}));
  await Promise.all(pages.map(page=>page.goto(base,{waitUntil:'domcontentloaded',timeout:60000})));
  // Wait for real successful reads before measuring cache reuse; do not count an error as cached data.
  const paths=['/api/vault','/api/kamino','/api/holdings'];
  const reads=await Promise.all(pages.map(page=>page.evaluate(async paths=>Promise.all(paths.map(async path=>{
    const response=await fetch(path); return {path,status:response.status,data:await response.json()};
  })),paths)));
  for (const viewer of reads) for (const read of viewer) assert.equal(read.status,200,`${read.path} must return a real observation`);
  const before=snapshot();
  const repeats=await Promise.all(pages.map(page=>page.evaluate(async()=>{const response=await fetch('/api/vault');return {status:response.status,data:await response.json()};})));
  assert(repeats.every(read=>read.status===200));
  assert.deepEqual(repeats[0].data,repeats[1].data,'Both sessions must receive the same shared vault observation');
  assert.equal(counts.vault,before.vault,'Immediate two-viewer reads must not repeat upstream vault RPC');
  const windowStart=snapshot();
  const browserStart=[...browserReads];
  await new Promise(resolve=>setTimeout(resolve,11000));
  const delta=Object.fromEntries(Object.keys(counts).map(key=>[key,counts[key]-windowStart[key]]));
  assert(browserReads.every((count,index)=>count-browserStart[index]>=2),'Both sessions must actually poll during the window');
  assert(delta.vault>=1,'Window must include a fresh upstream vault read');
  assert(delta.vault<=3,`5s vault TTL exceeded budget: ${delta.vault}`);
  assert(delta.kamino<=1,`15s owner scan TTL exceeded budget: ${delta.kamino}`);
  assert(delta.tokens<=4,`15s token discovery with at most two attempts exceeded budget: ${delta.tokens}`);
  assert(delta.total<=15,`11s combined RPC budget exceeded: ${delta.total}`);
  assert.equal(counts.rejected,0,'Unexpected RPC method or global budget overflow');
  console.log(JSON.stringify({passed:true,scope:'local-dev two isolated browser sessions; disconnected wallets; forced-visible documents',windowMs:11000,upstream:'Solana public mainnet read-only',sameVaultObservation:true,immediateVaultRpcDelta:counts.vault-before.vault-delta.vault,windowRpc:delta,browserVaultReads:browserReads.map((count,index)=>count-browserStart[index]),totalRpc:snapshot(),networkSubmissions:0}));
  await Promise.all(contexts.map(context=>context.close()));
} finally {
  if(browser) await browser.close();
  try{cli('close');}catch{}
  if(child && child.exitCode===null) child.kill('SIGTERM');
  relay.closeAllConnections(); await new Promise(resolve=>relay.close(resolve));
}
