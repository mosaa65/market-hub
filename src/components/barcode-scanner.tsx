import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { X, Camera, RotateCw, ScanBarcode } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  continuous?: boolean; // keep scanning after each detection
}

export function BarcodeScanner({ open, onClose, onDetected, continuous = false }: Props) {
  const { lang } = useI18n();
  const containerId = "bc-scanner-region";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [cameraId, setCameraId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [lastCode, setLastCode] = useState<string>("");
  const cooldownRef = useRef<number>(0);

  useEffect(() => {
    if (!open) return;
    setError("");
    Html5Qrcode.getCameras().then(list => {
      setCameras(list);
      const back = list.find(c => /back|rear|environment/i.test(c.label)) ?? list[list.length - 1];
      setCameraId(back?.id ?? list[0]?.id ?? "");
    }).catch(e => setError(String(e?.message ?? e)));
    return () => {
      const s = scannerRef.current;
      if (s) { s.stop().catch(() => {}).then(() => s.clear()); scannerRef.current = null; }
    };
  }, [open]);

  useEffect(() => {
    if (!open || !cameraId) return;
    const s = new Html5Qrcode(containerId, { verbose: false });
    scannerRef.current = s;
    s.start(
      cameraId,
      { fps: 15, qrbox: { width: 280, height: 140 }, aspectRatio: 1.6 },
      (decoded) => {
        const now = Date.now();
        if (now - cooldownRef.current < 900 && decoded === lastCode) return;
        cooldownRef.current = now;
        setLastCode(decoded);
        onDetected(decoded);
        if (!continuous) {
          s.stop().catch(() => {}).then(() => { s.clear(); onClose(); });
        }
      },
      () => {}
    ).catch(e => setError(String(e?.message ?? e)));
    return () => {
      s.stop().catch(() => {}).then(() => s.clear());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-background/90 backdrop-blur-md p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <ScanBarcode className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">{lang === "ar" ? "قراءة الباركود بالكاميرا" : "Scan barcode"}</div>
              <div className="text-[11px] text-muted-foreground">{lang === "ar" ? "وجّه الكاميرا نحو الباركود" : "Point the camera at a barcode"}</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-surface-2"><X className="h-4 w-4" /></button>
        </div>

        <div id={containerId} className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black" />

        {cameras.length > 1 && (
          <div className="mt-3 flex items-center gap-2">
            <Camera className="h-4 w-4 text-muted-foreground" />
            <select value={cameraId} onChange={e => setCameraId(e.target.value)} className="h-9 flex-1 rounded-full border border-border bg-surface px-3 text-xs">
              {cameras.map(c => <option key={c.id} value={c.id}>{c.label || c.id.slice(0, 8)}</option>)}
            </select>
            <button
              onClick={() => {
                const idx = cameras.findIndex(c => c.id === cameraId);
                setCameraId(cameras[(idx + 1) % cameras.length].id);
              }}
              className="grid h-9 w-9 place-items-center rounded-full border border-border hover:bg-surface-2"
              title={lang === "ar" ? "تبديل الكاميرا" : "Switch camera"}
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {lastCode && (
          <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-center font-mono text-xs text-emerald-500">
            ✓ {lastCode}
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-2 text-center text-xs text-destructive">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
