import { connect } from '../../scripts/db-run.mjs';
const c = await connect();
await c.connect();
const t0 = Date.now();
for (let i = 0; i < 8; i++) {
  const s = Date.now();
  await c.query('select 1');
  console.log('ping', i, Date.now() - s, 'ms');
}
console.log('total', Date.now() - t0);
await c.end();
