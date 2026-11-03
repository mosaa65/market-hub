// عميل مؤقت للاختبارات — يُنشأ ثم يُحذف بعد انتهاء الاختبار.
import { connect } from './db-run.mjs';

const client = await connect();
await client.connect();
const { rows } = await client.query(
  `insert into customers (name, phone, is_active) values ('TEST-CUSTOMER-ACC', '000', true)
   on conflict do nothing
   returning id`,
);
console.log('customer:', rows[0]?.id ?? '(exists)');
await client.end();
