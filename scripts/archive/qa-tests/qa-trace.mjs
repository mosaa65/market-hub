// تشخيص: أي صفحة تُلغي الجلسة؟ نتتبع التوكين عبر التنقل.
import fs from 'node:fs';

const session = JSON.parse(fs.readFileSync('.qa-session.json', 'utf8'));
const BASE = 'http://localhost:5199';

export default async function run(page, ui) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('WebSocket')) errors.push(m.text().slice(0, 250)); });
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

  const trace = [];
  for (const p of ['/dashboard', '/pos', '/sales']) {
    await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const tok = await page.evaluate((k) => {
      const v = localStorage.getItem(k);
      return v ? v.slice(0, 60) : 'REMOVED';
    }, lsKey);
    trace.push({ page: p, title: await page.title(), token: tok });
  }
  return { trace, consoleErrors: errors.slice(0, 15) };
}
