#!/usr/bin/env python3
"""Synthetic offline guard checks; no service or production data access."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile

scripts = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('recovery', scripts / 'recovery.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)
with tempfile.TemporaryDirectory() as directory:
    base = Path(directory).resolve()
    source, target = base / 'source', base / 'target'
    source.mkdir()
    target.mkdir()
    try:
        recovery.guard(source)
    except ValueError:
        pass
    else:
        raise AssertionError('unmarked fixture accepted')
    for root in (source, target):
        (root / '.disposable-clickstack').write_text('isolated-no-notifications')
    (source / 'link').symlink_to('/tmp')
    try:
        recovery.guard(source)
    except ValueError:
        pass
    else:
        raise AssertionError('linked fixture accepted')
    (source / 'link').unlink()
    (source / 'metadata').mkdir()
    (source / '.clickstack/mongodb').mkdir(parents=True)
    (source / 'metadata/fixture.sql').write_text('synthetic')
    (source / 'data').mkdir()
    (source / 'data/fixture.sql').symlink_to('../metadata/fixture.sql')
    (source / '.clickstack/mongodb/fixture').write_text('synthetic')
    evidence = base / 'evidence.json'
    evidence.write_text(json.dumps({'root': str(source), 'clickhouse_clean': True, 'mongo_clean': True, 'writers_stopped': True}))
    command = ['python3', str(scripts / 'recovery.py')]
    subprocess.run(command + ['backup', '--root', str(source), '--bundle', str(base / 'bundle'), '--clean-shutdown-evidence', str(evidence)], check=True)
    restore = command + ['restore', '--root', str(target), '--bundle', str(base / 'bundle')]
    subprocess.run(restore, check=True)
    assert (target / 'metadata/fixture.sql').read_text() == 'synthetic'
    assert (target / 'data/fixture.sql').is_symlink()
    assert (target / 'data/fixture.sql').read_text() == 'synthetic'
    assert subprocess.run(restore, capture_output=True).returncode != 0
    manifest_path = base / 'bundle/manifest.json'
    manifest = json.loads(manifest_path.read_text())
    for links in ({'escape': '../../outside'}, {'data': 'metadata', 'data/child': '../metadata/fixture.sql'}):
        blocked = base / ('blocked-' + str(len(list(base.iterdir()))))
        blocked.mkdir()
        (blocked / '.disposable-clickstack').write_text('isolated-no-notifications')
        manifest_path.write_text(json.dumps({**manifest, 'internal_links': links}))
        assert subprocess.run(command + ['restore', '--root', str(blocked), '--bundle', str(base / 'bundle')], capture_output=True).returncode != 0
        assert len(list(blocked.iterdir())) == 1
    manifest_path.write_text(json.dumps(manifest))
    # Checksum corruption must reject before touching a second empty target.
    (target / 'metadata/fixture.sql').unlink()
    damaged = base / 'damaged'
    damaged.mkdir()
    (damaged / '.disposable-clickstack').write_text('isolated-no-notifications')
    with (base / 'bundle/stores.tar').open('ab') as file:
        file.write(b'corruption')
    assert subprocess.run(command + ['restore', '--root', str(damaged), '--bundle', str(base / 'bundle')], capture_output=True).returncode != 0
    assert len(list(damaged.iterdir())) == 1
print('PASS recovery marker/link/nonempty/checksum guards and synthetic paired round-trip')
source = (scripts / 'entrypoint.sh').read_text()
start = source.index('configure_frontend_url()')
end = source.index('\nconfigure_frontend_url\n', start)
script = 'set -eu\nPORT=8080\n' + source[start:end] + '\nconfigure_frontend_url\n'
for values, status in [({'CLICKSTACK_HOSTED': 'true', 'FRONTEND_URL': 'https://observe.example.test/'}, 0), ({'CLICKSTACK_HOSTED': 'true'}, 66), ({'CLICKSTACK_HOSTED': 'true', 'FRONTEND_URL': 'http://localhost:8080'}, 66), ({'FRONTEND_URL': 'https://observe.example.test/path'}, 66), ({'RENDER': 'true', 'RENDER_EXTERNAL_URL': 'https://render.example.test'}, 0)]:
    result = subprocess.run(['sh', '-c', script], env={'PATH': os.environ['PATH'], **values}, capture_output=True)
    assert result.returncode == status, result.stderr
print('PASS 5 hosted origin acceptance/rejection cases')
