// فحص شامل للواجهات: دخول بجلسة QA ثم زيارة الصفحات الرئيسية وتسجيل الأخطاء.
import fs from 'node:fs';

const session = JSON.parse(fs.readFileSync('.qa-session.json', 'utf8'));
const BASE = 'http://localhost:5199';

export default async function run(page, ui) {
  const errors = [];
  const failed = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 250)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 250)));
  page.on('requestfailed', (r) => failed.push(r.url().slice(0, 120)));

  // حقن جلسة Supabase في localStorage قبل تحميل التطبيق
  const lsKey = `sb-${session.projectRef}-auth-token`;
  await page.addInitScript(([k, token, refresh, base, anon]) => {
    localStorage.setItem(k, JSON.stringify({
      currentSession: {
        access_token: token, refresh_token: refresh, token_type: 'bearer',
        expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: null,
      },
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }));
  }, [lsKey, session.token, session.refresh, session.base, session.anon]);

  const pages = ['/dashboard', '/products', '/pos', '/sales', '/purchases', '/inventory',
    '/customers', '/production', '/milling', '/reports', '/expenses'];
  const results = [];
  for (const p of pages) {
    try {
      const resp = await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
      const title = await page.title();
      const bodyChars = (await page.content()).length;
      results.push({ page: p, status: resp.status(), title, bodyChars });
    } catch (e) {
      results.push({ page: p, error: String(e).slice(0, 150) });
    }
  }
  return { results, consoleErrors: errors.slice(0, 30), requestFailures: failed.slice(0, 20) };
}
