// تحديث كتلة Functions في src/integrations/supabase/types.ts من القاعدة المتصلة.
// الاستخدام: node scripts/update-supabase-types.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "./db-run.mjs";

const TYPES = "src/integrations/supabase/types.ts";

const ts = (t) => {
  const x = (t || "").trim();
  if (x.endsWith("[]")) return `${ts(x.slice(0, -2))}[]`;
  if (/^uuid/.test(x)) return "string";
  if (/^(numeric|integer|bigint|smallint|real|double precision)/.test(x)) return "number";
  if (/^boolean/.test(x)) return "boolean";
  if (/^json/.test(x)) return "Json";
  return "string";
};

const client = await connect();
await client.connect();
const { rows } = await client.query(`
  select p.proname,
         p.proargnames as names,
         pg_get_function_result(p.oid) as result,
         pg_get_function_arguments(p.oid) as args
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prokind = 'f'
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  order by p.proname
`);
await client.end();

const byName = new Map();
for (const r of rows) {
  if (byName.has(r.proname)) continue;
  const names = r.names || [];
  const parts = r.args
    .split(/,(?![^(]*\))/)
    .map((s) => s.trim())
    .filter(Boolean);
  const isSetof = /^TABLE|^SETOF/i.test(r.result);
  const ret = isSetof ? "Json[]" : ts(r.result);
  const argLines = parts.map((p, i) => {
    const name = names[i] || `arg${i + 1}`;
    const base = p.replace(/\s+DEFAULT\s+.*$/i, "").trim();
    // نوع كامل (يشمل الأحجام والأسماء المؤهلة) حتى تُترجم numeric(14,2) و text بشكل صحيح.
    const t = base.replace(/^\w+\s+/, "");
    const optional = /DEFAULT/i.test(p);
    return `          ${name}${optional ? "?" : ""}: ${ts(t)};`;
  });
  byName.set(
    r.proname,
    `      ${r.proname}: {\n        Args: {\n${argLines.join("\n")}\n        };\n        Returns: ${ret};\n      };`,
  );
}

const src = readFileSync(TYPES, "utf8");
const startMarker = "    Functions: {\r\n";
const start = src.indexOf(startMarker);
if (start < 0) throw new Error("Functions block not found");
const end = src.indexOf("\r\n    };", start + startMarker.length);
if (end < 0) throw new Error("Functions block end not found");

const body = [...byName.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, v]) => v.replace(/\n/g, "\r\n"))
  .join("\r\n");
const next = `${src.slice(0, start)}${startMarker}${body}\r\n${src.slice(end + 2)}`;
writeFileSync(TYPES, next, "utf8");
console.log("functions written:", byName.size);
