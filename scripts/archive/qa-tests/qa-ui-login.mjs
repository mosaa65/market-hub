// فحص شامل عبر تسجيل دخول حقيقي من واجهة النموذج (البريد + كلمة المرور).
export default async function run(page, ui) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('WebSocket') && !m.text().includes('ERR_BLOCKED'))
      errors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 300)));

  await page.waitForTimeout(2000);
  const snap = await ui.snapshot();

  // الحقول: أول textbox هو البريد/الهاتف، وثانيها كلمة المرور.
  const boxes = (snap.match(/@(e\d+) (?:textbox|spinbutton)/g) || []).map((s) => s.match(/@(e\d+)/)[1]);
  const submitBtn = (snap.match(/@(e\d+) button[^\n]*(?:دخول|Sign in)/g) || []).map((s) => s.match(/@(e\d+)/)[1]).pop();

  if (boxes.length < 2 || !submitBtn) {
    return { error: 'form fields not found', snapshot: snap.slice(0, 1500), boxes, submitBtn };
  }

  await ui.fill(boxes[0], '967777000001@vortex.local');
  await ui.fill(boxes[1], 'QaTest12345!');
  await ui.click(submitBtn);
  await page.waitForTimeout(6000);

  const afterLoginTitle = await page.title();

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
  return { afterLoginTitle, results, consoleErrors: errors.slice(0, 25) };
}
