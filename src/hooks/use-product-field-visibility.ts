import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadProductFieldVisibility,
  resetProductFieldVisibility,
  saveProductFieldVisibility,
  type ProductFieldKey,
  type ProductFieldSurface,
  type ProductFieldVisibility,
} from "@/lib/product-field-visibility";

/**
 * تخصيص حقول المنتجات. يُحمّل من التخزين المحلي مرة واحدة، ثم يبثّ التغيير
 * لكل مستمع في نفس التبويب (مفتاح التخزين) حتى لو فُتحت نافذتان.
 */
export function useProductFieldVisibility() {
  const [state, setState] = useState<Record<ProductFieldSurface, ProductFieldVisibility>>(() =>
    loadProductFieldVisibility(),
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "market-hub:product-fields:v1") {
        setState(loadProductFieldVisibility());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback((surface: ProductFieldSurface, key: ProductFieldKey) => {
    setState((previous) => {
      const next: Record<ProductFieldSurface, ProductFieldVisibility> = {
        view: { ...previous.view },
        detail: { ...previous.detail },
        form: { ...previous.form },
      };
      next[surface] = { ...previous[surface], [key]: !previous[surface][key] };
      // الاسم العربي هو تعريف الصنف؛ إخفاؤه يجعل السطر بلا هوية.
      next[surface].nameAr = true;
      saveProductFieldVisibility(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setState(resetProductFieldVisibility());
  }, []);

  const isVisible = useCallback(
    (surface: ProductFieldSurface, key: ProductFieldKey) => state[surface][key],
    [state],
  );

  return useMemo(
    () => ({ visibility: state, isVisible, toggle, reset }),
    [state, isVisible, toggle, reset],
  );
}
