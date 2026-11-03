/**
 * تدقيق أرصدة العملاء — قراءة فقط، عبر PostgREST للمشروع المرتبط.
 * الشاهد من الخادم نفسه: عرض customer_balance_reconciliation يُحسب لحظيًا.
 *
 * التشغيل: node scripts/audit-customer-balances.mjs
 */
const URL = process.env.AUDIT_SUPABASE_URL || "https://omdqecqiklnabqsjpfgh.supabase.co";
const KEY =
  process.env.AUDIT_SERVICE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZHFlY3Fpa2xuYWJxc2pwZmdoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDU0MTU4NSwiZXhwIjoyMTA2MTE3NTg1fQ.qznPAdJGnXqOIdFp0NF3wyQPxDi5KUSJkmyVMYK2gHY";

async function get(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

const [recon, ledger, customers] = await Promise.all([
  get("customer_balance_reconciliation?select=*"),
  get("customer_ledger?select=id,entry_type,reference_type,debit,credit,source_key&limit=5000"),
  get("customers?select=id,name,balance&limit=5000"),
]);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

console.log("═══ 1) المطابقة (عرض customer_balance_reconciliation) ═══");
console.log(
  `عملاء: ${customers.length} | متطابقون: ${customers.length - recon.length} | مختلفون: ${recon.length}`,
);
for (const r of recon) {
  console.log(
    `  ${r.name}  دفتر=${r.ledger_balance}  مخزَّن=${r.legacy_balance}  فرق=${r.difference}`,
  );
}

console.log("\n═══ 2) مصادر حركات دفتر العملاء ═══");
const sources = new Map();
let noKey = 0;
for (const row of ledger) {
  if (!row.source_key) noKey += 1;
  const k = `${row.entry_type} / ${row.reference_type ?? "—"}`;
  const acc = sources.get(k) ?? { n: 0, d: 0, c: 0 };
  acc.n += 1;
  acc.d = round2(acc.d + Number(row.debit ?? 0));
  acc.c = round2(acc.c + Number(row.credit ?? 0));
  sources.set(k, acc);
}
for (const [k, v] of [...sources].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(v.n).padStart(5)}  ${k}  (debit ${v.d} / credit ${v.c})`);
}
console.log(`  حركات بلا source_key (لا تحميها حماية التكرار): ${noKey}`);

console.log("\n═══ 3) تكرار source_key ═══");
const byKey = new Map();
for (const row of ledger) {
  if (!row.source_key) continue;
  byKey.set(row.source_key, (byKey.get(row.source_key) ?? 0) + 1);
}
const dupes = [...byKey].filter(([, n]) => n > 1);
console.log(dupes.length === 0 ? "  لا تكرار" : dupes.map(([k, n]) => `  ${k} × ${n}`).join("\n"));

console.log("\n═══ 4) أرصدة مخزَّنة سالبة / دفتر فارغ ═══");
console.log(`  أرصدة سالبة: ${customers.filter((c) => Number(c.balance) < 0).length}`);
const ledgerCustomers = new Set(ledger.map((r) => r.customer_id));
console.log(
  `  عميل بلا أي حركة دفتر: ${customers.filter((c) => !ledgerCustomers.has(c.id)).length}`,
);
