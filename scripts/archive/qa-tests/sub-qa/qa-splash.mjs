export default async function run(page, ui) {
  await page.waitForSelector("#login-identifier", { timeout: 20000 });

  const samples = [];
  for (const ms of [0, 800, 2000, 5000]) {
    if (ms) await page.waitForTimeout(ms);
    const s = await page.evaluate(() => {
      const el = document.querySelector('div[class*="z-\\[99999\\]"]');
      const b = document.querySelector("button[type=submit]");
      const rc = b ? b.getBoundingClientRect() : null;
      const hit = rc ? document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2) : null;
      return {
        splashPresent: !!el,
        splashDisplay: el ? getComputedStyle(el).display : null,
        encrypted: (() => {
          try {
            return sessionStorage.getItem("vortex_splash_shown");
          } catch (e) {
            return "THROWS: " + e.name;
          }
        })(),
        blocked: hit ? hit.tagName !== "BUTTON" : null,
        blockedBy: hit && hit.tagName !== "BUTTON" ? hit.tagName : null,
      };
    });
    samples.push({ t: ms, ...s });
  }

  // هل النقر يعمل أصلاً؟
  await page.locator("#login-identifier").fill("x@y.com");
  const clicked = await page.evaluate(() => {
    const b = document.querySelector("button[type=submit]");
    b.click();
    return document.querySelector("#login-identifier").value;
  });

  return { samples, clickedProgrammatically: clicked };
}
