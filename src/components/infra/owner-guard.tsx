/**
 * حاجب الواجهة لسوبر أدمن المنصة — تكميلي لفحص الخادم الصارم في
 * src/lib/infra/functions.ts.
 */
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { getInfraAccess } from "@/lib/infra/functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function OwnerGuard({ children }: { children: React.ReactNode }) {
  const q = useQuery({
    queryFn: () => getInfraAccess() as Promise<{ allowed: boolean; userId: string | null }>,
    queryKey: ["infra-owner-check"],
    staleTime: 0,
    refetchOnMount: "always",
  });
  if (q.isLoading) return null;
  if (!q.data?.allowed) {
    return (
      <div className="container mx-auto p-8" dir="rtl">
        <Card className="mx-auto max-w-md border-red-500/30">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <ShieldAlert className="h-10 w-10 text-red-500" />
            <h2 className="font-bold">صلاحية غير كافية</h2>
            <p className="text-sm text-muted-foreground">
              أدوات النظام وDocker محصورة بسوبر أدمن المنصة النشط عند اختيار Docker. دور مالك
              المتجر لا يمنح صلاحية التحكم بالخادم، وكل العمليات محمية على الخادم ومسجّلة للتدقيق.
            </p>
            <Button variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
              إعادة التحقق من الصلاحية
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  return <>{children}</>;
}
