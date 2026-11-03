// اختبار الدخول بالهاتف بعدة صيغ لمعرفة الصيغة الصحيحة.
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const base = (env.VITE_SUPABASE_URL || env.SUPABASE_URL).replace(/^"+|"+$/g, '');
const anon = (env.VITE_SUPABASE_PUBLISHABLE_KEY || '').replace(/^"+|"+$/g, '');

for (const phone of ['+967777000001', '967777000001', '777000001']) {
  const r = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: 'QaTest12345!' }),
  });
  const j = await r.json();
  console.log(phone, '->', r.status, j.error_description || j.msg || j.error || `OK token=${!!j.access_token}`);
  if (j.access_token) {
    fs.writeFileSync('.qa-session.json', JSON.stringify({
      token: j.access_token, refresh: j.refresh_token, base, anon,
      projectRef: fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim(),
    }));
    console.log('SESSION SAVED');
    break;
  }
}
