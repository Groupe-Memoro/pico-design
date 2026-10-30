// Rendu PDF des cartes étudiantes : une page par face, au format exact de la
// carte (l'imprimante à cartes imprime bord à bord). Sur chaque face : le fond
// du graphiste, puis les zones — textes en contours vectoriels, photo de
// l'élève recadrée, code-barres vectoriel.

import sharp from "sharp";
import {
  PDFDocument,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFEmbeddedPage,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { mmToPt } from "@/lib/pdf/units";
import { loadInstance, preloadFonts } from "@/lib/pdf/textLayer";
import { fontOptionById } from "@/lib/design/fonts";
import { detectMarksKind } from "@/lib/imposition/marks";
import { barcodeGeometry, BarcodeError } from "./barcode";
import { fillContent, fitCardFontMm, zoneText, type CardSide, type CardZone, type VariableDataPage } from "./types";

// Cartes par requête : le navigateur envoie les élèves par lots (photos
// comprises, sous la limite de taille d'une requête) et assemble les PDF.
export const MAX_CARDS_PER_RENDER = 60;
// Résolution des photos dans le PDF : au-delà de ce que rend une imprimante à
// cartes (300 ppp), sans alourdir le fichier.
const PHOTO_DPI = 400;

type Background = { kind: "pdf"; page: PDFEmbeddedPage } | { kind: "image"; image: PDFImage };

export interface CardInput {
  row: Record<string, string>;
  photo: Buffer | null;
  // Pour les messages : « Ligne 12 (Léa Tremblay) ».
  label: string;
}

async function embedBackground(out: PDFDocument, bytes: Uint8Array | null, label: string): Promise<Background | null> {
  if (!bytes) return null;
  const kind = detectMarksKind(bytes);
  try {
    if (kind === "pdf") {
      const [page] = await out.embedPdf(await PDFDocument.load(bytes), [0]);
      return { kind: "pdf", page };
    }
    if (kind === "png") return { kind: "image", image: await out.embedPng(bytes) };
    if (kind === "jpg") return { kind: "image", image: await out.embedJpg(bytes) };
  } catch {
    // Illisible : signalé ci-dessous.
  }
  throw new Error(`Le fond ${label} du modèle est illisible : PDF, PNG ou JPEG attendu.`);
}

function hexToRgb(hex: string) {
  const v = parseInt(hex.slice(1), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

// Centre de la zone, en points PDF (origine en bas à gauche).
function zoneCenter(zone: CardZone, cardHeightMm: number) {
  return { x: mmToPt(zone.x + zone.width / 2), y: mmToPt(cardHeightMm - zone.y - zone.height / 2) };
}

// Contenu de la zone avant rotation : largeur et hauteur échangées à 90°/270°.
function contentSize(zone: CardZone) {
  const turned = zone.rotation % 180 !== 0;
  return { width: turned ? zone.height : zone.width, height: turned ? zone.width : zone.height };
}

// Repère local centré sur la zone, tourné dans le sens horaire de `rotation`.
function enterZone(page: PDFPage, zone: CardZone, cardHeightMm: number) {
  const c = zoneCenter(zone, cardHeightMm);
  const a = (zone.rotation * Math.PI) / 180;
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(1, 0, 0, 1, c.x, c.y),
    concatTransformationMatrix(Math.cos(a), -Math.sin(a), Math.sin(a), Math.cos(a), 0, 0)
  );
}

// Le texte en un seul chemin vectoriel, ajusté à la zone : la plus grande
// taille qui tienne, sans dépasser la maximale. Aligné à gauche ou à droite,
// le dessin des lettres touche le bord de la zone (l'approche de la première
// et de la dernière lettre est retirée).
function drawText(page: PDFPage, zone: CardZone, text: string, cardHeightMm: number) {
  const font = loadInstance(fontOptionById(zone.fontId), false, zone);
  const run = font.layout(text);
  const advance = run.glyphs.reduce((sum, g) => sum + g.advanceWidth, 0);
  const first = run.glyphs[0];
  const last = run.glyphs[run.glyphs.length - 1];
  const lsb = first ? first.bbox.minX : 0;
  const rsb = last ? last.advanceWidth - last.bbox.maxX : 0;
  const inkPerMm = Math.max(0, advance - lsb - rsb) / font.unitsPerEm;
  const heightPerMm = (font.ascent - font.descent) / font.unitsPerEm;
  const sizePt = mmToPt(fitCardFontMm(zone, inkPerMm, heightPerMm));
  const scale = sizePt / font.unitsPerEm;

  const boxW = mmToPt(contentSize(zone).width);
  const inkW = inkPerMm * sizePt;
  // Début du dessin (bord gauche de l'encre) par rapport au centre de la zone.
  const inkStart = zone.align === "left" ? -boxW / 2 : zone.align === "right" ? boxW / 2 - inkW : -inkW / 2;
  const startX = inkStart - lsb * scale;
  const baseline = ((font.ascent + font.descent) / 2 / font.unitsPerEm) * sizePt;

  let x = startX;
  let d = "";
  for (const glyph of run.glyphs) {
    d += glyph.path.scale(scale, -scale).translate(x, baseline).toSVG();
    x += glyph.advanceWidth * scale;
  }
  if (!d) return;
  enterZone(page, zone, cardHeightMm);
  page.drawSvgPath(d, { x: 0, y: 0, color: hexToRgb(zone.color), borderWidth: 0 });
  page.pushOperators(popGraphicsState());
}

function photoPixels(zone: CardZone) {
  const size = contentSize(zone);
  const px = (mm: number) => Math.max(1, Math.round((mm / 25.4) * PHOTO_DPI));
  return { width: px(size.width), height: px(size.height) };
}

// Masque d'une zone photo, à la taille de la photo : sa couche alpha seule
// (opaque : la photo paraît ; transparent : elle disparaît). Le masque est
// posé entier et centré ; autour, tout est transparent.
async function prepareMask(zone: CardZone, bytes: Buffer): Promise<Buffer> {
  const { width, height } = photoPixels(zone);
  return sharp(bytes)
    .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer();
}

// La photo recadrée pour remplir la zone (comme une photo d'identité),
// découpée par le masque de la zone s'il y en a un (PNG transparent).
async function drawPhoto(out: PDFDocument, page: PDFPage, zone: CardZone, photo: Buffer, cardHeightMm: number, mask?: Buffer) {
  const { width, height } = photoPixels(zone);
  const pipeline = sharp(photo)
    .rotate() // orientation EXIF des photos prises au téléphone
    .resize(width, height, { fit: "cover", position: "attention" })
    .flatten({ background: "#ffffff" });
  const image = mask
    ? await out.embedPng(await pipeline.joinChannel(mask, { raw: { width, height, channels: 1 } }).png().toBuffer())
    : await out.embedJpg(await pipeline.jpeg({ quality: 88 }).toBuffer());
  const size = contentSize(zone);
  const w = mmToPt(size.width);
  const h = mmToPt(size.height);
  enterZone(page, zone, cardHeightMm);
  page.drawImage(image, { x: -w / 2, y: -h / 2, width: w, height: h });
  page.pushOperators(popGraphicsState());
}

// Résolution maximale d'une image fixe dans le PDF.
const IMAGE_DPI = 600;

// Une image fixe (logo, signature…) intégrée une fois pour tout le PDF :
// réduite à la résolution utile, transparence gardée (PNG), recadrée pour
// couvrir sa zone si on l'a demandé.
async function embedZoneImage(out: PDFDocument, zone: CardZone, bytes: Buffer): Promise<{ image: PDFImage; width: number; height: number }> {
  const size = contentSize(zone);
  const px = (mm: number) => Math.max(1, Math.round((mm / 25.4) * IMAGE_DPI));
  let pipeline = sharp(bytes).rotate();
  pipeline =
    zone.fit === "cover"
      ? pipeline.resize(px(size.width), px(size.height), { fit: "cover" })
      : pipeline.resize(px(size.width), px(size.height), { fit: "inside", withoutEnlargement: true });
  const meta = await sharp(bytes).metadata();
  const png = meta.hasAlpha || meta.format === "png";
  const buffer = png ? await pipeline.png().toBuffer() : await pipeline.jpeg({ quality: 92 }).toBuffer();
  const image = png ? await out.embedPng(buffer) : await out.embedJpg(buffer);
  return { image, width: image.width, height: image.height };
}

// L'image dans sa zone : entière et centrée (« contain »), ou la remplissant.
function drawZoneImage(page: PDFPage, zone: CardZone, img: { image: PDFImage; width: number; height: number }, cardHeightMm: number) {
  const size = contentSize(zone);
  const boxW = mmToPt(size.width);
  const boxH = mmToPt(size.height);
  const scale = zone.fit === "cover" ? 1 : Math.min(boxW / img.width, boxH / img.height);
  const w = zone.fit === "cover" ? boxW : img.width * scale;
  const h = zone.fit === "cover" ? boxH : img.height * scale;
  enterZone(page, zone, cardHeightMm);
  page.drawImage(img.image, { x: -w / 2, y: -h / 2, width: w, height: h });
  page.pushOperators(popGraphicsState());
}

function drawBarcode(page: PDFPage, zone: CardZone, value: string, cardHeightMm: number) {
  const size = contentSize(zone);
  const g = barcodeGeometry(zone.barcodeType, value, size.width, size.height, zone.showText);
  const boxW = mmToPt(size.width);
  const boxH = mmToPt(size.height);
  // Linéaire : remplit la zone (proportions déjà accordées) ; 2D : contenu.
  const uniform = Math.min(boxW / g.viewWidth, boxH / g.viewHeight);
  const linear = !["qrcode", "datamatrix", "pdf417"].includes(zone.barcodeType);
  const sx = linear ? boxW / g.viewWidth : uniform;
  const sy = linear ? boxH / g.viewHeight : uniform;
  enterZone(page, zone, cardHeightMm);
  page.pushOperators(
    concatTransformationMatrix(sx, 0, 0, sy, 0, 0),
    concatTransformationMatrix(1, 0, 0, 1, -g.viewWidth / 2, g.viewHeight / 2)
  );
  const black = rgb(0, 0, 0);
  for (const p of g.paths) {
    if (p.strokeWidth) page.drawSvgPath(p.d, { x: 0, y: 0, borderColor: black, borderWidth: p.strokeWidth });
    else page.drawSvgPath(p.d, { x: 0, y: 0, color: black, borderWidth: 0 });
  }
  page.pushOperators(popGraphicsState());
}

/**
 * Les pages des lignes (cartes d'élèves, ou tout gabarit à données
 * variables), recto puis verso (si le modèle en a un) pour chacun.
 * Une valeur qu'un code-barres ne peut pas coder, ou une photo illisible,
 * n'arrête pas le lot : la carte sort sans, et c'est signalé dans `warnings`.
 */
export async function renderStudentCards(
  template: VariableDataPage,
  backgrounds: { front: Uint8Array | null; back: Uint8Array | null },
  cards: CardInput[],
  // Images fixes et masques des zones, par chemin (voir CardZone.imagePath
  // et CardZone.maskPath).
  images: Map<string, Buffer> = new Map()
): Promise<{ pdf: Buffer; warnings: string[] }> {
  const textZones = template.zones.filter((z) => z.kind === "text");
  await preloadFonts(textZones.map((z) => ({ fontId: z.fontId, bold: z.bold, weight: z.weight })));
  const out = await PDFDocument.create();
  const W = Number(template.width_mm);
  const H = Number(template.height_mm);
  const pageSize: [number, number] = [mmToPt(W), mmToPt(H)];
  const sides: CardSide[] = template.two_sided ? ["front", "back"] : ["front"];
  const bg = {
    front: await embedBackground(out, backgrounds.front, "du recto"),
    back: template.two_sided ? await embedBackground(out, backgrounds.back, "du verso") : null,
  };
  const warnings: string[] = [];
  // Images fixes : intégrées une fois, posées sur chaque carte.
  const zoneImages = new Map<string, { image: PDFImage; width: number; height: number }>();
  for (const zone of template.zones) {
    const bytes = zone.kind === "image" && zone.imagePath ? images.get(zone.imagePath) : undefined;
    if (!bytes) continue;
    try {
      zoneImages.set(zone.id, await embedZoneImage(out, zone, bytes));
    } catch {
      warnings.push("Une image du modèle est illisible : elle n'apparaît pas.");
    }
  }
  // Masques des zones photo : préparés une fois, appliqués à chaque photo.
  const photoMasks = new Map<string, Buffer>();
  for (const zone of template.zones) {
    const bytes = zone.kind === "photo" && zone.maskPath ? images.get(zone.maskPath) : undefined;
    if (!bytes) continue;
    try {
      photoMasks.set(zone.id, await prepareMask(zone, bytes));
    } catch {
      warnings.push("Un masque de photo est illisible : la photo sort sans.");
    }
  }

  for (const card of cards) {
    for (const side of sides) {
      const page = out.addPage(pageSize);
      const background = bg[side];
      const full = { x: 0, y: 0, width: pageSize[0], height: pageSize[1] };
      if (background?.kind === "pdf") page.drawPage(background.page, full);
      else if (background) page.drawImage(background.image, full);

      for (const zone of template.zones.filter((z) => z.side === side)) {
        if (zone.kind === "image") {
          const img = zoneImages.get(zone.id);
          if (img) drawZoneImage(page, zone, img, H);
        } else if (zone.kind === "text") {
          const text = zoneText(zone, card.row);
          if (text) drawText(page, zone, text, H);
        } else if (zone.kind === "photo") {
          if (!card.photo) continue;
          try {
            await drawPhoto(out, page, zone, card.photo, H, photoMasks.get(zone.id));
          } catch {
            warnings.push(`${card.label} : photo illisible.`);
          }
        } else {
          const value = fillContent(zone.content, card.row);
          if (!value) continue;
          try {
            drawBarcode(page, zone, value, H);
          } catch (err) {
            warnings.push(`${card.label} : ${err instanceof BarcodeError ? err.message : "code-barres impossible."}`);
          }
        }
      }
    }
  }
  return { pdf: Buffer.from(await out.save()), warnings };
}
