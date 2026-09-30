# Paired ClickStack recovery rehearsal

V6 is BLOCKED until an actual application restore passes. No commands here grant
production operation permission. Use an isolated host, no notification credentials
or outbound webhook route, private database ports, and the exact rebuilt source
image digest. Disable all cloned alert schedules before enabling any egress.

## Consistent capture and disposable restore

1. Parent authorizes a bounded writer pause. Block OTLP admission and UI/config
   mutation; drain accepted telemetry and exporter buffers. Stop HyperDX and its
   alert scheduler. Record last accepted marker, counts/time bounds per retained
   CH table and Mongo collection, source digest/config identity and capture time.
2. Gracefully stop the paired ClickHouse and MongoDB processes; verify clean exit
   in both logs and no remaining writers. Forced termination, timeout or unknown
   producer state invalidates capture. Preserve all ClickHouse metadata/data,
   access configuration and the MongoDB dbpath/journal under
   `/var/lib/clickhouse/.clickstack/mongodb`. The paired offline copy is one
   recovery boundary, not two snapshots taken while writes continue.
3. `scripts/recovery.py` automates **isolated fixtures only**, rejecting missing
   disposable markers, nonempty restore roots, escaping links and unsafe archive members.
   Actual ClickHouse Atomic databases use relative links from `data`/`metadata`
   to `store`. Capture separates contained relative link descriptors from the
   regular-file archive; restore validates paths and overlap before extraction,
   creates links last, and rechecks resolved containment. Absolute/escaping links,
   link parents, archive links/hardlinks and writes through links are rejected.
   Create `.disposable-clickstack` containing `isolated-no-notifications` in each
   fixture root. Provide clean-shutdown evidence JSON with `root` (absolute path),
   `clickhouse_clean`, `mongo_clean`, `writers_stopped` all true. Run
   `python3 observability/scripts/recovery.py backup --root FIXTURE --bundle BUNDLE
   --clean-shutdown-evidence EVIDENCE`, then `restore --root EMPTY_FIXTURE
   --bundle BUNDLE`. Evidence is an operator input, not automatically proven by
   this offline tool. Never label a production mount disposable.
4. Restore into a fresh isolated volume with matching database engine versions,
   image digest, uid/permissions and server-side binding references. Start only
   through parent-owned guarded release tooling. Physical copy is supporting
   evidence only: query representative historical rows across each retained CH
   table and compare count/time bounds and restricted sample hashes. Validate
   Mongo collections, users/teams, sources, saved searches and alert definitions.
   Authenticate as an existing test user and execute an existing saved search.
5. Run fresh populated logs, metrics and traces ingestion and query all three in
   CH. Compare against the new unique canary, not an old disk marker or empty
   HTTP-success payload. Capture latency and resource measurements. Recreate the
   container against the restored volume and repeat authentication/history checks.
   Re-enable schedules only after proving one relay. Snapshot failures retain
   availability with warnings and restart grace; lost dedup history or an accepted
   send before snapshot persistence can produce duplicates.
6. Parent records raw measurements using the shared collector envelope. Retain
   encrypted backups off-host with restricted access, checksum, retention and a
   measured restore window. No automatic deletion or retention job is added.

