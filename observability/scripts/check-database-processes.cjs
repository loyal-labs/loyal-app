const assert = require('node:assert/strict');
const { databaseKind } = require('./database-processes.cjs');
for (const argv of [['mongod'], ['/usr/bin/mongod'], ['/opt/mongo/bin/mongod', '--quiet']]) assert.equal(databaseKind(argv), 'mongo');
for (const argv of [['clickhouse-server'], ['/usr/bin/clickhouse-server'], ['clickhouse', 'server'], ['/usr/bin/clickhouse', 'server', '--config-file=x']]) assert.equal(databaseKind(argv), 'clickhouse');
for (const argv of [[], ['node', 'mongod'], ['clickhouse', 'client'], ['/usr/bin/clickhouse-client'], ['bash', 'clickhouse', 'server']]) assert.equal(databaseKind(argv), null);
console.log('PASS 12 absolute/basename/multicall and negative process identity cases');
