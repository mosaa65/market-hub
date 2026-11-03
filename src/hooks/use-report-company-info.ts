import { useEffect, useState } from "react";
import { loadStatementCompany } from "@/lib/statements/company";
import { getCompanyCurrencySymbol } from "@/lib/format";

export interface ReportCompanyInfo {
  companyName: string;
  currencySymbol: string;
  loading: boolean;
}

export function useReportCompanyInfo(): ReportCompanyInfo {
  const [info, setInfo] = useState<ReportCompanyInfo>({
    companyName: "مؤسسة اليمامة التجارية",
    currencySymbol: getCompanyCurrencySymbol() || "ر.ي",
    loading: true,
  });

  useEffect(() => {
    let active = true;
    loadStatementCompany()
      .then((company) => {
        if (active) {
          setInfo({
            companyName: company.name || "مؤسسة اليمامة التجارية",
            currencySymbol: company.currencySymbol || "ر.ي",
            loading: false,
          });
        }
      })
      .catch(() => {
        if (active) {
          setInfo((prev) => ({ ...prev, loading: false }));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return info;
}
