import { createHash } from "crypto";
import sharp from "sharp";
import type { Sharp } from "sharp";
import { pdfToPng } from "pdf-to-png-converter";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from "pdf-lib";

// Résolution de rendu, cohérente avec le DPI d'impression standard utilisé
// ailleurs dans l'app (voir lib/pdf/units.ts).
const PRINT_DPI = 300;
const PDF_POINTS_DPI = 72;
// pdf.js refuse une page de plus de 100 millions de pixels : un 30 × 40 po
// à 300 dpi les dépasse. Au-delà, la résolution baisse juste assez.
const MAX_RENDER_PIXELS = 95_000_000;
// Une photo reprise telle quelle n'a pas cette limite : seulement celle de la
// mémoire (un 36 × 36 po à 300 dpi fait environ 120 millions de pixels).
const MAX_DIRECT_PIXELS = 150_000_000;

export function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("utf8") === "%PDF-";
}

// Pages déjà converties, gardées le temps d'un design : l'aperçu, les
// mockups et le PDF repartent du même fichier, et la conversion par pdf.js
// peut prendre près d'une minute sur un grand format.
const RASTER_TTL_MS = 10 * 60 * 1000;
const RASTER_CACHE_MAX = 6;
const rasterCache = new Map<string, { at: number; image: Promise<Buffer> }>();

/**
 * Rasterise une page d'un PDF (la première par défaut) en image haute
 * résolution (300 dpi), pour permettre d'utiliser un PDF partout où l'app
 * attend une image matricielle (visuel de la banque, image de produit
 * uploadée...). Les autres pages sont ignorées. Renvoie un JPEG ou un PNG.
 */
export function rasterizePdfPage(buffer: Buffer, page = 1): Promise<Buffer> {
  const key = `${createHash("sha1").update(buffer).digest("hex")}:${page}`;
  const hit = rasterCache.get(key);
  if (hit && Date.now() - hit.at < RASTER_TTL_MS) return hit.image;
  const image = rasterize(buffer, page);
  rasterCache.set(key, { at: Date.now(), image });
  image.catch(() => rasterCache.get(key)?.image === image && rasterCache.delete(key));
  while (rasterCache.size > RASTER_CACHE_MAX) rasterCache.delete(rasterCache.keys().next().value as string);
  return image;
}

async function rasterize(buffer: Buffer, page: number): Promise<Buffer> {
  // Le cas courant d'un fichier d'impression : une page faite d'une seule
  // photo. Elle est reprise telle quelle, en quelques millisecondes, là où
  // pdf.js la décoderait en JavaScript (près d'une minute en 30 × 40 po).
  const direct = await extractSingleImagePage(buffer, page).catch(() => null);
  if (direct) return direct;

  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false }).catch(() => null);
  const size = doc?.getPage(page - 1)?.getSize();
  const fullScale = PRINT_DPI / PDF_POINTS_DPI;
  const budgetScale = size ? Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, size.width * size.height)) : fullScale;
  const pages = await pdfToPng(buffer, {
    pagesToProcess: [page],
    viewportScale: Math.min(fullScale, budgetScale),
    // Ne pas mettre `disableFontFace: false` : hors navigateur, pdf.js ne sait
    // pas charger les polices TrueType intégrées et les remplace par des cases
    // barrées. Le réglage par défaut (true) dessine les glyphes en vectoriel.
  });
  const [rendered] = pages;
  if (!rendered?.content) {
    throw new Error("Impossible de convertir le PDF en image.");
  }
  return rendered.content;
}

// Opérateurs qui peignent quelque chose sur la page (texte, tracés, dégradés,
// images en ligne) : leur présence oblige à un vrai rendu.
const PAINT_OPERATORS = new Set(["f", "F", "f*", "B", "B*", "b", "b*", "S", "s", "BT", "sh", "BI", "Tj", "TJ", "'", '"']);

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

/**
 * Page faite d'une seule image (JPEG, ou pixels RVB/gris non compressés par
 * prédicteur), posée droite (sans rotation) : l'image elle-même, recadrée à la
 * page si elle déborde. null dès que la page contient autre chose — l'appelant
 * passe alors par pdf.js.
 */
