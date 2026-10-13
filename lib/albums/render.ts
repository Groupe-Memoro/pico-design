import sharp from "sharp";
import { PDFDocument, type PDFImage } from "pdf-lib";
import { mmToPx } from "../pdf/units";
import type { AlbumGeometry, LaidOutPage, LayoutElement } from "./layout";
import { drawText, hexToRgb } from "./text";

/**
 * PDF d'impression d'un album, à partir de sa mise en page (lib/albums/layout.ts).
 * Chaque page fait le format fini plus le fond perdu ; ses boîtes TrimBox et
 * BleedBox le disent à l'imprimeur et à l'Imposition. Les photos sont
 * recadrées à la taille exacte de leur case, à 300 dpi.
 */

const MM_TO_PT = 72 / 25.4;
const PRINT_DPI = 300;
const DOWNLOAD_CONCURRENCY = 8;

type ImageElement = Extract<LayoutElement, { type: "image" }>;

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    })
  );
}

const imageKey = (el: ImageElement) => `${el.path}|${el.w.toFixed(2)}|${el.h.toFixed(2)}|${el.focus}`;

export async function renderAlbumPdf(
  g: AlbumGeometry,
  pages: LaidOutPage[],
  // Lit une photo du stockage ; null = introuvable (la case reste vide).
  loadImage: (path: string) => Promise<Buffer | null>,
  title: string
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator("Pico Design");

  // Toutes les photos d'abord, en parallèle : chaque fichier n'est lu qu'une
  // fois, et chaque recadrage (même photo, même case) n'est fait qu'une fois.
  const images = pages.flatMap((p) => p.elements).filter((e): e is ImageElement => e.type === "image" && Boolean(e.path));
  const sources = new Map<string, Buffer | null>();
  await pool([...new Set(images.map((e) => e.path!))], DOWNLOAD_CONCURRENCY, async (path) => {
    sources.set(path, await loadImage(path).catch(() => null));
  });
  const embedded = new Map<string, PDFImage | null>();
  const unique = [...new Map(images.map((e) => [imageKey(e), e])).values()];
  await pool(unique, 4, async (el) => {
    const source = sources.get(el.path!);
    if (!source) {
      embedded.set(imageKey(el), null);
      return;
    }
    try {
      const jpeg = await sharp(source)
        .rotate()
        .resize(Math.max(1, mmToPx(el.w, PRINT_DPI)), Math.max(1, mmToPx(el.h, PRINT_DPI)), {
          fit: "cover",
          position: el.focus === "top" ? "north" : sharp.strategy.attention,
        })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 90 })
        .toBuffer();
      embedded.set(imageKey(el), await doc.embedJpg(jpeg));
    } catch {
      embedded.set(imageKey(el), null);
    }
  });

  const widthPt = (g.widthMm + 2 * g.bleedMm) * MM_TO_PT;
  const heightPt = (g.heightMm + 2 * g.bleedMm) * MM_TO_PT;
  const bleedPt = g.bleedMm * MM_TO_PT;

  for (const laid of pages) {
    const page = doc.addPage([widthPt, heightPt]);
    page.setBleedBox(0, 0, widthPt, heightPt);
    page.setTrimBox(bleedPt, bleedPt, g.widthMm * MM_TO_PT, g.heightMm * MM_TO_PT);
    for (const el of laid.elements) {
      if (el.type === "rect") {
        page.drawRectangle({
          x: el.x * MM_TO_PT,
          y: heightPt - (el.y + el.h) * MM_TO_PT,
          width: el.w * MM_TO_PT,
          height: el.h * MM_TO_PT,
          color: hexToRgb(el.color),
        });
      } else if (el.type === "image") {
        const image = el.path ? embedded.get(imageKey(el)) : null;
        if (!image) continue;
        page.drawImage(image, {
          x: el.x * MM_TO_PT,
          y: heightPt - (el.y + el.h) * MM_TO_PT,
          width: el.w * MM_TO_PT,
          height: el.h * MM_TO_PT,
        });
      } else if (el.type === "line") {
        page.drawLine({
          start: { x: el.x1 * MM_TO_PT, y: heightPt - el.y1 * MM_TO_PT },
          end: { x: el.x2 * MM_TO_PT, y: heightPt - el.y2 * MM_TO_PT },
          thickness: el.widthPt,
          color: hexToRgb(el.color),
        });
      } else {
        drawText(page, el, heightPt);
      }
    }
  }
  return doc.save();
}
