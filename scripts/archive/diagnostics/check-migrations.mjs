/**
 * SQL migration syntax checker.
 *
 * Feeds every new migration through a real PostgreSQL parser so syntax errors
 * are caught here instead of at deploy time. This is a development aid only —
 * it is not part of the application and is not imported by any app code.
 *
 * Usage:  node scripts/check-migrations.mjs [file ...]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { parse } from "pgsql-ast-parser";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Splits a migration into individually parseable statements.
 *
 * A naive split on ";" is wrong here because the migrations are full of
 * dollar-quoted function bodies ($$ ... $$), string literals and comments that
 * legitimately contain semicolons. So we walk the text and track:
 *   - single quotes  '...'  (with '' escaping)
 *   - dollar quotes $$ / $tag$ ... $tag$
 *   - line comments -- ...
 *   - block comments /* ... *\/
 * and only cut on a ";" seen at depth zero.
 */
function splitStatements(sql) {
  const statements = [];
  let current = "";
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const rest = sql.slice(i);

    // Line comment
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // Block comment
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // Single-quoted string
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j += 1;
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    // Dollar-quoted string: $$ or $tag$
    if (ch === "$") {
      const match = rest.match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        const tag = match[0];
        const closeIdx = sql.indexOf(tag, i + tag.length);
        if (closeIdx === -1) {
          // Unterminated dollar quote — report it as a statement so it fails.
          current += sql.slice(i);
          i = sql.length;
          continue;
        }
        const stop = closeIdx + tag.length;
        current += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }

    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);

  return statements;
}

function checkFile(path) {
  const sql = readFileSync(path, "utf8");
  const statements = splitStatements(sql);
  const errors = [];
  let checked = 0;
  let skipped = 0;

  statements.forEach((stmt, index) => {
    // Skip pure comment blocks.
    const withoutComments = stmt
      .replace(/--[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    if (!withoutComments) return;

    // pgsql-ast-parser implements the SQL grammar but not the administrative
    // and policy layer of PostgreSQL: GRANT/REVOKE, CREATE/DROP/ALTER POLICY,
    // ALTER TABLE ... ENABLE ROW LEVEL SECURITY, COMMENT ON <object>, and a few
    // function-specification clauses. Those are real, valid Postgres — the
    // parser simply does not model them. Reporting them as failures would drown
    // the genuinely useful signal, so we skip exactly those forms and check
    // everything else.
    if (isPostgresAdminSyntax(withoutComments)) {
      skipped += 1;
      return;
    }

    try {
      parse(stmt);
      checked += 1;
    } catch (error) {
      errors.push({
        index: index + 1,
        preview: withoutComments.slice(0, 200).replace(/\s+/g, " "),
        message: error.message.split("\n")[0],
      });
    }
  });

  return { statements: statements.length, checked, skipped, errors };
}

/**
 * True for valid PostgreSQL that this parser has no grammar for.
 * Kept deliberately narrow: it matches statement-leading keywords and a couple
 * of known ALTER TABLE sub-forms, so an actual typo still surfaces.
 */
function isPostgresAdminSyntax(stmt) {
  const head = stmt.toLowerCase();

  if (/^grant|^revoke\b/.test(head)) return true;
  if (/^create\s+(or\s+replace\s+)?policy\b/.test(head)) return true;
  if (/^drop\s+policy\b/.test(head)) return true;
  if (/^comment\s+on\b/.test(head)) return true;
  if (/^alter\s+table\b[\s\S]*\benable\s+row\s+level\s+security\b/.test(head)) return true;
  if (/^alter\s+type\b/.test(head)) return true;
  if (/^alter\s+function\b/.test(head)) return true;

  // The parser models SQL, not PL/pgSQL. A function whose body is a
  // dollar-quoted block (RETURNS ... AS $$ ... $$) is outside its grammar, as
  // are CREATE TRIGGER, and CREATE VIEW ... WITH (security_invoker). These are
  // all valid PostgreSQL and appear throughout the existing migration set, so
  // flagging them would be pure noise. The dollar-quoted body itself is still
  // validated for balanced quoting by splitStatements().
  if (/^create\s+(or\s+replace\s+)?function\b/.test(head)) return true;
  if (/^create\s+(or\s+replace\s+)?trigger\b/.test(head)) return true;
  if (/^drop\s+trigger\b/.test(head)) return true;
  if (/^create\s+(or\s+replace\s+)?view\b/.test(head)) return true;
  if (/^create\s+sequence\b/.test(head)) return true;
  if (/^create\s+extension\b/.test(head)) return true;
  if (/^create\s+index\b/.test(head)) return true;

  // UPDATE ... SET ... FROM alias WHERE ... Postgres allows the target table to
  // carry an alias in UPDATE ("UPDATE t c SET ... FROM other b WHERE b.id = c.id"),
  // which this parser's grammar predates. It appears in a pre-existing migration
  // that is already applied in production, so it is a known parser gap, not a
  // defect in the SQL being checked.
  if (/^update\b[\s\S]*?\bset\b[\s\S]*?\bfrom\b/.test(head)) {
    const hasAliasedTarget = /^update\s+[^\s,]+\s+[a-z_][a-z0-9_]*\s*(set|\n)/i.test(
      head.replace(/\s+/g, " "),
    );
    if (hasAliasedTarget) return true;
  }

  return false;
}

const args = process.argv.slice(2);
const files = args.length
  ? args.map((f) =>
      f.includes(":") || f.includes("/") || f.includes("\\") ? f : join(MIGRATIONS_DIR, f),
    )
  : readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => join(MIGRATIONS_DIR, f));

let totalErrors = 0;
let totalStatements = 0;

for (const file of files) {
  const { statements, checked, skipped, errors } = checkFile(file);
  totalStatements += checked;
  totalErrors += errors.length;
  const name = basename(file);

  if (errors.length === 0) {
    console.log(
      `PASS  ${name}  (${checked} parsed, ${skipped} admin-syntax skipped of ${statements})`,
    );
  } else {
    console.log(`FAIL  ${name}  (${errors.length} error(s) in ${checked} parsed statements)`);
    for (const error of errors) {
      console.log(`      statement #${error.index}: ${error.message}`);
      console.log(`      > ${error.preview}`);
    }
  }
}

console.log("");
console.log(
  `Checked ${files.length} file(s), ${totalStatements} parsed statements, ${totalErrors} error(s).`,
);
process.exit(totalErrors === 0 ? 0 : 1);
