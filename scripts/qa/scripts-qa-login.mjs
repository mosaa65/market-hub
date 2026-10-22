export default async function run(page, ui) {
  // شاشة الدخول
  const snap = await ui.snapshot();
  const phoneField =
    snap.match(/@(e\d+) [^\n]*(textbox|spinbutton)[^\n]*phone/i)?.[1] ||
    snap.match(/@(e\d+) [^\n]*(textbox|spinbutton)[^\n]*هاتف/i)?.[1];
  const passField =
    snap.match(/@(e\d+) [^\n]*textbox[^\n]*pass/i)?.[1] ||
    snap.match(/@(e\d+) [^\n]*textbox[^\n]*مرور/i)?.[1];

  if (!phoneField || !passField) {
    return { stage: "login-fields-not-found", snapshot: snap.slice(0, 2500) };
  }

  await ui.fill(phoneField, "772217218");
  await ui.fill(passField, "Super#2004");

  // Enter بدل مرجع الزر — المراجع تموت بعد إعادة الرسم.
  await page.keyboard.press("Enter");

  // انتظر الخروج من شاشة الدخول
  await page.waitForURL((u) => !u.pathname.includes("auth"), { timeout: 25000 }).catch(() => {});

  await page.waitForTimeout(4000);
  const url = page.url();
  const tree = await ui.snapshot({ full: true });
  return { stage: "after-login", url, tree: tree.slice(0, 3500) };
}
