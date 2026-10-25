// إنشاء مستخدم اختبار والحصول على جلسة — للفحص الآلي للواجهات.
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const base = (env.VITE_SUPABASE_URL || env.SUPABASE_URL).replace(/^"+|"+$/g, '');
const anon = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '').replace(/^"+|"+$/g, '');

const r = await fetch(`${base}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'qa-agent.market-hup@gmail.com', password: 'QaTest12345!', data: { full_name: 'QA Agent' } }),
});
const j = await r.json();
console.log('status:', r.status);
if (j.access_token) {
  fs.writeFileSync('.qa-session.json', JSON.stringify({
    token: j.access_token,
    refresh: j.refresh_token,
    base,
    anon,
  }));
  console.log('session saved, token:', j.access_token.slice(0, 16) + '...');
} else {
  console.log(JSON.stringify(j).slice(0, 300));
}
