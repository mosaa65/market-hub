# Printing Unused Settings — تحليل الإعدادات المهجورة

> النطاق: كل مفاتيح `localStorage`، الأعلام (flags)، معرفات القوالب، أوضاع
> الطباعة والحرارة، أصناف CSS، الأدوات المساعدة، والمكونات المرتبطة بالطباعة.
> المنهج: `grep` كامل على `src/`، مراجعة الـ imports، مفاتيح localStorage،
> JSON في قاعدة البيانات، المسارات، والاختبارات — قبل أي حذف.

---

## 1. مفاتيح `localStorage`

| المفتاح | التصنيف | يُقرأ من | يُكتب من | القرار |
| --- | --- | --- | --- | --- |
| `vortex_print_settings_v2` | ✅ مستخدم فعليًا | `printing/settings.ts` | `saveUnifiedPrintSettings` | يبقى — مصدر الحقيقة |
| `vortex_print_settings` | 🟡 Legacy / migration | `printing/settings.ts` (fallback) + `templates/settings-store.ts` | `settings-store` | يبقى للقراءة فقط — `normalizePrintSettings` يترحّل منه |
| `pos_default_template` | 🟡 مستخدم جزئيًا | `templates/settings-store.ts` | `settings-store` | يبقى — يُزامَن مع v2 |
| `pos_print_mode` | 🟡 Legacy / migration | `templates/settings-store.ts` | `settings-store` | يبقى — يُترجم إلى `behavior` |
| `company_settings_cache` | ✅ مستخدم فعليًا | `printing/company-profile.ts` + `milling/print.ts` + `app-shell.tsx` | `cacheCompanyProfile` / `setCompanySettingsCache` | يبقى |
| `vortex_sidebar_collapsed` | ✅ مستخدم فعليًا | `app-shell.tsx` | `app-shell.tsx` | يبقى (خارج نطاق الطباعة) |
| `vortex_milling_mode_v1` | ✅ مستخدم فعليًا | `lib/milling-mode.ts` | `milling-mode` | يبقى |
| `theme` | ✅ مستخدم فعليًا | نظام الثيم | نظام الثيم | يبقى |

**لا يوجد أي مفتاح طباعة غير مستخدم تمامًا.** كل المفاتيح أعلاه لها قارئ واحد
على الأقل، أو قارئ في مسار الترحيل.

---

## 2. معرفات القوالب (template IDs)

| القيمة | الحالة | المعالجة |
| --- | --- | --- |
| `standard` | ✅ مستخدم | → `renderUnifiedLayout` theme=`standard` |
| `unified-modern` | ✅ مستخدم | alias لـ `standard` |
| `elegant` | 🟡 Legacy alias | `normalizeTheme("elegant")` → `luxury` |
| `luxury` | ✅ مستخدم | theme=`luxury` |
| `premium` | 🟡 Legacy | يُطبَّع عبر `normalizeTheme` → `luxury` |
| `normal` | 🟡 Legacy | يُطبَّع عبر `normalizeTheme` → `standard` |
| `formal` | ✅ مستخدم | `renderFormalTemplate` |
| `thermal` | ✅ مستخدم | `renderThermalTemplate` |

`normalizeTheme` في `printing/themes.ts` هو نقطة التطبيع الوحيدة — لا فقدان
إعدادات عند الترقية.

---

## 3. أوضاع الطباعة (print modes)

| القيمة | الطبقة | الحالة |
| --- | --- | --- |
| `behavior: "default" \| "ask" \| "direct" \| "off"` | v2 | ✅ مستخدم في `printUnifiedDocument` و`shouldPreview` |
| `printMode: "auto" \| "ask" \| "off"` | v1 | 🟡 يُترجم في `normalizePrintSettings` |
| `method: "browser" \| "pdf" \| "thermal"` | v2 | ✅ مستخدم — كل قيمة لها `PrintAdapter` مسجّل |
| `autoPrintCustomerInvoice` | v1 | 🟡 يُقرأ في `printJob` فقط |
| `autoPrintInventoryDocument` | v1 | 🟡 يُقرأ في `printJob` فقط |
| `paperSize` | v1 | 🟡 يُشتق منه `paperId` |

**لم يُحذف أي وضع** — كلها إما مستخدمة أو مُترجَمة. `paperSize` يبقى لأن
`templates/index.ts::resolvePrintProfile` لا يزال يقرأه.

---

## 4. الأعلام (flags) وحقول `CustomFieldOptions`

