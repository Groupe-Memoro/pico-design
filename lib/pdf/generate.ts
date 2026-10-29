import { PDFDocument, rgb, type PDFImage } from "pdf-lib";
import sharp from "sharp";
import { mmToPt, mmToPx } from "./units";
import { rasterizeLogoToPng } from "./logo";
import { addDropShadow } from "./logoShadow";
import type { LogoShadowSettings } from "../logoShadowSettings";
import { coverCropPipeline } from "./crop";
import { compositeLayers, type ResolvedLayer } from "./layers";
import type { LogoHAlign, LogoVAlign, Template } from "../types";

export interface GeneratePdfInput {
  template: Template;
  // null = pas de visuel de fond choisi (voir coverCropToBuffer) — un
  // montage fait seulement de calques reste possible.
  sourceImage: Buffer | null;
  logoImage: Buffer | null;
  positionX?: number;
  positionY?: number;
  // Zoom (recadrage) au-delà du minimum "cover" — voir coverCropToBuffer.
  // 1 = comportement d'origine (aucun appelant existant n'en envoie).
  zoom?: number;
  // Rotation du visuel lui-même (0/90/180/270) — voir coverCropToBuffer.
  // 0 = comportement d'origine.
  imageRotation?: number;
  // Image de verso (optionnelle) : ajoutée comme deuxième page du PDF.
  // Uniquement pertinent pour les modèles recto-verso.
  backImage?: Buffer | null;
  backPositionX?: number;
  backPositionY?: number;
  backZoom?: number;
  backImageRotation?: number;
  // Calques additionnels (texte/image), dans l'ordre d'empilement — voir
  // lib/design/layers.ts et lib/pdf/layers.ts. Absent/vide = comportement
  // d'origine (aucun calque).
  layers?: ResolvedLayer[];
  backLayers?: ResolvedLayer[];
  // Logo à afficher sur le verso, si le modèle est configuré pour ça
  // (`logo_on_back`) — indépendant du logo du recto, qui peut avoir sa
  // propre forme/couleur mais utilise le même fichier ici (voir
  // lib/pdf/productPdf.ts, qui décide quel côté reçoit `logoImage`).
  backLogoImage?: Buffer | null;
  // Ombre portée derrière le logo (recto et verso) ; null/absent = sans.
  logoShadow?: LogoShadowSettings | null;
}

/**
 * Construit un PDF prêt-pour-impression à partir d'une image source et d'un
 * modèle (dimensions + fond perdu + logo). L'image est recadrée en "cover"
 * pour remplir toute la page (fond perdu inclus) à la résolution demandée,
 * puis le logo Pico est superposé à la position configurée. Si `backImage`
 * est fourni, une deuxième page (verso, sans logo) est ajoutée.
 */
