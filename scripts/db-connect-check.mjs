/**
 * تشخيص اتصال القاعدة: يفصل بين "فشل الشبكة" و"كلمة مرور غير صحيحة".
 * لا يطبع كلمة المرور. استخدام: node scripts/db-connect-check.mjs "<db-url>"
 */
import pg from "pg";

const url = process.argv[2];
if (!url) {
  console.error("الاستخدام: node scripts/db-connect-check.mjs <db-url>");
  process.exit(1);
}

const u = new URL(url);
console.log(
  `host=${u.hostname} port=${u.port} user=${decodeURIComponent(u.username)} password=${u.password ? "set(len=" + decodeURIComponent(u.password).length + ")" : "missing"}`,
);

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
  query_timeout: 20000,
});

try {
  await client.connect();
  const { rows } = await client.query("select current_user, inet_server_addr()::text as addr");
  console.log("CONNECTED", JSON.stringify(rows[0]));
} catch (e) {
  console.log("FAILED", e.code ?? "", e.message);
} finally {
  try {
    await client.end();
  } catch {}
}
