// Is React hydrated on /auth? Does clicking the submit button actually call the handler?
export default async function run(page, ui) {
  const events = [];
  page.on("pageerror", (e) => events.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") events.push(`console.error: ${m.text()}`);
  });
  page.on("request", (r) => {
    if (r.url().includes("/auth/v1/")) events.push(`REQ ${r.method()} ${r.url()}`);
  });

  // Is the React tree alive? Look for React's internal fiber key on the form.
  const hydration = await page.evaluate(() => {
    const form = document.querySelector("form");
    const btn = document.querySelector('button[type="submit"]');
    const fiberKeys = form ? Object.keys(form).filter((k) => k.startsWith("__react")) : [];
    return {
      hasForm: !!form,
      formAction: form?.getAttribute("action") ?? null,
      formMethod: form?.getAttribute("method") ?? null,
      reactFiberKeys: fiberKeys,
      hydrated: fiberKeys.length > 0,
      btnDisabled: btn?.disabled ?? null,
      btnType: btn?.getAttribute("type") ?? null,
    };
  });

  // Install a hook to see whether React's synthetic submit listener fires.
  await page.evaluate(() => {
    window.__nativeSubmitSeen = 0;
    document.addEventListener(
      "submit",
      () => {
        window.__nativeSubmitSeen++;
      },
      true,
    );
  });

  await page.locator('input[type="email"]').fill(process.env.QA_EMAIL || "");
  await page.locator('input[type="password"]').fill(process.env.QA_PASSWORD || "");

  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(8000);

  return {
    hydration,
    nativeSubmitsObserved: await page.evaluate(() => window.__nativeSubmitSeen),
    urlAfterClick: page.url(),
    events,
  };
}
