import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { setCompanySettingsCache } from "@/lib/format";

/**
 * المصدر الواحد لعملة العرض في الواجهة.
 *
 * لا تُخزَّن العملة في المكوّنات المالية نفسها؛ بل تقرأ من إعدادات المنشأة
 * التي يغيّرها المالك/المدير. مفتاح React Query موحّد، لذلك لا يسبب استعماله
 * في أكثر من بطاقة طلبات متكررة.
 */
export function useCompanyCurrency() {
  const query = useQuery({
    queryKey: ["company-settings", "currency"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_settings")
        .select("currency,currency_symbol")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      setCompanySettingsCache(data);
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  return {
    currency: query.data?.currency?.trim() || "YER",
    currencySymbol: query.data?.currency_symbol?.trim() || "ر.ي",
    isLoading: query.isLoading,
  };
}
