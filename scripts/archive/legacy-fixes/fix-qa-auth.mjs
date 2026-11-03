// تحديث بريد حساب QA إلى صيغة المصادقة المستخدمة في التطبيق (رقم@vortex.local)
// ثم التحقق من الدخول به.
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const base = (env.VITE_SUPABASE_URL || env.SUPABASE_URL).replace(/^"+|"+$/g, '');
const anon = (env.VITE_SUPABASE_PUBLISHABLE_KEY || '').replace(/^"+|"+$/g, '');
const service = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/^"+|"+$/g, '');

const userId = 'a122c22c-4d5c-43da-85d8-e12f3a74669b';
const upd = await fetch(`${base}/auth/v1/admin/users/${userId}`, {
  method: 'PUT',
  headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: '967777000001@vortex.local', email_confirm: true }),
});
console.log('email set:', upd.status);

const r = await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: '967777000001@vortex.local', password: 'QaTest12345!' }),
});
const j = await r.json();
if (j.access_token) {
  fs.writeFileSync('.qa-session.json', JSON.stringify({
    token: j.access_token, refresh: j.refresh_token, base, anon,
    projectRef: fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim(),
  }));
  console.log('LOGIN OK — session saved');
} else {
  console.log('login failed:', r.status, JSON.stringify(j).slice(0, 200));
}
