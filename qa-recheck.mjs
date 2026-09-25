/** Re-verify the products toolbar and table at desktop and phone widths.
 *
 * Usage: set QA_EMAIL and QA_PASSWORD in the shell before running this harness.
 * Credentials must never be stored in the repository.
 */
export default async function run(page) {
  const email = process.env.QA_EMAIL;
  const password = process.env.QA_PASSWORD;
  if (!email || !password) throw new Error("Set QA_EMAIL and QA_PASSWORD before running QA.");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://localhost:8080/auth", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="password"]', { timeout: 120000 });
  await page.locator('input[type="email"]').type(email, { delay: 20 });
  await page.locator('input[type="password"]').type(password, { delay: 20 });
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith("/auth"), { timeout: 150000 });

  await page.goto("http://localhost:8080/products", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("tbody tr", { timeout: 120000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);

  return await page.evaluate(() => {
    const scrollContainer = document.querySelector(".overflow-x-auto");
    const table = document.querySelector("table");
    return {
      pageOverflows: document.documentElement.scrollWidth > window.innerWidth + 1,
      tableIsWider: table ? table.getBoundingClientRect().width > window.innerWidth : false,
      tableCanScroll: scrollContainer ? scrollContainer.scrollWidth > scrollContainer.clientWidth : false,
    };
  });
}
