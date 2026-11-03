/**
 * useFormNavigationScope — يُفعّل التنقل بين الحقول بلوحة المفاتيح لشاشة واحدة.
 *
 * الاستخدام:
 *
 *   const scopeRef = useFormNavigationScope<HTMLDivElement>();
 *   return <div ref={scopeRef} data-form-nav-scope>…</div>;
 *
 * وكل حقل تريده في الترتيب يحمل `data-form-nav` — الاختيار بالسمة صريح عن
 * قصد: حقل بحث داخل بطاقة منتج لا يدخل ترتيب الدفع ما لم يُوسم.
 */
import { useEffect, useRef } from "react";
import { attachFormNavigation } from "@/lib/keyboard/form-navigation";

export function useFormNavigationScope<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const scope = ref.current;
    if (!scope) return;
    return attachFormNavigation(scope);
  }, []);

  return ref;
}
