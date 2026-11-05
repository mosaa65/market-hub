import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, MapPin, Search, Truck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { translateRpcError } from "@/lib/errors/rpc-errors";

/**
 * ثوابت الأصناف (المرحلة الرابعة)
 * ---------------------------------------------------------------------------
 * شاشة واحدة لإدارة ما يُقترح تلقائياً عند إضافة الصنف إلى الكشف:
 *   • المورد الافتراضي  → products.default_supplier_id
 *   • الموقع الافتراضي  → products.shelf_location
 *   • الوحدة الافتراضية → products.default_uom_id
 *
 * القاعدة الحاكمة: هذه إعدادات *اقتراح*، لا قيود. تغييرها هنا لا يمسّ أي
 * معاملة سابقة، وتغييرها داخل الكشف لا يمسّ هذه الإعدادات.
 */

interface ItemRow {
  id: string;
  name: string;
  name_ar: string | null;
  sku: string | null;
  shelf_location: string | null;
  default_supplier_id: string | null;
  default_uom_id: string | null;
  unit_id: string | null;
  base_uom_id: string | null;
}

interface SupplierRow {
  id: string;
  name: string;
  is_system: boolean | null;
}

interface UnitRow {
  id: string;
  name: string;
  name_ar: string | null;
  short_name: string | null;
}

interface ItemDefaultsSectionProps {
  canEdit?: boolean;
  lang?: string;
}

