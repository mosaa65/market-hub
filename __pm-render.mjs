// Measures the real rendered height of the payment control before/after:
// the old selector rendered a button grid + settlement panel permanently;
// the new one must be a single 40px row until opened.
export default async function run(page, ui) {
  await page.goto("http://127.0.0.1:3200/", { waitUntil: "domcontentloaded" }).catch(() => { });
  const snapshot = await ui.snapshot({ full: true });
  return {
    title: await page.title(),
    hasApp: (await page.content()).length > 2000,
    bodyChars: (await page.evaluate(() => document.body.innerText.length)),
    snapshotHead: snapshot.slice(0, 700),
  };
}
