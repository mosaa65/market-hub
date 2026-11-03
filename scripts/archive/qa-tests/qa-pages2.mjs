// إعادة فحص الصفحات الأربع التي أعادت التوجيه، بعد منح الأدوار.
import fs from 'node:fs';

const session = JSON.parse(fs.readFileSync('.qa-session.json', 'utf8'));
const BASE = 'http://localhost:5199';

export default async function run(page, ui) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 250)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 250)));

  const lsKey = `sb-${session.projectRef}-auth-token`;
  await page.addInitScript(([k, token, refresh]) => {
    localStorage.setItem(k, JSON.stringify({
      currentSession: {
        access_token: token, refresh_token: refresh, token_type: 'bearer',
        expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: null,
      },
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }));
  }, [lsKey, session.token, session.refresh]);

  const pages = ['/pos', '/sales', '/purchases', '/production', '/milling', '/expenses', '/reports'];
  const results = [];
  for (const p of pages) {
    await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3500);
    const title = await page.title();
    const body = await page.evaluate(() => document.body.innerText.slice(0, 120));
    results.push({ page: p, title, bodyStart: body.replace(/\n+/g, ' | ') });
  }
  return { results, consoleErrors: errors.slice(0, 20) };
}
