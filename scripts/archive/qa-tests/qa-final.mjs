// فحص شامل بعد إصلاح المصادقة: جلسة REST كاملة (بتوكن جديد) ثم جولة على كل الصفحات.
import fs from 'node:fs';

const session = JSON.parse(fs.readFileSync('.qa-session.json', 'utf8'));

// استخراج التوكن الجديد عبر REST (grant_type=refresh_token)
const resp = await fetch(session.base + '/auth/v1/token?grant_type=refresh_token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: session.anon, Authorization: 'Bearer ' + session.anon },
  body: JSON.stringify({ refresh_token: session.refresh }),
});
if (!resp.ok) {
  console.error('refresh failed:', resp.status, await resp.text());
  process.exit(1);
}
const tok = await resp.json();
console.error('refresh ok, user:', tok.user?.email, 'expires:', new Date(tok.expires_at * 1000).toISOString());
// حفظ الريلف الجديد للمرة القادمة
session.token = tok.access_token;
session.refresh = tok.refresh_token;
fs.writeFileSync('.qa-session.json', JSON.stringify(session, null, 2));

export default async function run(page, ui) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('WebSocket') && !m.text().includes('ERR_BLOCKED'))
      errors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 300)));

  const lsKey = `sb-${session.projectRef}-auth-token`;
  const user = tok.user;
  const payload = {
    currentSession: {
      access_token: session.token,
      refresh_token: session.refresh,
      token_type: 'bearer',
      expires_in: tok.expires_in,
      expires_at: tok.expires_at,
      user,
    },
    expiresAt: tok.expires_at,
  };
  await page.addInitScript(([k, data]) => {
    localStorage.setItem(k, JSON.stringify(data));
  }, [lsKey, payload]);

  const pages = ['/dashboard', '/products', '/pos', '/sales', '/purchases', '/inventory',
    '/customers', '/production', '/milling', '/reports', '/expenses', '/settings'];
  const results = [];
  for (const p of pages) {
    await page.goto('http://localhost:5199' + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const title = await page.title();
    const body = await page.evaluate(() => document.body.innerText.slice(0, 120));
    results.push({ page: p, title, body: body.replace(/\n+/g, ' | ') });
  }
  return { results, consoleErrors: errors.slice(0, 25) };
}
