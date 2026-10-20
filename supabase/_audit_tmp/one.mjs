// node one.mjs "<sql>"
import { connect } from '../../scripts/db-run.mjs';
const c = await connect();
await c.connect();
const r = await c.query(process.argv[2]);
console.log(JSON.stringify(r.rows ?? r, null, 2));
await c.end();
