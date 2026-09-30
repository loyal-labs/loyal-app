// Identify durable-store processes by parsed argv, including absolute/multicall forms.
const fs = require('fs');
const path = require('path');
function databaseKind(argv) {
  const executable = path.basename(argv[0] || '');
  if (executable === 'mongod') return 'mongo';
  if (executable === 'clickhouse-server' || (executable === 'clickhouse' && argv[1] === 'server')) return 'clickhouse';
  return null;
}
function processes() {
  return fs.readdirSync('/proc').filter(x => /^\d+$/.test(x)).flatMap(pid => {
    try {
      const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
      const kind = databaseKind(argv);
      return kind ? [{ pid: Number(pid), kind, argv }] : [];
    } catch { return []; }
  });
}
module.exports = { databaseKind, processes };
if (require.main === module) {
  if (process.argv[2] === '--wait') {
    (async () => {
      const deadline = Date.now() + 110000;
      while (processes().length && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 100));
      const remaining = processes();
      if (remaining.length) {
        console.error(JSON.stringify({ error: 'Paired database shutdown timed out', remaining }));
        process.exitCode = 1;
      } else console.log('Paired database processes stopped');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  } else console.log(JSON.stringify(processes()));
}
