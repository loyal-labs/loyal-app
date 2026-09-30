#!/usr/bin/env python3
"""Offline paired-store backup/restore; never connects to a service or starts it."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tarfile


def guard(root):
    if root.is_symlink():
        raise ValueError('symlink target')
    root = root.resolve()
    if root == Path('/'):
        raise ValueError('unsafe target')
    marker = root / '.disposable-clickstack'
    if not marker.is_file() or marker.read_text().strip() != 'isolated-no-notifications':
        raise ValueError('disposable target marker required')
    for p in root.rglob('*'):
        if p.is_symlink():
            target = p.resolve(strict=True)
            if Path(os.readlink(p)).is_absolute() or root not in target.parents:
                raise ValueError('escaping symlink in fixture')
    return root


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['backup', 'restore'])
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--clean-shutdown-evidence', type=Path)
    args = parser.parse_args()
    root = guard(args.root)
    bundle = args.bundle.resolve()
    if bundle == root or root in bundle.parents:
        raise ValueError('bundle must be outside store')
    if args.action == 'backup':
        if not args.clean_shutdown_evidence:
            raise ValueError('clean paired shutdown evidence required')
        evidence = json.loads(args.clean_shutdown_evidence.read_text())
        if evidence.get('root') != str(root) or evidence.get('clickhouse_clean') is not True or evidence.get('mongo_clean') is not True or evidence.get('writers_stopped') is not True:
            raise ValueError('invalid clean shutdown evidence')
        if not (root / 'metadata').is_dir() or not (root / '.clickstack/mongodb').is_dir():
            raise ValueError('both ClickHouse and MongoDB stores required')
        bundle.mkdir(mode=0o700)
        links = {}
        with tarfile.open(bundle / 'stores.tar', 'w') as archive:
            for item in root.rglob('*'):
                name = str(item.relative_to(root))
                if item.is_symlink():
                    links[name] = os.readlink(item)
                else:
                    archive.add(item, arcname=name, recursive=False)
        digest = hashlib.sha256((bundle / 'stores.tar').read_bytes()).hexdigest()
        (bundle / 'manifest.json').write_text(json.dumps({'sha256': digest, 'shutdown': evidence, 'internal_links': links}))
    else:
        if set(p.name for p in root.iterdir()) != {'.disposable-clickstack'}:
            raise ValueError('restore target must be empty except marker')
        manifest = json.loads((bundle / 'manifest.json').read_text())
        if hashlib.sha256((bundle / 'stores.tar').read_bytes()).hexdigest() != manifest['sha256']:
            raise ValueError('backup checksum mismatch')
        with tarfile.open(bundle / 'stores.tar') as archive:
            links = manifest.get('internal_links', {})
            for name, target in links.items():
                path = Path(name)
                if path.is_absolute() or '..' in path.parts or Path(target).is_absolute():
                    raise ValueError('unsafe link descriptor')
                if root not in (root / path.parent / target).resolve().parents:
                    raise ValueError('escaping link descriptor')
                if any(str(parent) in links for parent in path.parents):
                    raise ValueError('link parent descriptor')
            for member in archive.getmembers():
                path = Path(member.name)
                if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
                    raise ValueError('unsafe backup member')
                if str(path) in links or any(str(parent) in links for parent in path.parents):
                    raise ValueError('archive overlaps link descriptor')
            archive.extractall(root)
            for name, target in links.items():
                (root / name).symlink_to(target)
            guard(root)
    print(json.dumps({'scope': 'rehearsal', 'service_id': 'srv-d9c40evlk1mc73953cf0', 'collected_at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(), 'source_identity': None, 'target_identity': None, 'measurements': {'offline_paired_store_action': args.action, 'checksum_verified': True}, 'verdict': 'BLOCKED', 'limitations': ['offline copy only; application restore, history and fresh ingestion not verified']}))

if __name__ == '__main__':
    main()
