import { useEffect, useMemo, useState } from "react";
import { MapPin, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getCachedCompanyProfile, cacheCompanyProfile } from "@/lib/printing/company-profile";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * فوتر الموقع — بيانات المنشأة الحقيقية (إنما سوفت)، والموقع ورقم التواصل في اليسار.
 */
const SITE_RIGHTS_TEXT = "تطوير وبرمجة إنما سوفت";

interface CompanyFooterInfo {
  name: string;
  phone: string;
  email: string;
  address: string;
  taxNumber: string;
  logo?: string;
}

function fromProfile(profile = getCachedCompanyProfile()): CompanyFooterInfo {
  const rawName = String(profile.name ?? "").trim();
  const name =
    !rawName || rawName === "My Company" || rawName.toLowerCase() === "my company"
      ? "إنما سوفت"
      : rawName;
  const rawAddress = String(profile.address ?? "").trim();
  const address =
    !rawAddress || rawAddress.includes("جلبة") || rawAddress.includes("اليمن")
      ? "إب - مفرق جبلة"
      : rawAddress;

  return {
    name,
    phone: String(profile.phone ?? "").trim() || (profile.contacts ?? [])[0] || "772217218",
    email: String(profile.email ?? "").trim(),
    address,
    taxNumber: String(profile.taxNumber ?? "").trim(),
    logo: String(profile.logoUrl ?? "").trim() || undefined,
  };
}

export function SiteFooter({ className }: { className?: string }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [info, setInfo] = useState<CompanyFooterInfo>(fromProfile);

  useEffect(() => {
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

      // تحديث تلقائي لو كانت القيمة الافتراضية القديمة ما تزال مخزنة
      if (!data.name || data.name === "My Company") {
        void supabase
          .from("company_settings")
          .update({ name: "إنما سوفت", address: "إب - مفرق جبلة" })
          .eq("id", 1);
        (data as Record<string, unknown>).name = "إنما سوفت";
        (data as Record<string, unknown>).address = "إب - مفرق جبلة";
      }

      cacheCompanyProfile(data as Record<string, unknown>);
      setInfo(fromProfile());
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
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {/* اليمين: الهوية واسم إنما سوفت والموقع (إب - مفرق جبلة) */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {info.logo && (
            <img
              src={info.logo}
              alt={info.name}
              className="h-5 w-auto max-w-[120px] shrink-0 object-contain"
            />
          )}
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

        {/* اليسار: رقم الهاتف بنفس الحجم مع أيقونته، وحقوق التطوير */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
          <span className="text-[9px] opacity-80" dir="rtl">
            {SITE_RIGHTS_TEXT}
          </span>
        </div>
      </div>
    </footer>
  );
}
