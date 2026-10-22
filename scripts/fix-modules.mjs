import { connect } from './db-run.mjs';

const c = await connect();
await c.connect();

// Fix invalid module id: "accounting" -> the real module ids used by the front-end
const res = await c.query(
  `UPDATE public.tenant_subscriptions
   SET extra_modules = array(
     SELECT DISTINCT m FROM unnest(
       CASE WHEN 'accounting' = ANY(extra_modules)
         THEN array_append(array_remove(extra_modules, 'accounting'), 'advanced_accounting')
         ELSE extra_modules
       END || ARRAY['multi_warehouse','barcode','loyalty','batches','analytics','audit','milling_operations']
     ) AS m
   ),
   updated_at = now()
   WHERE tenant_id = 'default'
   RETURNING plan_id, extra_modules`,
);
console.log('UPDATED:', JSON.stringify(res.rows, null, 2));

await c.end();
