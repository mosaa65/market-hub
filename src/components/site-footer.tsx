import { useEffect, useMemo, useState } from "react";
import { Globe2, Mail, MapPin, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getCachedCompanyProfile } from "@/lib/printing/company-profile";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * فوتر الموقع — بيانات المنشأة الحقيقية فقط.
 *
 * الهوية والاسم والهاتف والبريد والعنوان والرقم الضريبي تأتي من
 * `company_settings` (نفس مصدر الترويسة والفواتير) عبر Company Profile.
 * لا يوجد هنا أي اسم برنامج أو رقم دعم ثابت: هذا فوتر المنشأة، ويُرى من
 * كل مستخدم على كل شاشة.
 *
 * يُركَّب من `AppShell` أسفل مساحة العمل، ويُخفى تلقائيًا إذا كانت بيانات
 * المنشأة فارغة تمامًا (قاعدة جديدة لم تُضبط بعد) بدل أن يظهر إطار فارغ.
 */
interface CompanyFooterInfo {
  name: string;
  phone: string;
  email: string;
  address: string;
  taxNumber: string;
}

function fromProfile(): CompanyFooterInfo {
  const profile = getCachedCompanyProfile();
  return {
    name: String(profile.name ?? "").trim(),
    phone: String(profile.phone ?? "").trim() || (profile.contacts ?? []).join(" · "),
    email: String(profile.email ?? "").trim(),
    address: String(profile.address ?? "").trim(),
    taxNumber: String(profile.taxNumber ?? "").trim(),
  };
}

export function SiteFooter({ className }: { className?: string }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [info, setInfo] = useState<CompanyFooterInfo>(fromProfile);

  useEffect(() => {
    // Show the cached profile immediately, then refresh from the database so a
    // change made in Settings appears without a full reload.
    setInfo(fromProfile());
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("company_settings")
        .select("name,phone,email,address,tax_number")
        .order("id")
        .limit(1)
        .maybeSingle();
      if (cancelled || !data) return;
      const row = data as Record<string, unknown>;
      setInfo({
        name: String(row.name ?? "").trim(),
        phone: String(row.phone ?? "").trim(),
        email: String(row.email ?? "").trim(),
        address: String(row.address ?? "").trim(),
        taxNumber: String(row.tax_number ?? "").trim(),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasContent = useMemo(
    () => Boolean(info.name || info.phone || info.email || info.address || info.taxNumber),
    [info],
  );
  if (!hasContent) return null;

  return (
    <footer
      dir={isAr ? "rtl" : "ltr"}
      className={cn(
        "shrink-0 border-t border-border/60 bg-surface/80 px-3 py-2 text-[10px] text-muted-foreground backdrop-blur-sm",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-center gap-x-3 gap-y-1 sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {info.name && (
            <span className="truncate font-semibold text-foreground/90">{info.name}</span>
          )}
          {info.address && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="h-3 w-3 shrink-0 opacity-70" />
              <span className="truncate">{info.address}</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          {info.phone && (
            <a
              href={`tel:${info.phone.replace(/[^\d+]/g, "")}`}
              dir="ltr"
              className="inline-flex items-center gap-1 font-semibold text-foreground/80 transition-colors hover:text-foreground"
            >
              <Phone className="h-3 w-3" />
              <span>{info.phone}</span>
            </a>
          )}
          {info.email && (
            <a
              href={`mailto:${info.email}`}
              dir="ltr"
              className="hidden items-center gap-1 transition-colors hover:text-foreground sm:inline-flex"
            >
              <Mail className="h-3 w-3" />
              <span>{info.email}</span>
            </a>
          )}
          {info.taxNumber && (
            <span className="inline-flex items-center gap-1">
              <Globe2 className="h-3 w-3 opacity-70" />
              <span>
                {isAr ? "الرقم الضريبي" : "Tax No."}: <span dir="ltr">{info.taxNumber}</span>
              </span>
            </span>
          )}
        </div>
      </div>
    </footer>
  );
}
