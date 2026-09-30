// Container-local supporting evidence; requires populated rows for every signal.
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const marker = `loyal-check-${randomBytes(12).toString('hex')}`;
const traceId = randomBytes(16).toString('hex');
const time = `${Date.now()}000000`;
const resource = { attributes: [{ key: 'service.name', value: { stringValue: marker } }] };
const query = sql => execFileSync('clickhouse-client', ['--query', sql], { encoding: 'utf8' }).trim();
async function main() {
  if (!process.env.INGESTION_API_KEY) throw Error('ingestion binding required');
  const payloads = {
    logs: { resourceLogs: [{ resource, scopeLogs: [{ logRecords: [{ timeUnixNano: time, body: { stringValue: marker } }] }] }] },
    metrics: { resourceMetrics: [{ resource, scopeMetrics: [{ metrics: [{ name: marker, sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: [{ timeUnixNano: time, asInt: '1' }] } }] }] }] },
    traces: { resourceSpans: [{ resource, scopeSpans: [{ spans: [{ traceId, spanId: randomBytes(8).toString('hex'), name: marker, kind: 1, startTimeUnixNano: time, endTimeUnixNano: `${BigInt(time) + 1000000n}` }] }] }] },
  };
  for (const [signal, body] of Object.entries(payloads)) {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 8080}/v1/${signal}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: process.env.INGESTION_API_KEY }, body: JSON.stringify(body) });
    if (!response.ok) throw Error(`${signal} rejected: ${response.status}`);
    const result = await response.json();
    const rejected = result.partialSuccess?.rejectedLogRecords || result.partialSuccess?.rejectedDataPoints || result.partialSuccess?.rejectedSpans;
    if (Number(rejected) > 0) throw Error(`${signal} partially rejected`);
  }
  const metricTables = query("SELECT table FROM system.columns WHERE database='default' AND name='MetricName' FORMAT TSVRaw").split('\n').filter(name => /^otel_metrics_[A-Za-z0-9_]+$/.test(name));
  if (!metricTables.length) throw Error('metric tables unavailable');
  let counts;
  for (let attempt = 0; attempt < 120; attempt++) {
    counts = {
      logs: Number(query(`SELECT count() FROM default.otel_logs WHERE Body='${marker}' FORMAT TSVRaw`)),
      traces: Number(query(`SELECT count() FROM default.otel_traces WHERE TraceId='${traceId}' FORMAT TSVRaw`)),
      metrics: metricTables.reduce((sum, table) => sum + Number(query(`SELECT count() FROM default.${table} WHERE MetricName='${marker}' FORMAT TSVRaw`)), 0),
    };
    if (Object.values(counts).every(count => count > 0)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const passed = Object.values(counts).every(count => count > 0);
  console.log(JSON.stringify({ scope: 'rehearsal', service_id: 'srv-d9c40evlk1mc73953cf0', collected_at: new Date().toISOString(), source_identity: null, target_identity: process.env.CLICKSTACK_DEPLOYMENT_IDENTITY || null, measurements: { marker, traceId, counts }, verdict: passed ? 'PASS' : 'FAIL', limitations: ['supporting ingestion result only; source/target digest and restore history require parent evidence'] }));
  if (!passed) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
