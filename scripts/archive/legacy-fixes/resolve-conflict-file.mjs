// حل تعارض في ملف واحد بأخذ جانب الفرع في كل المناطق (الميزة المطلوبة هي
// نسخة الفرع)، مع إبقاء ما لا يتعارض من HEAD كما هو.
import fs from 'node:fs';

const [file] = process.argv.slice(2);
let text = fs.readFileSync(file, 'utf8');

const re = /<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>> ([^\r\n]*)\r?\n/g;
let taken = 0, kept = 0, manual = 0;
text = text.replace(re, (_, head, branch) => {
  if (head.trim() === '' && branch.trim() !== '') { taken++; return branch; }
  if (branch.trim() === '' && head.trim() !== '') { kept++; return head; }
  // كلا الجانبين محتوى: نطبع الموضع ليُحل يدوياً
  manual++;
  return `<<<<<<< HEAD\n${head}=======\n${branch}>>>>>>> origin/MANUAL-REVIEW\n`;
});

fs.writeFileSync(file, text);
console.log(file, '→ taken-branch:', taken, 'kept-head:', kept, 'manual:', manual);