export function ItemDefaultsSection({ canEdit = true, lang = "ar" }: ItemDefaultsSectionProps) {
  const isAr = lang === "ar";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Record<string, Partial<ItemRow>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const itemsQuery = useQuery({
    queryKey: ["item-defaults-items"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("products") as any)
        .select(
          "id,name,name_ar,sku,shelf_location,default_supplier_id,default_uom_id,unit_id,base_uom_id",
        )
        .eq("is_active", true)
        .order("name")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as ItemRow[];
    },
  });

  const suppliersQuery = useQuery({
    queryKey: ["item-defaults-suppliers"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id,name,is_system")
        .eq("is_active", true)
        .order("name")
        .limit(1000);
      if (error) throw error;
      return ((data ?? []) as SupplierRow[]).filter((row) => row.is_system !== true);
    },
  });

  const unitsQuery = useQuery({
    queryKey: ["item-defaults-units"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units")
        .select("id,name,name_ar,short_name")
        .order("name")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as UnitRow[];
    },
  });

  const suppliers = suppliersQuery.data ?? [];
  const units = unitsQuery.data ?? [];

  const rows = useMemo(() => {
    const all = itemsQuery.data ?? [];
    const q = search.trim().toLocaleLowerCase();
    if (!q) return all.slice(0, 200);
    return all
      .filter((item) =>
        [item.name, item.name_ar, item.sku].some((value) =>
          (value ?? "").toLocaleLowerCase().includes(q),
        ),
      )
      .slice(0, 200);
  }, [itemsQuery.data, search]);

  const valueOf = <K extends keyof ItemRow>(item: ItemRow, key: K): ItemRow[K] =>
    (draft[item.id]?.[key] ?? item[key]) as ItemRow[K];

  const isDirty = (item: ItemRow) => Boolean(draft[item.id]);

  function patch(itemId: string, changes: Partial<ItemRow>) {
    setDraft((current) => ({ ...current, [itemId]: { ...current[itemId], ...changes } }));
  }

  function discard(itemId: string) {
    setDraft((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  async function save(item: ItemRow) {
    const changes = draft[item.id];
    if (!changes) return;
    setSavingId(item.id);
    try {
      const payload: Record<string, unknown> = {};
      if ("default_supplier_id" in changes)
        payload.default_supplier_id = changes.default_supplier_id || null;
      if ("shelf_location" in changes)
        payload.shelf_location = changes.shelf_location?.trim() || null;
      if ("default_uom_id" in changes) payload.default_uom_id = changes.default_uom_id || null;

      const { error } = await (supabase.from("products") as any).update(payload).eq("id", item.id);
      if (error) throw error;

      toast.success(
        isAr ? `تم حفظ ثوابت «${item.name_ar || item.name}»` : `Defaults saved for “${item.name}”`,
      );
      discard(item.id);
      await queryClient.invalidateQueries({ queryKey: ["item-defaults-items"] });
    } catch (error: any) {
      toast.error(
        translateRpcError(
          error,
          isAr ? "ar" : "en",
          isAr ? "تعذر حفظ ثوابت الصنف" : "Could not save item defaults",
        ),
      );
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Boxes className="size-4 text-primary" />
          {isAr ? "ثوابت الأصناف" : "Item defaults"}
        </CardTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {isAr
            ? "حدّد المورد والموقع والوحدة الافتراضية لكل صنف. تُقترح تلقائياً عند إضافة الصنف إلى الكشف، ويمكن تغييرها في أي معاملة دون التأثير على هذه الإعدادات."
            : "Set the default supplier, location and unit for each item. They are suggested automatically when the item is added to a statement, and can be changed per transaction without affecting these defaults."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={isAr ? "ابحث باسم الصنف أو الرمز…" : "Search by item name or code…"}
            className="h-10 rounded-xl ps-9"
          />
        </div>

        {itemsQuery.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {isAr ? "جارٍ تحميل الأصناف…" : "Loading items…"}
          </p>
        ) : itemsQuery.isError ? (
          <p className="py-6 text-center text-sm text-destructive">
            {isAr ? "تعذر تحميل الأصناف" : "Could not load items"}
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {isAr ? "لا توجد أصناف مطابقة" : "No matching items"}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/70">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-2/50 text-[11px] font-semibold text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-start">{isAr ? "الصنف" : "Item"}</th>
                  <th className="w-56 px-3 py-2.5 text-start">
                    <span className="inline-flex items-center gap-1">
                      <Truck className="size-3" />
                      {isAr ? "المورد الافتراضي" : "Default supplier"}
                    </span>
                  </th>
                  <th className="w-44 px-3 py-2.5 text-start">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" />
                      {isAr ? "الموقع الافتراضي" : "Default location"}
                    </span>
                  </th>
                  <th className="w-40 px-3 py-2.5 text-start">
                    {isAr ? "الوحدة الافتراضية" : "Default unit"}
                  </th>
                  <th className="w-24 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      <div className="font-semibold">
                        {isAr ? item.name_ar || item.name : item.name}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{item.sku || "—"}</div>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        aria-label={isAr ? "المورد الافتراضي" : "Default supplier"}
                        disabled={!canEdit}
                        value={valueOf(item, "default_supplier_id") ?? ""}
                        onChange={(event) =>
                          patch(item.id, { default_supplier_id: event.target.value || null })
                        }
                        className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs"
                      >
                        <option value="">{isAr ? "— بدون —" : "— none —"}</option>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        aria-label={isAr ? "الموقع الافتراضي" : "Default location"}
                        disabled={!canEdit}
                        value={valueOf(item, "shelf_location") ?? ""}
                        onChange={(event) => patch(item.id, { shelf_location: event.target.value })}
                        placeholder={isAr ? "الثلاجة / رف A-12" : "Fridge / shelf A-12"}
                        className="h-9 rounded-lg text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        aria-label={isAr ? "الوحدة الافتراضية" : "Default unit"}
                        disabled={!canEdit}
                        value={valueOf(item, "default_uom_id") ?? ""}
                        onChange={(event) =>
                          patch(item.id, { default_uom_id: event.target.value || null })
                        }
                        className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs"
                      >
                        <option value="">{isAr ? "— وحدة الأساس —" : "— base unit —"}</option>
                        {units.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {isAr ? unit.name_ar || unit.name : unit.name || unit.name_ar}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {isDirty(item) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => discard(item.id)}
                            aria-label={isAr ? "تراجع" : "Discard"}
                            title={isAr ? "تراجع" : "Discard"}
                          >
                            <Undo2 className="size-4" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          disabled={!canEdit || !isDirty(item) || savingId === item.id}
                          onClick={() => void save(item)}
                          className="rounded-lg"
                        >
                          {savingId === item.id
                            ? isAr
                              ? "جارٍ الحفظ…"
                              : "Saving…"
                            : isAr
                              ? "حفظ"
                              : "Save"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
