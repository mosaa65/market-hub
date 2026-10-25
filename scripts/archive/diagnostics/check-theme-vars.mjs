// يقارن متغيّرات CSS بين كتلتي الوضع الفاتح والداكن ويريد ما ينقص الفاتح.
import fs from "node:fs";

const css = fs.readFileSync("src/styles.css", "utf8");

function blockVars(selector) {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`selector not found: ${selector}`);
  const start = css.indexOf("{", at);
  let depth = 0;
  let end = start;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = css.slice(start + 1, end);
  return new Set([...body.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
}

const dark = blockVars(":root,");
const light = blockVars(".light");

const missingInLight = [...dark].filter((v) => !light.has(v)).sort();
const extraInLight = [...light].filter((v) => !dark.has(v)).sort();

console.log(`داكن: ${dark.size} متغيّر · فاتح: ${light.size} متغيّر`);
console.log(`\nموجود في الداكن و مفقود في الفاتح (${missingInLight.length}):`);
for (const v of missingInLight) console.log(`   • ${v}`);
console.log(`\nموجود في الفاتح فقط (${extraInLight.length}):`);
for (const v of extraInLight) console.log(`   • ${v}`);