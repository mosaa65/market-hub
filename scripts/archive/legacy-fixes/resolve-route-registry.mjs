// حل تعارض الدمج في ملف واحد: نحتفظ بجانب HEAD (التعليق التوثيقي) لأن
// جانب الفرع فارغ في هذا الموضع.
import fs from 'node:fs';

const path = 'src/lib/navigation/route-registry.ts';
let text = fs.readFileSync(path, 'utf8');

const re = /<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>> origin\/feature\/enhanced-sidebar-and-welcome\r?\n/g;
text = text.replace(re, (_, head, branch) => {
  const b = branch.trim();
  return b ? `<<<<<<< HEAD\n${head}=======\n${branch}>>>>>>> origin/feature/enhanced-sidebar-and-welcome\n` : head;
});

// استعادة السطر الذي حذفه تعديل يدوي سابق بالخطأ.
text = text.replace(
  /<<<<<<< HEAD\n  \/\*\*\n\n   \* فئة `settings`/,
  '  /**\n   * قسم الإعدادات كان غائباً من هذا الترتيب تماماً.\n   *\n   * فئة `settings`',
);

fs.writeFileSync(path, text);
console.log('remaining markers:', (text.match(/<<<<<<<|>>>>>>>|=======/g) || []).length);
