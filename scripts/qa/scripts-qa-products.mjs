export default async function run(page, ui) {
  // انتقل لشاشة المنتجات مباشرة بعد الدخول
  await page.goto("http://localhost:3000/products", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const url = page.url();
  const tree = await ui.snapshot({ full: true });
  return { url, tree: tree.slice(0, 4000) };
}
