// تأكيد بريد مستخدم QA عبر service role ثم الحصول على جلسة دخول.
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const base = (env.VITE_SUPABASE_URL || env.SUPABASE_URL).replace(/^"+|"+$/g, '');
const anon = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '').replace(/^"+|"+$/g, '');
const service = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/^"+|"+$/g, '');

// تأكيد البريد
const upd = await fetch(`${base}/auth/v1/admin/users/a122c22c-4d5c-43da-85d8-e12f3a74669b`, {
  method: 'PUT',
  headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email_confirm: true }),
});
console.log('confirm:', upd.status);

// دخول بكلمة المرور
const r = await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'qa-agent.market-hup@gmail.com', password: 'QaTest12345!' }),
});
const j = await r.json();
if (j.access_token) {
  fs.writeFileSync('.qa-session.json', JSON.stringify({
    token: j.access_token,
    refresh: j.refresh_token,
    base,
    anon,
    projectRef: fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim(),
  }));
  console.log('SESSION OK, token:', j.access_token.slice(0, 16) + '...');
} else {
  console.log('login failed:', JSON.stringify(j).slice(0, 200));
}
