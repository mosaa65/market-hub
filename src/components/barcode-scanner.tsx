import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { X, Camera, RotateCw, ScanBarcode } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  continuous?: boolean;
}

const BARCODE_FORMATS = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
];

export function BarcodeScanner({ open, onClose, onDetected, continuous = false }: Props) {
  const { lang } = useI18n();
  const containerId = "barcode-camera-preview";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastDetectionRef = useRef({ code: "", at: 0 });
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [error, setError] = useState("");
  const [lastCode, setLastCode] = useState("");

  const stopScanner = useCallback(async (scanner: Html5Qrcode | null = scannerRef.current) => {
    if (!scanner) return;
    if (scannerRef.current === scanner) scannerRef.current = null;
    try { await scanner.stop(); } catch { /* Scanner might not have started yet. */ }
    try { await scanner.clear(); } catch { /* Its container may already be unmounted. */ }
  }, []);

  const close = useCallback(() => {
    void stopScanner();
    onClose();
  }, [onClose, stopScanner]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError("");
    setLastCode("");
    setCameraId("");

    Html5Qrcode.getCameras()
      .then(list => {
        if (cancelled) return;
        setCameras(list);
        const back = list.find(c => /back|rear|environment|خلف/i.test(c.label)) ?? list[list.length - 1] ?? list[0];
        if (!back) {
          setError(lang === "ar" ? "لم يتم العثور على كاميرا متاحة." : "No camera is available.");
          return;
        }
        setCameraId(back.id);
      })
      .catch(() => {
        if (!cancelled) setError(lang === "ar" ? "تعذر الوصول إلى الكاميرا. اسمح بإذن الكاميرا واستخدم اتصال HTTPS." : "Camera access failed. Allow camera permission and use HTTPS.");
      });

    return () => {
      cancelled = true;
      void stopScanner();
    };
  }, [lang, open, stopScanner]);

  useEffect(() => {
    if (!open || !cameraId) return;
    let cancelled = false;
    const scanner = new Html5Qrcode(containerId, { formatsToSupport: BARCODE_FORMATS, verbose: false });
    scannerRef.current = scanner;

    scanner.start(
      cameraId,
      {
        fps: 12,
        qrbox: (viewWidth, viewHeight) => ({ width: Math.min(viewWidth * 0.92, 380), height: Math.min(viewHeight * 0.48, 180) }),
        disableFlip: true,
      },
      (decoded) => {
        const now = Date.now();
        const previous = lastDetectionRef.current;
        if (decoded === previous.code && now - previous.at < 1200) return;
        lastDetectionRef.current = { code: decoded, at: now };
        setLastCode(decoded);
        onDetected(decoded);
        if (!continuous) close();
      },
      () => undefined,
    ).catch(() => {
      if (!cancelled) setError(lang === "ar" ? "تعذر بدء الكاميرا. جرّب اختيار كاميرا أخرى أو تحقق من الإذن." : "Could not start the camera. Try another camera or check its permission.");
    });

    return () => {
      cancelled = true;
      void stopScanner(scanner);
    };
  }, [cameraId, close, lang, onDetected, open, stopScanner]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-background/90 p-4 backdrop-blur-md" onClick={close} role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><ScanBarcode className="h-4 w-4" /></div>
            <div>
              <div className="text-sm font-semibold">{lang === "ar" ? "قراءة باركود المنتج" : "Scan product barcode"}</div>
              <div className="text-[11px] text-muted-foreground">{lang === "ar" ? "وجّه الخطوط داخل الإطار وانتظر لحظة" : "Place the bars inside the frame and hold still"}</div>
            </div>
          </div>
          <button onClick={close} className="rounded-full p-1.5 hover:bg-surface-2" aria-label={lang === "ar" ? "إغلاق" : "Close"}><X className="h-4 w-4" /></button>
        </div>

        <div id={containerId} className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black" />

        {cameras.length > 1 && (
          <div className="mt-3 flex items-center gap-2">
            <Camera className="h-4 w-4 text-muted-foreground" />
            <select value={cameraId} onChange={e => setCameraId(e.target.value)} className="h-9 flex-1 rounded-full border border-border bg-surface px-3 text-xs" aria-label={lang === "ar" ? "اختيار الكاميرا" : "Choose camera"}>
              {cameras.map(c => <option key={c.id} value={c.id}>{c.label || c.id.slice(0, 8)}</option>)}
            </select>
            <button onClick={() => setCameraId(cameras[(cameras.findIndex(c => c.id === cameraId) + 1) % cameras.length].id)} className="grid h-9 w-9 place-items-center rounded-full border border-border hover:bg-surface-2" title={lang === "ar" ? "تبديل الكاميرا" : "Switch camera"}>
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {lastCode && <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-center font-mono text-xs text-emerald-500">✓ {lastCode}</div>}
        {error && <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-2 text-center text-xs text-destructive">{error}</div>}
      </div>
    </div>
  );
}
