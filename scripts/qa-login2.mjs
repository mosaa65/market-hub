// Log in via the real form, capture the Supabase auth response, then report.
export default async function run(page, ui) {
  const errors = [];
  const net = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}\n${e.stack ?? ""}`));
  page.on("response", async (r) => {
    const u = r.url();
    if (u.includes("/auth/v1/") || u.includes("/rest/v1/")) {
      let body = "";
      try {
        body = (await r.text()).slice(0, 600);
      } catch {
        body = "<unreadable>";
      }
      net.push({ status: r.status(), url: u, body });
    }
  });

  const email = process.env.QA_EMAIL || "";
  const password = process.env.QA_PASSWORD || "";

  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);

  const toasts = [];
  await page.getByRole("button", { name: /دخول إلى النظام|Sign In/ }).click();

  // collect any toast text that appears
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    const t = await page.evaluate(() => {
      const nodes = document.querySelectorAll('[data-sonner-toast], [role="status"], .toast');
      return Array.from(nodes)
        .map((n) => n.textContent?.trim())
        .filter(Boolean);
    });
    if (t.length) toasts.push(...t);
  }

  return {
    url: page.url(),
    toasts: [...new Set(toasts)],
    errors,
    net,
    storageKeys: await page.evaluate(() => Object.keys(window.localStorage)),
  };
}
