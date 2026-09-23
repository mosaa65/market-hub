// Confirm hydration works in a production-mode build (no componentTagger),
// which proves the dev-only source-tagger is what broke login.
export default async function run(page, ui) {
  const events = [];
  page.on("pageerror", (e) => events.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") events.push(`console.error: ${m.text().slice(0, 200)}`);
  });

  const hydration = await page.evaluate(() => {
    const form = document.querySelector("form");
    const keys = form ? Object.keys(form).filter((k) => k.startsWith("__react")) : [];
    return {
      url: location.href,
      hasForm: !!form,
      hydrated: keys.length > 0,
      hasTsdAttr: !!document.querySelector("[data-tsd-source]"),
    };
  });

  return { hydration, events: events.slice(0, 10) };
}
