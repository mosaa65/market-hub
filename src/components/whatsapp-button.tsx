import { openWhatsApp, normalizeWhatsAppPhone } from "@/lib/whatsapp";
import { useI18n } from "@/lib/i18n";
import { WhatsAppIcon } from "@/components/whatsapp-icon";

/**
 * زر «واتساب» موحّد — يفتح محادثة برسالة جاهزة.
 * يتعطّل تلقائيًا عندما لا يوجد رقم جوال صالح.
 */
export function WhatsAppButton({
  phone,
  message,
  label,
  className = "",
  stopPropagation = true,
}: {
  phone: string | null | undefined;
  message: string;
  /** نص بجانب الأيقونة (اختياري) */
  label?: string;
  className?: string;
  stopPropagation?: boolean;
}) {
  const { lang } = useI18n();
  const valid = normalizeWhatsAppPhone(phone) !== null;
  const title = valid
    ? lang === "ar"
      ? "إرسال عبر واتساب"
      : "Send via WhatsApp"
    : lang === "ar"
      ? "لا يوجد رقم جوال صالح"
      : "No valid phone number";

  return (
    <button
      type="button"
      disabled={!valid}
      title={title}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        openWhatsApp(phone, message);
      }}
      className={
        className ||
        `inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-500 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40 ${
          label ? "" : "w-8 justify-center px-0"
        }`
      }
    >
      <WhatsAppIcon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
