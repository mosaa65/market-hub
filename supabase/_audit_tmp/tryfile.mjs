// Applies a migration file inside a transaction and ALWAYS rolls back.
// The file's own BEGIN/COMMIT are neutralised so the outer transaction keeps control.
import fs from 'node:fs';
import { connect } from '../../scripts/db-run.mjs';

const file = process.argv[2];
let sql = fs.readFileSync(file, 'utf8');
sql = sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gm, '-- (stripped by dry run)');

const c = await connect();
c.on('error', () => { });
await c.connect();
try {
  await c.query('begin');
  await c.query(sql);
  console.log(`DRY-RUN OK  ${file}`);
} catch (e) {
  console.log(`DRY-RUN FAIL ${file}\n  ${e.code ?? ''} ${e.message}\n  ${e.detail ?? ''}\n  ${e.hint ?? ''}\n  at: ${e.position ?? ''}`);
  process.exitCode = 1;
}
await c.query('rollback');
await c.end();
