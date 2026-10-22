import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWhatsAppPhone,
  buildWhatsAppLink,
  isValidWhatsAppPhone,
  toAsciiDigits,
} from "../phone";
import { getAvailableCustomerActions } from "../action-resolver";
import { renderMessage } from "../template-engine";
import { buildUnifiedContext } from "../context-builder";

describe("Communication Engine — Phone Normalization", () => {
  it("converts Eastern Arabic and Persian digits to ASCII", () => {
    assert.equal(toAsciiDigits("٠١٢٣٤٥٦٧٨٩"), "0123456789");
    assert.equal(toAsciiDigits("۰۱۲۳۴۵۶۷۸۹"), "0123456789");
  });

  it("normalizes Yemeni local number with leading 0", () => {
    assert.equal(normalizeWhatsAppPhone("0771234567"), "967771234567");
    assert.equal(normalizeWhatsAppPhone("0731234567"), "967731234567");
    assert.equal(normalizeWhatsAppPhone("0711234567"), "967711234567");
  });

  it("normalizes Yemeni local number without 0", () => {
    assert.equal(normalizeWhatsAppPhone("771234567"), "967771234567");
    assert.equal(normalizeWhatsAppPhone("731234567"), "967731234567");
  });

  it("normalizes international Yemeni numbers with + and 00", () => {
    assert.equal(normalizeWhatsAppPhone("+967771234567"), "967771234567");
    assert.equal(normalizeWhatsAppPhone("00967771234567"), "967771234567");
    assert.equal(normalizeWhatsAppPhone("967771234567"), "967771234567");
  });

  it("handles other international numbers correctly", () => {
    assert.equal(normalizeWhatsAppPhone("+966501234567"), "966501234567");
    assert.equal(normalizeWhatsAppPhone("00966501234567"), "966501234567");
    assert.equal(normalizeWhatsAppPhone("+201012345678"), "201012345678");
  });

  it("strips spaces, dashes and brackets", () => {
    assert.equal(normalizeWhatsAppPhone("+967 77-123 4567"), "967771234567");
    assert.equal(normalizeWhatsAppPhone("(077) 123-4567"), "967771234567");
  });

  it("returns null for invalid or empty inputs", () => {
    assert.equal(normalizeWhatsAppPhone(null), null);
    assert.equal(normalizeWhatsAppPhone(""), null);
    assert.equal(normalizeWhatsAppPhone("abc"), null);
    assert.equal(normalizeWhatsAppPhone("12345"), null); // too short
  });

  it("never creates wa.me link without recipient", () => {
    assert.equal(buildWhatsAppLink(null, "Test message"), null);
    assert.equal(buildWhatsAppLink("", "Test message"), null);
    assert.equal(buildWhatsAppLink("invalid", "Test message"), null);

    const validLink = buildWhatsAppLink("771234567", "مرحبا");
    assert.ok(validLink?.startsWith("https://wa.me/967771234567?text="));
    assert.ok(validLink?.includes(encodeURIComponent("مرحبا")));
  });
});

describe("Communication Engine — Available Customer Actions Resolver", () => {
  it("enables payment request and debt reminder ONLY when customer has debt", () => {
    // 1. Customer with debt
    const actionsWithDebt = getAvailableCustomerActions({
      customer: {
        id: "c1",
        name: "محمد",
        phone: "771234567",
        balance: 15000,
        hasLedgerActivity: true,
      },
    });

    const paymentRequest = actionsWithDebt.find((a) => a.key === "payment_request");
    const debtReminder = actionsWithDebt.find((a) => a.key === "debt_reminder");

    assert.ok(paymentRequest, "Payment request must be available when balance > 0");
    assert.equal(paymentRequest?.enabled, true);
    assert.ok(debtReminder, "Debt reminder must be available when balance > 0");
    assert.equal(debtReminder?.enabled, true);

    // 2. Customer with zero debt
    const actionsZeroDebt = getAvailableCustomerActions({
      customer: {
        id: "c2",
        name: "علي",
        phone: "771234567",
        balance: 0,
        hasLedgerActivity: true,
      },
    });

    assert.equal(
      actionsZeroDebt.find((a) => a.key === "payment_request"),
      undefined,
      "Payment request must NEVER appear when balance is 0",
    );
    assert.equal(
      actionsZeroDebt.find((a) => a.key === "debt_reminder"),
      undefined,
      "Debt reminder must NEVER appear when balance is 0",
    );
  });

  it("disables statement actions when customer is new and has no ledger activity", () => {
    const actionsNewCustomer = getAvailableCustomerActions({
      customer: {
        id: "c3",
        name: "عميل جديد",
        phone: "771234567",
        balance: 0,
        hasLedgerActivity: false, // New customer without movements
      },
    });

    const statementShare = actionsNewCustomer.find((a) => a.key === "statement_share");
    const statementPdf = actionsNewCustomer.find((a) => a.key === "statement_export_pdf");

    assert.ok(statementShare);
    assert.equal(statementShare.enabled, false);
    assert.ok(statementShare.disabledReasonAr?.includes("لا توجد أي حركات"));

    assert.ok(statementPdf);
    assert.equal(statementPdf.enabled, false);
  });

  it("disables messaging when customer has no phone number and gives clear warning", () => {
    const actionsNoPhone = getAvailableCustomerActions({
      customer: {
        id: "c4",
        name: "عميل بدون هاتف",
        phone: null,
        balance: 5000,
        hasLedgerActivity: true,
      },
    });

    const paymentRequest = actionsNoPhone.find((a) => a.key === "payment_request");
    assert.ok(paymentRequest);
    assert.equal(paymentRequest.enabled, false);
    assert.equal(
      paymentRequest.disabledReasonAr,
      "هذا العميل لا يوجد لديه رقم هاتف مسجل في النظام",
    );
  });
});

describe("Communication Engine — Template Engine", () => {
  it("renders real company name from profile, never hardcoded brand", () => {
    const ctx = buildUnifiedContext({
      event: "payment_request",
      company: {
        name: "شركة الأمل للتجارة",
        arabicName: "شركة الأمل للتجارة",
        contacts: ["771111111"],
      },
      customer: {
        id: "c1",
        name: "أحمد علي",
        phone: "771234567",
        balance: 25000,
      },
    });

    const rendered = renderMessage(ctx);
    assert.ok(rendered.text.includes("شركة الأمل للتجارة"));
    assert.ok(!rendered.text.includes("فورتكس ERP"));
    assert.ok(rendered.canSendWhatsApp);
    assert.ok(rendered.whatsAppUrl?.startsWith("https://wa.me/967771234567"));
  });

  it("renders payment receipt with amount and remaining balance", () => {
    const ctx = buildUnifiedContext({
      event: "payment_received",
      company: {
        name: "مؤسسة النور",
        arabicName: "مؤسسة النور",
        contacts: ["772222222"],
      },
      customer: {
        id: "c2",
        name: "سالم",
        phone: "779999999",
        balance: 5000,
      },
      payment: {
        receiptNumber: "RC-1001",
        date: "2026-10-05",
        amount: 10000,
        method: "نقداً",
        remainingBalance: 5000,
      },
    });

    const rendered = renderMessage(ctx);
    assert.ok(rendered.text.includes("RC-1001"));
    assert.ok(rendered.text.includes("سند قبض"));
    assert.ok(rendered.text.includes("مؤسسة النور"));
  });
});
