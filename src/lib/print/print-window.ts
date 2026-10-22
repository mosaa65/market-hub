/**
 * Shared print-window plumbing.
 *
 * Printing happens inside a hidden iframe so we never print the app shell
 * (sidebar / navbar / controls) and never open an extra about:blank tab.
 * Every print workflow (statements, reports, invoices) funnels through here
 * so there is exactly one place that owns the print lifecycle.
 */

export function openPrintWindow(html: string): void {
  if (typeof window === "undefined") return;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "print");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;inset:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(iframe);

  const cw = iframe.contentWindow;
  if (!cw) {
    iframe.remove();
    return;
  }

  const cleanup = () => iframe.remove();
  iframe.onload = () => {
    cw.focus();
    cw.print();
    window.setTimeout(cleanup, 1000);
  };
  cw.document.open();
  cw.document.write(html);
  cw.document.close();
}