export async function generatePrintReadyPdf({
  template,
  sourceImage,
  logoImage,
  positionX = 0.5,
  positionY = 0.5,
  zoom = 1,
  imageRotation = 0,
  backImage = null,
  backPositionX = 0.5,
  backPositionY = 0.5,
  backZoom = 1,
  backImageRotation = 0,
  layers = [],
  backLayers = [],
  backLogoImage = null,
  logoShadow = null,
}: GeneratePdfInput): Promise<Buffer> {
  const pageWidthMm = template.width_mm + template.bleed_mm * 2;
  const pageHeightMm = template.height_mm + template.bleed_mm * 2;
  const targetPxWidth = mmToPx(pageWidthMm, template.dpi);
  const targetPxHeight = mmToPx(pageHeightMm, template.dpi);

  const pdfDoc = await PDFDocument.create();
  // Recto et verso reçoivent souvent le même fichier de logo : rendu et
  // intégré une seule fois, puis dessiné sur les deux pages.
  const logos = new Map<Buffer, Promise<PreparedLogo>>();

  await addImagePage(
    pdfDoc,
    template,
    sourceImage,
    positionX,
    positionY,
    targetPxWidth,
    targetPxHeight,
    logoImage,
    logoShadow,
    logos,
    zoom,
    imageRotation,
    layers
  );

  if (backImage) {
    await addImagePage(
      pdfDoc,
      template,
      backImage,
      backPositionX,
      backPositionY,
      targetPxWidth,
      targetPxHeight,
      backLogoImage,
      logoShadow,
      logos,
      backZoom,
      backImageRotation,
      backLayers
    );
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

async function addImagePage(
  pdfDoc: PDFDocument,
  template: Template,
  sourceImage: Buffer | null,
  positionX: number,
  positionY: number,
  targetPxWidth: number,
  targetPxHeight: number,
  logoImage: Buffer | null,
  logoShadow: LogoShadowSettings | null,
  logos: Map<Buffer, Promise<PreparedLogo>>,
  zoom = 1,
  imageRotation = 0,
  layers: ResolvedLayer[] = []
): Promise<void> {
  const pageWidthMm = template.width_mm + template.bleed_mm * 2;
  const pageHeightMm = template.height_mm + template.bleed_mm * 2;
  const pageWidthPt = mmToPt(pageWidthMm);
  const pageHeightPt = mmToPt(pageHeightMm);

  // Recadrer/redimensionner l'image source pour couvrir exactement la page
  // (fond perdu compris) à la résolution d'impression, au point focal
  // choisi par l'utilisateur, puis les calques additionnels (texte/image)
  // par-dessus, avant d'aplatir (l'image finale n'a plus besoin de canal
  // alpha une fois les calques posés). Un seul encodage avec perte, le JPEG
  // final : sans calques, le recadrage est encodé directement ; avec, l'étape
  // intermédiaire passe par un PNG (sans perte) que les calques recouvrent.
  const { pipeline } = await coverCropPipeline(
    sourceImage,
    targetPxWidth,
    targetPxHeight,
    positionX,
    positionY,
    zoom,
    imageRotation
  );
  const base =
    layers.length === 0
      ? pipeline
      : sharp(
          await compositeLayers(
            await pipeline.png({ compressionLevel: 1 }).toBuffer(),
            layers,
            targetPxWidth,
            targetPxHeight,
            template.dpi
          )
        );
  const fittedImage = await base.flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();

  // Marge d'impression : bande blanche ajoutée en plus, tout autour de la
  // page normale (fond perdu compris), pour certains formats qui en ont
  // besoin (ex. étuis de téléphone) — la page PDF est agrandie en
  // conséquence, l'image imprimée garde sa taille normale. Distincte de la
  // marge de protection (`safety_margin_*_mm`), qui reste un simple guide
  // visuel à l'écran et n'apparaît jamais dans le PDF.
  const printMarginXPt = mmToPt(template.print_margin_x_mm);
  const printMarginYPt = mmToPt(template.print_margin_y_mm);
  const totalPageWidthPt = pageWidthPt + printMarginXPt * 2;
  const totalPageHeightPt = pageHeightPt + printMarginYPt * 2;

  const page = pdfDoc.addPage([totalPageWidthPt, totalPageHeightPt]);
  if (printMarginXPt > 0 || printMarginYPt > 0) {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: totalPageWidthPt,
      height: totalPageHeightPt,
      color: rgb(1, 1, 1),
    });
  }

  const embeddedImage = await pdfDoc.embedJpg(fittedImage);
  page.drawImage(embeddedImage, {
    x: printMarginXPt,
    y: printMarginYPt,
    width: pageWidthPt,
    height: pageHeightPt,
  });

  if (!logoImage) return;

  const logoWidthPt = mmToPt(template.logo_width_mm);
  let prepared = logos.get(logoImage);
  if (!prepared) {
    prepared = prepareLogo(pdfDoc, logoImage, mmToPx(template.logo_width_mm, template.dpi), logoShadow);
    logos.set(logoImage, prepared);
  }
  const logo = await prepared;
  const logoAspect = logo.heightPx / logo.widthPx;
  const logoHeightPt = logoWidthPt * logoAspect;
  const marginXPt = mmToPt(template.logo_margin_x_mm + template.bleed_mm);
  const marginYPt = mmToPt(template.logo_margin_y_mm + template.bleed_mm);

  const { x, y } = logoPosition(
    template.logo_h_align,
    template.logo_v_align,
    pageWidthPt,
    pageHeightPt,
    logoWidthPt,
    logoHeightPt,
    marginXPt,
    marginYPt
  );

  // Avec ombre, le canevas déborde du logo de `pad` pixels de chaque côté :
  // on le décale d'autant pour que le logo reste exactement à sa position
  // (pad = 0 sans ombre, l'image est alors le logo lui-même).
  const ptPerPx = logoWidthPt / logo.widthPx;
  page.drawImage(logo.image, {
    x: x + printMarginXPt - logo.pad * ptPerPx,
    y: y + printMarginYPt - logo.pad * ptPerPx,
    width: logo.image.width * ptPerPx,
    height: logo.image.height * ptPerPx,
  });
}

interface PreparedLogo {
  // Image intégrée au PDF : le logo seul, ou le logo avec son ombre.
  image: PDFImage;
  // Taille du logo seul (sans l'ombre), qui fixe l'échelle.
  widthPx: number;
  heightPx: number;
  pad: number;
}

// N'intègre que l'image réellement dessinée : pdf-lib écrit dans le fichier
// toute image intégrée, même jamais utilisée.
async function prepareLogo(
  pdfDoc: PDFDocument,
  logoImage: Buffer,
  targetPx: number,
  logoShadow: LogoShadowSettings | null
): Promise<PreparedLogo> {
  const logoPng = await rasterizeLogoToPng(logoImage, targetPx);
  const meta = await sharp(logoPng).metadata();
  const widthPx = meta.width ?? targetPx;
  const heightPx = meta.height ?? targetPx;
  if (!logoShadow) return { image: await pdfDoc.embedPng(logoPng), widthPx, heightPx, pad: 0 };
  const shadowed = await addDropShadow(logoPng, logoShadow);
  return { image: await pdfDoc.embedPng(shadowed.png), widthPx, heightPx, pad: shadowed.pad };
}

function logoPosition(
  hAlign: LogoHAlign,
  vAlign: LogoVAlign,
  pageWidthPt: number,
  pageHeightPt: number,
  logoWidthPt: number,
  logoHeightPt: number,
  marginXPt: number,
  marginYPt: number
): { x: number; y: number } {
  const x =
    hAlign === "left"
      ? marginXPt
      : hAlign === "right"
      ? pageWidthPt - marginXPt - logoWidthPt
      : (pageWidthPt - logoWidthPt) / 2;

  const y = vAlign === "top" ? pageHeightPt - marginYPt - logoHeightPt : marginYPt;

  return { x, y };
}
