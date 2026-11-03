import { supabase } from "@/integrations/supabase/client";

type ReturnKind = "sales" | "purchase";

export function quantityIncrementDecimals(increment: number) {
  const value = String(increment);
  const exponent = value.match(/e-(\d+)$/i);
  const decimals = exponent ? Number(exponent[1]) : (value.split(".")[1]?.length ?? 0);
  return Math.min(6, decimals);
}

/**
 * Add the remaining returnable entered quantity to each original invoice line.
 * Return rows store base quantities, while the source invoice may have been
 * entered in a package unit. Legacy returns without a source line are
 * conservatively deducted from each matching product, matching the posting RPC.
 */
export async function addReturnableQuantities<T extends {
  id: string;
  product_id: string;
  quantity: number | string;
  entered_quantity?: number | string | null;
  uom_conversion_factor?: number | string | null;
  uom_quantity_increment?: number | string | null;
}>(kind: ReturnKind, invoiceId: string, sourceLines: T[]) {
  if (!sourceLines.length) return [] as (T & {
    returnable_entered_quantity: number;
    returnable_quantity_increment: number;
  })[];

  const returnTable = kind === "sales" ? "sales_returns" : "purchase_returns";
  const itemTable = kind === "sales" ? "sales_return_items" : "purchase_return_items";
  const { data: returns, error: returnError } = await (supabase.from(returnTable) as any)
    .select("id")
    .eq("invoice_id", invoiceId);
  if (returnError) throw returnError;

  const returnIds = (returns ?? []).map((row: { id: string }) => row.id);
  const { data: returnedItems, error: itemsError } = returnIds.length
    ? await (supabase.from(itemTable) as any)
        .select("invoice_item_id,product_id,quantity")
        .in("return_id", returnIds)
    : { data: [], error: null };
  if (itemsError) throw itemsError;

  const exactReturned = new Map<string, number>();
  const legacyReturnedByProduct = new Map<string, number>();
  for (const returned of returnedItems ?? []) {
    const quantity = Number(returned.quantity) || 0;
    if (returned.invoice_item_id) {
      exactReturned.set(
        returned.invoice_item_id,
        (exactReturned.get(returned.invoice_item_id) ?? 0) + quantity,
      );
    } else {
      legacyReturnedByProduct.set(
        returned.product_id,
        (legacyReturnedByProduct.get(returned.product_id) ?? 0) + quantity,
      );
    }
  }

  return sourceLines.map((line) => {
    const factor = Number(line.uom_conversion_factor) || 1;
    const baseQuantity = Number(line.quantity) || 0;
    const alreadyReturned = (exactReturned.get(line.id) ?? 0)
      + (legacyReturnedByProduct.get(line.product_id) ?? 0);
    const remainingBase = Math.max(0, baseQuantity - alreadyReturned);
    const originalEntered = Number(line.entered_quantity ?? line.quantity) || 0;
    const increment = Number(line.uom_quantity_increment) || 0.001;
    const possibleEntered = Math.min(originalEntered, remainingBase / factor);
    const remainingEntered = Math.floor((possibleEntered + 1e-9) / increment) * increment;
    const precision = quantityIncrementDecimals(increment);
    return {
      ...line,
      returnable_entered_quantity: Number(remainingEntered.toFixed(precision)),
      returnable_quantity_increment: increment,
    };
  });
}
