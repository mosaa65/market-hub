// End-to-end check: does the sidebar/AppShell render without the TypeError?
export default async function run(page, ui) {
  const events = [];
  page.on("pageerror", (e) => events.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") events.push(`console.error: ${m.text()}`);
  });

  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/auth/v1/") || u.includes("/rest/v1/")) {
      events.push(`REQ ${r.method()} ${u}`);
    }
  });
  page.on("response", async (r) => {
    const u = r.url();
    if (u.includes("/auth/v1/") || u.includes("/rest/v1/")) {
      let body = "";
      try {
        body = (await r.text()).slice(0, 400);
      } catch {
        body = "<unreadable>";
      }
      events.push(`RES ${r.status()} ${u} :: ${body}`);
    }
  });

  await page.locator('input[type="email"]').fill(process.env.QA_EMAIL || "");
  await page.locator('input[type="password"]').fill(process.env.QA_PASSWORD || "");

  // Click the real submit button (React path), not a native form submit.
  await page.getByRole("button", { name: /دخول إلى النظام|Sign In/ }).click();
  await page.waitForTimeout(10000);

  const bodyText = await page.locator("body").innerText();
  return {
    url: page.url(),
    title: await page.title(),
    hasRenderError: /Something went wrong|An error occurred while rendering/i.test(bodyText),
    hasStartsWithError: events.some((e) => e.includes("startsWith")),
    bodyStart: bodyText.slice(0, 800),
    events: events.slice(0, 25),
  };
}
