// One-off resolver for leftover git merge-conflict markers.
// Strategy: nested-aware. Innermost conflict block wins with the "theirs" (1a3f860) side,
// because that is the newer commit in this merge. The HEAD side is dropped.
// Usage: node scripts/resolve-conflicts.mjs <file...>
import { readFileSync, writeFileSync } from "node:fs";

const START = "<<<<<";
const MID = "=======";
const END = ">>>>>>>";

function resolve(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  // stack of { kind: 'conflict' } tracking open conflict depth
  const stack = [];
  let sawAny = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const isStart = trimmed.startsWith(START);
    const isMid = trimmed === MID;
    const isEnd = trimmed.startsWith(END);

    if (isStart) {
      sawAny = true;
      stack.push({ inTheirs: false });
      continue;
    }
    if (isMid) {
      // flip the innermost open conflict to the "theirs" side
      for (let i = stack.length - 1; i >= 0; i--) {
        stack[i].inTheirs = true;
      }
      continue;
    }
    if (isEnd) {
      if (stack.length) stack.pop();
      continue;
    }
    // keep the line only when we are not inside any conflict, or every enclosing
    // conflict is currently on the "theirs" side.
    const keep = stack.every((s) => s.inTheirs);
    if (keep) out.push(line);
  }

  return { text: out.join("\n"), sawAny };
}

let changed = 0;
for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, "utf8");
  const { text, sawAny } = resolve(src);
  if (!sawAny) {
    console.log(`skip (no markers): ${file}`);
    continue;
  }
  writeFileSync(file, text, "utf8");
  const remaining = (text.match(/^(<{7}|={7}|>{7})/gm) || []).length;
  console.log(`resolved: ${file} (remaining marker lines: ${remaining})`);
  changed++;
}
console.log(`done. files changed: ${changed}`);
