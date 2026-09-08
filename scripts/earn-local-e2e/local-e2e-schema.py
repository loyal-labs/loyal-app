#!/usr/bin/env python3
"""Bootstrap isolated E2E schema; never pretend the production-row conversion ran."""
import os
from pathlib import Path
import subprocess
from urllib.parse import urlparse

root = Path(os.environ["LOYAL_YIELD_ROUTING_ROOT"]).resolve()
url = os.environ["NEON_DATABASE_URL"]
parsed = urlparse(url)
if (
    parsed.scheme not in {"postgres", "postgresql"}
    or parsed.hostname != "127.0.0.1"
    or parsed.password
    or parsed.query
    or parsed.fragment
    or parsed.path not in {
        "/ask_2168_autoswap_client_local_e2e",
        "/ask_2211_autodeposit_client_local_e2e",
        "/ask_2212_client_earn_local_e2e",
    }
):
    raise SystemExit("Refusing non-isolated E2E database")
command = ["cargo", "run", "--quiet", "-p", "loyal-yield-orchestrator", "--bin", "yield-migrations", "--", "--apply"]
result = subprocess.run(command, cwd=root, text=True, capture_output=True)
print(result.stdout, end="")
print(result.stderr, end="")
if result.returncode == 0:
    raise SystemExit(0)
if os.environ.get("LOCAL_E2E_SCHEMA_FIXTURE") != "1" or "Backyard Phase 1 canonical route cardinality drifted" not in result.stderr:
    raise SystemExit(result.returncode)

psql = ["psql", "-X", "-v", "ON_ERROR_STOP=1", url]
empty = subprocess.check_output(psql + ["-Atc", "SELECT count(*) FROM loyal_yield.multiply_route_states"], text=True).strip()
if empty != "0":
    raise SystemExit("Refusing fixture accommodation on a populated route database")
migrations = root / "crates/loyal-yield-store/migrations"
phase1 = (migrations / "0071_backyard_rwa_phase1_activation.sql").read_text()
marker = "\nDO $$\nDECLARE\n    canonical_route_key"
if phase1.count(marker) != 1:
    raise SystemExit("Migration 71 layout changed; review before using fixture")
subprocess.run(psql, input=phase1.split(marker)[0], text=True, check=True)
for name in ["0072_backyard_rwa_phase2_route_neutral_actions.sql", "0073_backyard_rwa_expired_absent_failure.sql"]:
    subprocess.run(psql + ["-f", str(migrations / name)], check=True)
print("FIXTURE ONLY: schema 71-73 applied without migration 71 production-row conversion; no migration-ledger entries forged. This is NOT migration validation.")