MongoDB requires a consistent capture boundary; see its
[filesystem snapshot guidance](https://www.mongodb.com/docs/v8.0/tutorial/backup-with-filesystem-snapshots/).
For a future logical capture, keep the same writer pause and use MongoDB
`mongodump` plus ClickHouse native `BACKUP`; neither tool alone coordinates the
application's two stores. No live export has been run by this lane.

## Host bindings requested from parent

ClickStack: `CLICKSTACK_HOSTED=true`, canonical HTTPS `FRONTEND_URL`, internal
8080 behind authenticated HTTPS gateway; persistent `/var/lib/clickhouse` with
Mongo subdirectory included. Relay: `STATE_FILE` on a separate private durable
volume, singleton active sender, private port 10000, 30-second minimum drain.
Keep existing Render observability operational until gates pass. External host-
loss alerts must use an independent observer; a relay on the failed host cannot
prove alert availability. Image digests, backup destination, exact bindings,
resource bounds and restore authorization remain parent inputs.

## Actual disposable Docker rehearsal (2026-09-29)

The bounded synthetic paired-store mechanism passed on parent-authorized Ubuntu
24 x86 host `168022173` (`5.161.121.229`), Docker 29.1.3. No ports were published;
an internal Docker network blocked notification/usage egress. There were no
webhook or alert definitions. Hosted mode used the synthetic origin
`https://observability.example.invalid`; HTTP client probes supplied the trusted
forwarding header. This is no browser, actual TLS, production digest, complete
V6 history, relay singleton, or memory-client proof.

Exact host commands, from the uploaded observability source root:

```sh
cd /opt/loyal-rehearsal/clickstack
docker build -t lane-e-clickstack:rehearsal .
python3 scripts/restore-rehearsal.py
# Continue the already stopped fixture after version-specific log matcher correction:
python3 scripts/restore-rehearsal.py --resume /opt/loyal-rehearsal/lane-e-1439bf7a0d7a
# Complete the missing stored-query and post-restore-canary persistence checks:
python3 scripts/restore-rehearsal.py --finish /opt/loyal-rehearsal/lane-e-1439bf7a0d7a
```

The first real build found unavailable Alpine `nginx=1.30.4-r0`; the diagnosed
available exact revision is `1.30.4-r1`. The Docker legacy builder lacked
`COPY --chmod`, so equivalent `COPY` plus `RUN chmod` is used. Public base remains
`docker.io/clickhouse/clickstack-all-in-one:2.31.0@sha256:b01cc48cb5aaf30d630865a88217c826ab86fb9828374201f6cd7c539d5beed1`.
Final local image ID is
`sha256:08c36eeafefc5a7492f7029bdcb83744a6fbad3a0ca94adefca0c77c31c30a1d`.
It binds only the rehearsal source content, not deployed-production provenance.

The original tini group stop exited 143 in 0.205s before database flush finished.
The entrypoint now holds the container alive for up to 110s while both database
processes exit; the harness requires a 120s Docker stop allowance. Parent must
use that allowance for this image. Rehearsal alone raises ClickHouse logging to
information to obtain clean-shutdown evidence. Verdicts require actual Mongo
`shutting down with code:0`, ClickHouse background-thread completion and signal
listener stop, container exit 0, no OOM, and no running container. An authored
operator flag or container liveness is insufficient.

Successful capture/restore/recreation stops took 0.447s / 0.438s / 0.968s.
Each original signal had one populated row; row/sample hashes matched after
restore and recreation. Both starts authenticated the existing user and returned
the same saved search. Each start produced a fresh log/metric/trace, one each;
the final check confirmed all three generations persisted and executed the saved
search SQL against the restored ClickHouse store. Mongo retained one user/team,
four sources, one connection and one saved search; sessions increased with real
logins, while alerts/webhooks remained zero.

Paired backup SHA256:
`c1ddebbd7362c9e8ab2739c3dd9979a5770bbbb4f1effff53065a06c27c80a5b`.
Raw JSON, shutdown logs, samples, source-content hashes, image inspection and the
synthetic physical backup are retained in
`scripts/rehearsal-evidence/host-artifacts.tar.gz`; the archive is a local
rehearsal artifact, not a production backup. All lane E fixture containers ended
stopped. Parent owns disposable-host cleanup after evidence retention.

## Memory client/history ownership collector prerequisites

Guest access is unresolved. Before retirement, obtain authorized read-only guest
access, deployed memory image/source identity, disk/mount layout and backup
inventory for both Render and Hetzner. Enumerate every client owner/device,
Codex/Moraine configuration endpoint and last successful read/write time; one
local redirected client is insufficient. Inventory every required history's
project/tenant/session ranges and count/time bounds on both stores, retention
policy and restricted sample hashes. Identify ingest producers, spool/retry
buffers, credentials by reference, old endpoint DNS/routes and observed writes
through a justified inactivity window. Restore required history to a disposable
memory instance, query representative sessions through each actual client, and
record owner approval for intentional omissions. Parent supplies the memory
repo at live `36592c3b`, guest collector authority, all-client roster and history
retention contract. No completeness or retirement claim is made here.

### Superseding process-identity fix and fresh single-run evidence

Parent review found the shutdown waiter missed absolute argv0 and ClickHouse
multicall forms. `scripts/database-processes.cjs` now parses NUL-separated argv,
uses basename(argv0), recognizes `mongod`, `clickhouse-server` and `clickhouse
server`, and is shared by the shutdown waiter and before-stop observer. The
110s wait and target 120s stop allowance are unchanged. Existing Render source
60s allowance has not been changed. Twelve focused absolute/basename/multicall
and negative cases passed inside the rebuilt image:

```sh
cd /opt/loyal-rehearsal/clickstack
docker build -t lane-e-clickstack:rehearsal .
docker run --rm --network none --entrypoint node \
  -v /opt/loyal-rehearsal/clickstack/scripts:/lane-e-scripts:ro \
  lane-e-clickstack:rehearsal /lane-e-scripts/check-database-processes.cjs
python3 scripts/restore-rehearsal.py > /opt/loyal-rehearsal/lane-e-final-runtime.log 2>&1
```

Fresh run `lane-e-7cb4e022760f` passed in one invocation with no harness mutation,
resume, or finish phase. Capture/restored/recreated clean stops took
1.197s / 1.331s / 0.846s, exit 0 and no OOM. Observed argv/PIDs/kinds are retained
for each stop. Saved search executed with one row after restore and two after
recreation, including the persisted post-restore marker. Original signal samples
and hashes matched; all three ingestion generations had one log/metric/trace.
Alerts/webhooks stayed zero. No ports were published.

New image ID (supersedes the earlier image for the fixed source):
`sha256:eb5715531fbe005630edae8eadc03b2148fa6e4fe0e19ec1a77fb8f84e37e598`.
Exact tested harness SHA256:
`18aff4b7ef9bff88ca702efbfaebe2e8e786151f4fa38e17d3a0f90d30143137`.
Paired physical tar SHA256:
`35fb62c342575961c80d98413624258400a0a3448332943ac5e6aed2e0a0ca13`.
Full raw artifact archive SHA256 (includes original manifest/link descriptors):
`81b5dc6c7c0e1d0017ea77e8db9e3df9eb5ee1c59a347470655d666455d5b865`.

`scripts/rehearsal-evidence/SUMMARY.json` now identifies only this fresh run.
`final-host-artifacts.tar.gz` retains physical backup, manifest, logs and raw
measurements. `final-tested-host-source.tar.gz` retains exactly the eleven reviewed
host files in the observed source identity; every hash matches the local reviewed
source. Documentation/evidence files are subsequent reporting artifacts, not
runtime image inputs. No production digest provenance is claimed.

`PROVENANCE.md` explains and retains the three older harness phases and incidental
AppleDouble metadata without rewriting their observed identities. The physical
tar checksum does not authenticate the mutable manifest. Parent must retain and
verify the outer archive checksum, which covers both manifest and tar. This is
an integrity reference, not a signature. Offline copy alone remains BLOCKED;
contained-link path security checks remain mandatory and independently tested.
