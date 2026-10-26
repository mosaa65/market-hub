// ضبط هاتف حساب QA حتى يتسنى الدخول من واجهة تسجيل الدخول (الهاتف + كلمة المرور).
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const base = (env.VITE_SUPABASE_URL || env.SUPABASE_URL).replace(/^"+|"+$/g, '');
const service = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/^"+|"+$/g, '');

const userId = 'a122c22c-4d5c-43da-85d8-e12f3a74669b';
const r = await fetch(`${base}/auth/v1/admin/users/${userId}`, {
  method: 'PUT',
  headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: '+967777000001', phone_confirm: true, email_confirm: true }),
});
console.log('phone set:', r.status);
if (r.status !== 200) console.log((await r.text()).slice(0, 200));
