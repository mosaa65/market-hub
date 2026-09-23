// Log in via the real form and report what the app does next.
export default async function run(page, ui) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}\n${e.stack ?? ""}`));

  const snap = await ui.snapshot();
  const emailRef = snap.match(/@(e\d+)\s+textbox/i)?.[1] ?? null;

  // Fall back to raw locators: the email/password inputs are the first two textboxes.
  const boxes = page.locator("input");
  const count = await boxes.count();
  const emailInput = page.locator('input[type="email"]');
  const passInput = page.locator('input[type="password"]');

  const email = process.env.QA_EMAIL || "";
  const password = process.env.QA_PASSWORD || "";

  const out = { emailRef, inputCount: count, email, before: page.url() };
  if (!email || !password) {
    out.note = "no QA_EMAIL / QA_PASSWORD supplied - cannot log in";
    out.snapshot = snap;
    return out;
  }

  await emailInput.fill(email);
  await passInput.fill(password);
  await page.getByRole("button", { name: /دخول إلى النظام|Sign In/ }).click();

  await page.waitForTimeout(8000);

  out.after = page.url();
  out.title = await page.title();
  out.bodyText = (await page.locator("body").innerText()).slice(0, 1500);
  out.errors = errors;
  out.storageKeys = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((k) => k.startsWith("sb-")),
  );
  return out;
}
