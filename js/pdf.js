// Lecture slides from PDF (PDF.js, free). Loaded on demand.
let lib = null;
async function pdfjs() {
  if (lib) return lib;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = res; s.onerror = () => rej(new Error("تعذّر تحميل عارض PDF"));
    document.head.appendChild(s);
  });
  lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  return lib;
}

export async function openPdf(src) {
  const L = await pdfjs();
  const base = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const opts = typeof src === "string" ? { url: src } : src; // URL or {data: ArrayBuffer}
  return L.getDocument({ ...opts, cMapUrl: base + "cmaps/", cMapPacked: true, standardFontDataUrl: base + "standard_fonts/" }).promise;
}

export async function renderPage(doc, n, canvas) {
  const page = await doc.getPage(n);
  const w = canvas.parentElement.clientWidth || 600;
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, (w / base.width) * (window.devicePixelRatio || 1));
  const vp = page.getViewport({ scale });
  canvas.dir = "ltr"; // the app is RTL; an RTL canvas scrambles Arabic text drawn by PDF.js
  canvas.width = vp.width; canvas.height = vp.height;
  canvas.style.width = Math.min(w, vp.width / (window.devicePixelRatio || 1)) + "px";
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
}

export async function extractText(doc, maxChars = 40000) {
  let out = "";
  for (let i = 1; i <= doc.numPages && out.length < maxChars; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out += `\n[صفحة ${i}]\n` + tc.items.map((x) => x.str).join(" ");
  }
  return out.slice(0, maxChars);
}
