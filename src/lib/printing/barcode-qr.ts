import QRCode from "qrcode";

/**
 * Generates a crisp Code 39 Barcode SVG synchronously without network requests.
 */
export function generateBarcodeSvg(value: string, height = 44): string {
  const narrow = 2;
  const wide = 5;
  const patterns: Record<string, string> = {
    "0": "nnnwwnwnn",
    "1": "wnnwnnnnw",
    "2": "nnwwnnnnw",
    "3": "wnwwnnnnn",
    "4": "nnnwwnnnw",
    "5": "wnnwwnnnn",
    "6": "nnwwwnnnn",
    "7": "nnnwnnwnw",
    "8": "wnnwnnwnn",
    "9": "nnwwnnwnn",
    A: "wnnnnwnnw",
    B: "nnwnnwnnw",
    C: "wnwnnwnnn",
    D: "nnnnwwnnw",
    E: "wnnnwwnnn",
    F: "nnwnwwnnn",
    G: "nnnnnwwnw",
    H: "wnnnnwwnn",
    I: "nnwnnwwnn",
    J: "nnnnwwwnn",
    K: "wnnnnnnww",
    L: "nnwnnnnww",
    M: "wnwnnnnwn",
    N: "nnnnwnnww",
    O: "wnnnwnnwn",
    P: "nnwnwnnwn",
    Q: "nnnnnnwww",
    R: "wnnnnnwwn",
    S: "nnwnnnwwn",
    T: "nnnnwnwwn",
    U: "wwnnnnnnw",
    V: "nwwnnnnnw",
    W: "wwwnnnnnn",
    X: "nwnnwnnnw",
    Y: "wwnnwnnnn",
    Z: "nwwnwnnnn",
    "-": "nwnnnnwnw",
    ".": "wwnnnnwnn",
    " ": "nwwnnnwnn",
    "/": "nwnwnwnnn",
    $: "nwnwnwnnn",
    "+": "nwnnnwnwn",
    "%": "nnnwnwnwn",
    "*": "nwnnwnwnn",
  };

  const safeVal = String(value || "0")
    .toUpperCase()
    .replace(/[^0-9A-Z\-.$/+% ]/g, "-");
  const fullText = `*${safeVal}*`;

  let bars = "";
  let x = 0;

  for (const ch of fullText) {
    const pattern = patterns[ch] ?? patterns["-"];
    for (let i = 0; i < pattern.length; i++) {
      const width = pattern[i] === "w" ? wide : narrow;
      if (pattern[i] === "n") {
        bars += `<rect x="${x}" y="0" width="${width}" height="${height}" fill="#000"/>`;
      }
      x += width;
    }
    x += narrow;
  }

  const totalWidth = x + 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height + 16}" width="${totalWidth}" height="${height + 16}" style="max-width:100%;height:auto;display:inline-block;" role="img" aria-label="${safeVal}">
    ${bars}
    <text x="${totalWidth / 2}" y="${height + 13}" font-family="monospace" font-size="10" text-anchor="middle" fill="#000">${safeVal}</text>
  </svg>`;
}

/**
 * Generates an SVG QR Code synchronously for invoices and receipts.
 */
export function generateQrCodeSvg(text: string, sizePx = 110): string {
  try {
    const qr = QRCode.create(text || "VORTEX-ERP", { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const margin = 2;
    const total = size + margin * 2;
    let path = "";

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (qr.modules.get(r, c)) {
          path += `M${c + margin} ${r + margin}h1v1h-1z `;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${sizePx}" height="${sizePx}" style="max-width:100%;height:auto;display:inline-block;" shape-rendering="crispEdges">
      <rect width="${total}" height="${total}" fill="#fff"/>
      <path fill="#000" d="${path}"/>
    </svg>`;
  } catch (err) {
    console.warn("Failed to generate QR code SVG:", err);
    return "";
  }
}