| العلم | الحالة |
| --- | --- |
| `showLogo` | ✅ مستخدم في `unified-layout` |
| `showCompanyInfo` | ✅ مستخدم |
| `showCustomerInfo` | ✅ مستخدم |
| `showDocNumberDate` | ✅ مستخدم |
| `showMovementInfo` | ✅ مستخدم |
| `showFinancialDetails` | ✅ مستخدم |
| `showPaymentInfo` | ✅ مستخدم |
| `showNotes` | ✅ مستخدم |
| `showSignatures` | ✅ مستخدم |
| `showFooter` | ✅ مستخدم — يتحكم في `renderUniversalFooter` |
| `showBranding` | 🔴 **غير مؤثر** — `DEFAULT_BRANDING` أصبح `""`، والتوجل يظهر بلا أثر |

**التوصية:** إزالة `showBranding` من واجهة الإعدادات (لأنه لا يغيّر شيئًا بعد
إزالة اسم المنتج من القوالب) أو ربطه بـ `doc.brandingText` إن أراد المستخدم
نصًا تسويقيًا خاصًا. لم يُحذف بعد لأن حذفه تغيير في `PrintSettings` المُخزَّنة.

---

## 5. أصناف CSS

| الصنف | الحالة |
| --- | --- |
| `.page-container`, `.items-table`, `.totals-card`, `.cards-grid`, `.signatures-row` | ✅ مستخدم في `unified-layout.ts` |
| `.universal-footer` و`.footer-*` | ✅ مستخدم في `printing/footer.ts` |
| `.top-blue-corner-accent`, `.footer-banner-container`, `.footer-wave-svg`, `.outer-frame`, `.corner-accent` | 🔴 **حُذفت** — كانت في القالبين القديمين (`standard.ts` / `elegant.ts`) اللذين أصبحا واجهتين رفيعتين |
| `.rpt-head`, `.rpt-foot` | ✅ مستخدم في `report-print.ts` |
| `.age-chip`, `.sigs` | ✅ مستخدم في `statements/print-styles` |

---

## 6. الأدوات والمكونات

| العنصر | التصنيف | المعالجة |
| --- | --- | --- |
| `components/print-preview.tsx` | 🔴 **غير مستخدم** | حُذف — `UniversalPrintPreview` يحل مكانه |
| `components/universal-print-preview.tsx` | ✅ مستخدم | المعاينة الوحيدة |
| `lib/templates/standard.ts` | ✅ مستخدم | wrapper رفيع (30 سطرًا) |
| `lib/templates/elegant.ts` | 🟡 Legacy alias | يبقى — قيم قديمة محفوظة في localStorage |
| `lib/templates/thermal.ts` | ✅ مستخدم | قالب حراري |
| `lib/templates/inventory.ts` | ✅ مستخدم | قالب مستندات المخزون |
| `lib/templates/settings-store.ts` | 🟡 Legacy | يبقى — مصدر الترحيل + مزامنة POS |
| `lib/templates/paper-profiles.ts` | ✅ مستخدم | `resolvePrintProfile` |
| `lib/templates/tafqeet.ts` | ✅ مستخدم | المبلغ كتابةً |
| `renderInvoiceHTML` | 🟡 Legacy API | يبقى كـ backward-compatible wrapper |
| `printDocument` / `printJob` | 🟡 Legacy API | يبقى — `printJob` للطباعة المتعددة |
| `openStatementPrintWindow` | ✅ مستخدم | يفوّض إلى `openPrintWindow` |

---

## 7. بيانات قاعدة البيانات (JSON settings)

| العمود | الجدول | الحالة |
| --- | --- | --- |
| `footer_text`, `footer_contact`, `contact_numbers`, `logo_url`, `name_ar`, `name_en`, `legal_name`, `tax_number` | `company_settings` | ✅ تُقرأ في `printing/company-profile.ts` |
| `currency_symbol` | `company_settings` | ✅ تُقرأ في `company-profile` و`statements/company` |

الـ migration: `supabase/migrations/...61004000000_company_profile_printing_fields.sql`
يضيف `footer_text` و`footer_contact` و`contact_numbers`.

---

## 8. الخلاصة

- **حُذف فعليًا:** `components/print-preview.tsx`، أصناف CSS الخاصة بالقالبين
  القديمين، وقوالب HTML المكررة (~1700 سطرًا في `standard.ts` + `elegant.ts`).
- **يبقى لأسباب ترحيل:** `elegant` / `premium` / `normal`، `printMode`،
  `paperSize`، `templates/settings-store.ts`.
- **يبقى لأسباب توافق API:** `renderInvoiceHTML`، `printDocument`، `printJob`.
- **يحتاج قرارًا من المستخدم:** `showBranding` (غير مؤثر حاليًا).
- **لا يوجد مفتاح `localStorage` مهجور بلا قارئ.**
