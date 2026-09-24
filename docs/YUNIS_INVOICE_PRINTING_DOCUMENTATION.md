# 🖨️ Vortex ERP - Invoice & Printing System Architecture & Documentation

> **Developer:** Yunis  
> **Branch:** `yunis-fixes`  
> **Module Scope:** Invoicing, Document Rendering, Printing Engine, and Template Registry  
> **Database Status:** ZERO Database Schema or Table Mutations (100% Client-Side & Local Storage Architecture)

---

## 📐 1. System Architecture Overview

The printing system in Vortex ERP is engineered with a strict separation of concerns to support **50+ templates** and **multiple document types** seamlessly.

```
┌─────────────────────────────────────────────────────────┐
│              Business Event (Sale / POS / Transfer)     │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Unified Document Data Model (UnifiedDocumentData)       │
│  - Document Metadata & Type (docType)                   │
│  - Line Items, Quantities, Units, Barcodes              │
│  - Financials (Subtotal, Tax, Discount, Total)          │
│  - Movement Info (Warehouse, Operator, Ref #)           │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│     Template Registry & Document Renderer Engine        │
│  - registerTemplate(meta, renderer)                     │
│  - getTemplateRenderer(id, docType)                     │
│  - renderDocumentHTML(doc, templateId, labels, options) │
└───────────────────────────┬─────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌──────────────────────┐        ┌────────────────────────┐
│ Customer Invoice     │        │ Inventory Document     │
│ (Thermal/A4/Luxury)  │        │ (Stock Issue/Transfer) │
└───────────┬──────────┘        └───────────┬────────────┘
            │                               │
            └───────────────┬───────────────┘
                            ▼
┌─────────────────────────────────────────────────────────┐
│     Print Job Dispatcher & Live Preview (PrintJob)      │
│  - Silent Hidden Iframe Printing                        │
│  - Live Interactive Real-Time Preview (PrintPreview)    │
│  - QZ Tray / Direct USB Printer Integration Ready       │
└─────────────────────────────────────────────────────────┘
```

---

## 📑 2. Document Types (أنواع المستندات)

The system introduces a flexible `DocumentType` system separating customer-facing documents from internal stock documents:

1. **Customer Invoice (`customer_invoice` - فاتورة العميل):**
   * **Purpose:** Customer-facing commercial document.
   * **Key Fields:** Store Name, Customer Details, Tax Number, Product List, Unit Prices, Line Totals, Discount, Tax, Grand Total, Paid/Balance, Payment Method, Contact Info.
2. **Inventory Document (`inventory_document` - مستند حركة المخزون):**
   * **Purpose:** Internal stock control document for warehouse keepers and audit logs.
   * **Key Fields:** Document Number, Operation Ref #, Date/Time, Movement Type (صرف مبيعات / تحويل / تسوية), Source & Destination Warehouses, Operator/User Name, SKU/Barcode, Product Description, Quantities, Units, Item Notes, Warehouse Signature Boxes.
3. **Future Extensible Document Types:**
   * `purchase_invoice` (فاتورة شراء)
   * `sales_return` (مردود مبيعات)
   * `purchase_return` (مردود مشتريات)
   * `stock_transfer` (تحويل مخزني)
   * `stock_receipt` (إذن استلام مخزني)
   * `stock_issue` (إذن صرف مخزني)
   * `payment_receipt` (سند قبض/صرف)
   * `quotation` (عرض سعر)
   * `delivery_note` (إذن تسليم)

---

## 🎨 3. Primary Templates (القوالب الأساسية)

Each template renderer is isolated into a modular file under `src/lib/templates/`:

1. **Thermal Receipt (`thermal` - POS 80mm / 58mm):**
   * High-contrast black & white CSS layout.
   * Compact spacing, clear item lines, bold totals.
   * Designed specifically for POS thermal roll printers.
2. **Standard A4 (`standard` - A4 / A5 Paper):**
   * Clean, professional, minimal business invoice layout.
   * High legibility, dark headers, subtle row borders.
3. **Luxury Gold (`elegant` - A4 Corporate Gold):**
   * Premium corporate layout with custom gold borders (`#b8935a`), Garamond serif typography, and gold-trimmed cards.
4. **Specialized Inventory Layouts (`inventory.ts`):**
   * Tailored layouts for stock issue and movement tracking with clear SKU columns, unit counts, and warehouse keeper signature blocks.

---

## ⚙️ 4. Print Customization Settings (إعدادات وتخصيص الطباعة)

Located in `src/routes/_app.settings.tsx` via the `<PrintSettingsCard />` component:

* **Default Template per Document Type:** Pick distinct default templates for Customer Invoices vs Inventory Documents.
* **Paper Sizes:** Support for `80mm`, `58mm`, `A4`, and `A5`.
* **Field Visibility Customization:**
  - `showLogo`: Show/Hide Store Logo
  - `showCompanyInfo`: Show/Hide Company Info & Tax Number
  - `showCustomerInfo`: Show/Hide Customer Info
  - `showDocNumberDate`: Show/Hide Doc Number & Date
  - `showMovementInfo`: Show/Hide Warehouse & Movement Type
  - `showFinancialDetails`: Show/Hide Tax & Discount Summary
  - `showPaymentInfo`: Show/Hide Payment Method & Paid/Balance
  - `showNotes`: Show/Hide Notes & Terms
  - `showSignatures`: Show/Hide Signature Boxes
  - `showFooter`: Show/Hide Footer
  - `showBranding`: Show/Hide Inama Soft Micro-Branding
* **Live Interactive Preview:** Full-screen dialog with real-time `srcDoc` iframe preview rendering the exact document output as settings are adjusted.

---

## 🔌 5. Direct Printing & Hardware Compatibility

1. **Browser Native Printing (Default):**
   - Renders document via a hidden, off-screen `<iframe>`.
   - Triggers `contentWindow.print()` without opening blank popups or new browser tabs.
   - 100% Arabic UTF-8 compliant using system Google Fonts (`Cairo`, `Amiri`, `IBM Plex Mono`).
2. **Direct Printing Integration (QZ Tray / WebUSB):**
   - The modular architecture exposes `renderDocumentHTML()` which can produce raw HTML or ESC/POS payloads for direct network/USB thermal printers via local printing utilities like **QZ Tray**.

---

## 🏷️ 6. Micro-Branding Requirement

All invoices, receipts, reports, and stock documents automatically append the required micro-branding in the footer:

```html
<div class="branding">Powered by Inama Soft - 772217218</div>
```

---

## 🧪 7. Extensibility Guide: Adding a New Template (How to add 50+ templates)

To add a new template (e.g. `minimalist_dark`):

1. Create renderer function in `src/lib/templates/minimalist.ts`:
   ```typescript
   export function renderMinimalistTemplate(doc: UnifiedDocumentData, L: InvoiceLabels, rtl: boolean): string {
     return `<!doctype html>...`;
   }
   ```
2. Register it in `src/lib/templates/index.ts`:
   ```typescript
   registerTemplate(
     {
       id: "minimalist_dark",
       nameAr: "داكن بسيط",
       nameEn: "Minimalist Dark",
       category: "custom",
       paperSize: "A4",
     },
     renderMinimalistTemplate
   );
   ```
3. That's it! The new template automatically becomes selectable in settings, preview, and print dialogs without modifying any core sales or POS logic.