async function extractSingleImagePage(buffer: Buffer, pageNumber: number): Promise<Buffer | null> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const page = doc.getPage(pageNumber - 1);
  if (page.getRotation().angle % 360 !== 0) return null;

  // Contenu de la page : un ou plusieurs flux, mis bout à bout.
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  let text = "";
  for (const stream of streams) {
    if (!(stream instanceof PDFRawStream)) return null;
    text += Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1") + "\n";
  }

  // Lecture minimale des opérateurs : pile q/Q, matrices cm, un seul Do.
  const tokens = text.split(/[\s]+/).filter(Boolean);
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const operands: string[] = [];
  let drawn: { name: string; ctm: Matrix } | null = null;
  for (const token of tokens) {
    if (/^[-+.\d]/.test(token) || token.startsWith("/")) {
      operands.push(token);
      continue;
    }
    if (token === "q") stack.push(ctm);
    else if (token === "Q") ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (token === "cm") {
      const m = operands.slice(-6).map(Number) as Matrix;
      if (m.length !== 6 || m.some((n) => !Number.isFinite(n))) return null;
      ctm = multiply(m, ctm);
    } else if (token === "Do") {
      if (drawn) return null;
      drawn = { name: (operands[operands.length - 1] ?? "").slice(1), ctm };
    } else if (PAINT_OPERATORS.has(token)) return null;
    // Le reste (gs, re, W, n, couleurs…) ne peint rien de visible seul.
    operands.length = 0;
  }
  if (!drawn) return null;
  const [a, b, c, d, e, f] = drawn.ctm;
  if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6 || a <= 0 || d <= 0) return null;

  const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
  const image = xobjects?.lookup(PDFName.of(drawn.name));
  if (!(image instanceof PDFRawStream)) return null;
  const dict = image.dict;
  if (dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Image")) return null;
  // Transparence, masque ou décodage inversé : vrai rendu.
  if (dict.has(PDFName.of("SMask")) || dict.has(PDFName.of("Mask")) || dict.has(PDFName.of("Decode"))) return null;

  const filter = dict.lookup(PDFName.of("Filter"));
  const filters = filter instanceof PDFArray ? filter.asArray() : filter ? [filter] : [];
  const names = filters.map((x) => String(x));
  let source: Sharp;
  if (names.length >= 1 && names[names.length - 1] === "/DCTDecode") {
    // Un JPEG ordinaire, éventuellement compressé une seconde fois.
    const bytes = names.length === 1 ? image.contents : decodePDFRawStream(image).decode();
    source = sharp(Buffer.from(bytes)).toColourspace("srgb");
  } else if (names.length === 0 || (names.length === 1 && names[0] === "/FlateDecode")) {
    if (dict.has(PDFName.of("DecodeParms"))) return null;
    const bits = dict.lookup(PDFName.of("BitsPerComponent"));
    if (!(bits instanceof PDFNumber) || bits.asNumber() !== 8) return null;
    const width = (dict.lookup(PDFName.of("Width")) as PDFNumber).asNumber();
    const height = (dict.lookup(PDFName.of("Height")) as PDFNumber).asNumber();
    const pixels = Buffer.from(names.length ? decodePDFRawStream(image).decode() : image.contents);
    const channels = pixels.length / (width * height);
    if (channels !== 1 && channels !== 3) return null;
    source = sharp(pixels, { raw: { width, height, channels } });
  } else return null;

  // Place de l'image dans la page (en points), la page étant sa zone visible.
  // Résolution : celle de l'image elle-même (pas de rééchantillonnage quand
  // elle remplit la page), dans la limite de pixels.
  const imageWidth = (dict.lookup(PDFName.of("Width")) as PDFNumber).asNumber();
  const box = page.getCropBox();
  const scale = Math.min(imageWidth / a, Math.sqrt(MAX_DIRECT_PIXELS / Math.max(1, box.width * box.height)));
  const pageW = Math.max(1, Math.round(box.width * scale));
  const pageH = Math.max(1, Math.round(box.height * scale));
  const left = Math.round((e - box.x) * scale);
  const top = Math.round((box.y + box.height - (f + d)) * scale);
  const w = Math.max(1, Math.round(a * scale));
  const h = Math.max(1, Math.round(d * scale));

  // La partie de l'image qui tombe dans la page, complétée de blanc (une
  // image plus petite que la page laisse des bords blancs, comme pdf.js) —
  // en un seul passage, sans copie intermédiaire de l'image entière.
  const cropLeft = Math.max(0, -left);
  const cropTop = Math.max(0, -top);
  const cropW = Math.min(w - cropLeft, pageW - Math.max(0, left));
  const cropH = Math.min(h - cropTop, pageH - Math.max(0, top));
  if (cropW <= 0 || cropH <= 0) return null;
  const white = { r: 255, g: 255, b: 255, alpha: 1 };
  return source
    .resize(w, h, { fit: "fill" })
    .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
    .extend({
      left: Math.max(0, left),
      top: Math.max(0, top),
      right: Math.max(0, pageW - Math.max(0, left) - cropW),
      bottom: Math.max(0, pageH - Math.max(0, top) - cropH),
      background: white,
    })
    .flatten({ background: white })
    .jpeg({ quality: 95 })
    .toBuffer();
}
