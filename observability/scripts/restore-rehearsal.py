#!/usr/bin/env python3
"""Run ONLY on the parent-authorized disposable Docker host; synthetic data only."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import uuid

BASE = Path('/opt/loyal-rehearsal')
SCRIPTS = Path(__file__).resolve().parent
RUN = BASE / ('lane-e-' + uuid.uuid4().hex[:12])
NAME = RUN.name
IMAGE = 'lane-e-clickstack:rehearsal'
INGEST = 'synthetic-ingestion-' + NAME
EMAIL = NAME + '@example.invalid'
PASSWORD = 'Synthetic-password-2026!'
RESUME = len(sys.argv) == 3 and sys.argv[1] in ('--resume', '--finish')
if RESUME:
    candidate = Path(sys.argv[2]).resolve()
    if candidate.parent != BASE or not candidate.name.startswith('lane-e-'):
        raise ValueError('invalid disposable resume path')
    RUN, NAME = candidate, candidate.name
    INGEST = 'synthetic-ingestion-' + NAME
    EMAIL = NAME + '@example.invalid'


def command(*args):
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT).strip()
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(str(exc) + '\n' + exc.output) from exc


def dex(*args):
    return command('docker', 'exec', NAME, *args)


def record(name, value):
    (RUN / (name + '.json')).write_text(json.dumps(value, indent=2) + '\n')
    print(json.dumps({'stage': name, 'measurement': value}), flush=True)


def node(js):
    return dex('node', '-e', js)


def api(path, method='GET', body=None, login=False):
    js = '''(async()=>{let cookie='';
    const r=await fetch('http://127.0.0.1:8080/api/login/password',{method:'POST',redirect:'manual',headers:{'X-Forwarded-Proto':'https','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(%s)});
    if(r.status!==303 || !r.headers.get('location')?.endsWith('/')) throw Error('login failed '+r.status+' '+r.headers.get('location'));
    cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
    const a=await fetch('http://127.0.0.1:8080/api%s',{method:%s,redirect:'manual',headers:{Cookie:cookie,'Content-Type':'application/json'},body:%s});
    const text=await a.text(); if(!a.ok)throw Error(a.status+' '+text);console.log(text);})().catch(e=>{console.error(e);process.exit(1)})''' % (json.dumps({'email': EMAIL, 'password': PASSWORD}), path, json.dumps(method), 'undefined' if body is None else json.dumps(json.dumps(body)))
    return json.loads(node(js))


def start(root):
    command('docker', 'run', '-d', '--name', NAME, '--network', NAME,
            '--memory', '6g', '--stop-timeout', '120',
            '-v', str(root) + ':/var/lib/clickhouse',
            '-e', 'EXPRESS_SESSION_SECRET=synthetic-session-' + NAME,
            '-e', 'INGESTION_API_KEY=' + INGEST, '-e', 'USAGE_STATS_ENABLED=false',
            '-e', 'CLICKSTACK_HOSTED=true', '-e', 'FRONTEND_URL=https://observability.example.invalid',
            '-e', 'NEXT_TELEMETRY_DISABLED=1', IMAGE)
    # No ports published. Internal Docker network prevents notification/usage egress.
    for _ in range(180):
        try:
            dex('curl', '-fsS', 'http://127.0.0.1:8080/api/health')
            dex('sh', '-c', "sed -i 's|<level>fatal</level>|<level>information</level>|' /etc/clickhouse-server/config.xml")
            dex('clickhouse-client', '--query', 'SYSTEM RELOAD CONFIG')
            return
        except RuntimeError:
            time.sleep(1)
    raise RuntimeError('application startup timeout')


def ingest(stage):
    for _ in range(120):
        try:
            dex('test', '-f', '/tmp/loyal-clickstack-collector-auth-ready')
            break
        except RuntimeError:
            time.sleep(1)
    else:
        raise RuntimeError('authenticated collector readiness timeout')
    raw = dex('node', '/usr/local/lib/loyal-clickstack-ingestion-check.cjs')
    value = json.loads(raw.splitlines()[-1])
    if value['verdict'] != 'PASS':
        raise RuntimeError(raw)
    record(stage, value)
    return value['measurements']


def history(marker):
    result = {}
    for table, predicate in [('otel_logs', "Body='%s'" % marker['marker']), ('otel_traces', "TraceId='%s'" % marker['traceId']), ('otel_metrics_sum', "MetricName='%s'" % marker['marker'])]:
        rows = dex('clickhouse-client', '--query', 'SELECT * FROM default.' + table + ' WHERE ' + predicate + ' FORMAT JSONEachRow')
        parsed = [json.loads(x) for x in rows.splitlines() if x]
        canonical = json.dumps(parsed, sort_keys=True)
        result[table] = {'count': len(parsed), 'sample': parsed[:1], 'sha256': hashlib.sha256(canonical.encode()).hexdigest()}
        if not parsed:
            raise RuntimeError('empty history ' + table)
    return result


def mongo():
    js = '''(async()=>{const {MongoClient}=require('/app/node_modules/mongodb');const c=new MongoClient('mongodb://127.0.0.1:27017');await c.connect();const d=c.db('hyperdx');let out={};for(const {name} of await d.listCollections().toArray()){out[name]=await d.collection(name).countDocuments();}if((out.alerts||0)||(out.webhooks||0))throw Error('notification definitions present');console.log(JSON.stringify(out));await c.close()})().catch(e=>{console.error(e);process.exit(1)})'''
    return json.loads(node(js))


def execute_saved(searches):
    search = next(x for x in searches if x['name'] == NAME)
    sql = 'SELECT ' + search['select'] + ' FROM default.otel_logs WHERE ' + search['where'] + ' ORDER BY ' + search['orderBy'] + ' FORMAT JSONEachRow'
    rows = [json.loads(x) for x in dex('clickhouse-client', '--query', sql).splitlines() if x]
    if not rows:
        raise RuntimeError('saved search returned no history')
    return {'saved_search_id': search['id'], 'query': sql, 'count': len(rows), 'rows': rows}


def stop(stage, root):
    # Group SIGTERM closes synthetic writers and both stores; PID 1 waits for flush.
    db = json.loads(dex('node', '/usr/local/lib/loyal-clickstack-database-processes.cjs'))
    if sorted(p['kind'] for p in db) != ['clickhouse', 'mongo']:
        raise RuntimeError('expected exactly one process per database: ' + str(db))
    # tini forwards SIGTERM to the whole process group. Inspect logs after exit.
    began = time.monotonic()
    command('docker', 'stop', '-t', '120', NAME)
    state = json.loads(command('docker', 'inspect', NAME))[0]['State']
    command('docker', 'cp', NAME + ':/var/log/mongod.log', str(RUN / (stage + '-mongo.log')))
    command('docker', 'cp', NAME + ':/var/log/clickhouse-server/clickhouse-server.log', str(RUN / (stage + '-clickhouse.log')))
    m = (RUN / (stage + '-mongo.log')).read_text()
    ch = (RUN / (stage + '-clickhouse.log')).read_text()
    # ClickHouse fatal-only logging may omit shutdown success. Require process-specific
    # exit evidence rather than assuming a clean stop from container exit status.
    evidence = {'root': str(root), 'elapsed_seconds': time.monotonic() - began, 'state': state, 'database_processes_before': db,
                'mongo_clean': 'shutting down with code:0' in m,
                'clickhouse_clean': 'Application: Background threads finished' in ch and 'BaseDaemon: Stop SignalListener thread' in ch, 'writers_stopped': state['Running'] is False and state['ExitCode'] == 0 and not state['OOMKilled']}
    record(stage, evidence)
    if not all(evidence[k] for k in ('mongo_clean', 'clickhouse_clean', 'writers_stopped')):
        raise RuntimeError('clean paired shutdown unproven; logs retained')
    return evidence


def main():
    if not BASE.is_dir() or command('uname', '-m') != 'x86_64':
        raise RuntimeError('disposable Linux host required')
    if RESUME:
        if sys.argv[1] == '--finish':
            finish()
            return
        resume()
        return
    RUN.mkdir(mode=0o700)
    source, target = RUN / 'source', RUN / 'restored'
    for root in (source, target):
        root.mkdir()
        (root / '.disposable-clickstack').write_text('isolated-no-notifications')
    paths = ['Dockerfile', 'nginx.conf', '.dockerignore', 'scripts/entrypoint.sh', 'scripts/smoke-live.sh', 'scripts/ingestion-check.cjs', 'scripts/database-processes.cjs', 'scripts/recovery.py', 'scripts/restore-rehearsal.py', 'scripts/check-recovery.py', 'scripts/check-database-processes.cjs']
    files = {name: hashlib.sha256((SCRIPTS.parent / name).read_bytes()).hexdigest() for name in paths}
    record('provenance', {'source_files': files, 'image': json.loads(command('docker', 'image', 'inspect', IMAGE))[0], 'scope': 'synthetic mechanism only; not production image or history provenance'})
    command('docker', 'network', 'create', '--internal', NAME)
    start(source)
    raw = node('''(async()=>{const r=await fetch('http://127.0.0.1:8080/api/register/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(%s)});console.log(r.status+' '+await r.text());if(r.status!==200)process.exit(1)})()''' % json.dumps({'email': EMAIL, 'password': PASSWORD, 'confirmPassword': PASSWORD}))
    record('registration', raw)
    sources = api('/sources')
    record('sources', sources)
    source_list = sources if isinstance(sources, list) else sources['data']
    logs = next(x for x in source_list if x['kind'] == 'log')
    saved = api('/saved-search', 'POST', {'name': NAME, 'select': 'Timestamp,ServiceName,Body', 'where': "Body LIKE 'loyal-check-%'", 'whereLanguage': 'sql', 'source': logs.get('id', logs.get('_id')), 'orderBy': 'Timestamp DESC', 'tags': []})
    record('saved-search', saved)
    marker = ingest('initial-ingestion')
    baseline = history(marker)
    record('history-before', baseline)
    record('mongo-before', mongo())
    searches = api('/saved-search')
    record('searches-before', searches)
    evidence = stop('capture-shutdown', source)
    evidence_path = RUN / 'capture-shutdown.json'
    restore_and_validate(source, target, marker, baseline, searches)


def resume():
    source, target = RUN / 'source', RUN / 'restored'
    evidence = json.loads((RUN / 'capture-shutdown.json').read_text())
    m = (RUN / 'capture-shutdown-mongo.log').read_text()
    ch = (RUN / 'capture-shutdown-clickhouse.log').read_text()
    state = json.loads(command('docker', 'inspect', NAME))[0]['State']
    evidence.update(mongo_clean='shutting down with code:0' in m,
                    clickhouse_clean='Application: Background threads finished' in ch and 'BaseDaemon: Stop SignalListener thread' in ch,
                    writers_stopped=state['Running'] is False and state['ExitCode'] == 0 and not state['OOMKilled'])
    if not all(evidence[k] for k in ('mongo_clean', 'clickhouse_clean', 'writers_stopped')):
        raise RuntimeError('resume clean stop evidence failed')
    record('capture-shutdown', evidence)
    record('resume-harness-sha256', hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    marker = json.loads((RUN / 'initial-ingestion.json').read_text())['measurements']
    restore_and_validate(source, target, marker, json.loads((RUN / 'history-before.json').read_text()), json.loads((RUN / 'searches-before.json').read_text()))


def restore_and_validate(source, target, marker, baseline, searches):
    evidence_path = RUN / 'capture-shutdown.json'
    command(sys.executable, str(SCRIPTS / 'recovery.py'), 'backup', '--root', str(source), '--bundle', str(RUN / 'bundle'), '--clean-shutdown-evidence', str(evidence_path))
    command(sys.executable, str(SCRIPTS / 'recovery.py'), 'restore', '--root', str(target), '--bundle', str(RUN / 'bundle'))
    command('docker', 'rm', NAME)
    start(target)
    for stage in ('restored', 'recreated'):
        actual = history(marker)
        if actual != baseline or api('/saved-search') != searches:
            raise RuntimeError('history or saved search mismatch')
        record(stage + '-history', actual)
        record(stage + '-mongo', mongo())
        record(stage + '-authenticated-searches', api('/saved-search'))
        record(stage + '-executed-search', execute_saved(searches))
        ingest(stage + '-fresh-ingestion')
        stop(stage + '-shutdown', target)
        if stage == 'restored':
            command('docker', 'rm', NAME)
            start(target)
    record('result', {'verdict': 'PASS', 'scope': 'synthetic paired physical restore mechanism', 'bundle_sha256': hashlib.sha256((RUN / 'bundle/stores.tar').read_bytes()).hexdigest(), 'limitations': ['not V6 production history completeness', 'saved query executed via ClickHouse client; no browser/TLS proof']})


def finish():
    # Complete only previously missing saved-query and fresh-history checks.
    command('docker', 'start', NAME)
    for _ in range(120):
        try:
            dex('curl', '-fsS', 'http://127.0.0.1:8080/api/health')
            break
        except RuntimeError:
            time.sleep(1)
    searches = api('/saved-search')
    record('final-executed-search', execute_saved(searches))
    for stage in ('initial-ingestion', 'restored-fresh-ingestion', 'recreated-fresh-ingestion'):
        marker = json.loads((RUN / (stage + '.json')).read_text())['measurements']
        record('final-persisted-' + stage, history(marker))
    record('final-mongo', mongo())
    stop('final-shutdown', RUN / 'restored')
    record('final-harness-sha256', hashlib.sha256(Path(__file__).read_bytes()).hexdigest())

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        if RUN.is_dir():
            record('result', {'verdict': 'BLOCKED', 'error': str(exc)})
        raise
