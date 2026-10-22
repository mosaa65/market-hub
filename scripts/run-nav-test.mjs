/**
 * يشغّل اختبار سجل التنقّل عبر Vite نفسه بدل إضافة tsx كمُعتمدية.
 * Vite موجود أصلاً في المشروع، ويحوّل TS/TSX بنفس الإعدادات التي يبني بها
 * التطبيق — فالاختبار يرى الوحدات كما تراها الواجهة تماماً.
 */
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
  await server.ssrLoadModule("/src/lib/navigation/__tests__/route-registry.test.ts");
  console.log("\n✔ نجح اختبار سجل التنقّل");
  process.exitCode = 0;
} catch (error) {
  console.error("\n✘ فشل اختبار سجل التنقّل\n");
  console.error(error?.message ?? error);
  process.exitCode = 1;
} finally {
  await server.close();
}
