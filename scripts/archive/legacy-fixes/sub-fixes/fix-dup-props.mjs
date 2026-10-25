/**
 * One-off: remove the duplicated `currency=""` prop on VortexMetricCard.
 *
 * The notifications screen repeated `currency=""` twice per card, which is a
 * TS17001 error and also a symptom of a bad merge — the second copy was
 * inserted where the icon prop belongs.
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/routes/_app.notifications.tsx";

let src = readFileSync(FILE, "utf8");
const before = src.length;

// The bad merge put a second `currency=""` right after the first one, i.e. the
// duplicate is the FIRST of the pair. Drop it, keeping the following prop.
src = src.replace(/\n\s*currency=""(?=\s*\n\s*(?:currency=""|icon=\{))/g, "");
src = src.replace(/ currency=""(?=\s+icon=\{)/g, "");

// Any remaining duplicate pair across the same element.
const pairs = (src.match(/currency=""[\s\S]{0,120}?currency=""/g) ?? []).length;

writeFileSync(FILE, src);
console.log(`bytes ${before} -> ${src.length}; remaining duplicate pairs: ${pairs}`);
