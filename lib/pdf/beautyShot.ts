import sharp from "sharp";
import { XMLParser } from "fast-xml-parser";
import { coverCropToBuffer } from "./crop";
import { rasterizeLogoToPng } from "./logo";
import { logoOverlay } from "./logoShadow";
import { compositeLayers, type ResolvedLayer } from "./layers";
import type { LogoShadowSettings } from "../logoShadowSettings";
import type { Template } from "../types";
import { warpIntoQuad, type Quad } from "./quadWarp";
import { foldPanels, parseFold } from "../folds";

/**
 * Format "beauty shot" (repris du schéma Mediaclip gifting:beautyShot) :
 * un XML qui décrit un fond, un masque, la zone où vient se placer le
 * visuel du produit (imageZone/mesh) et une pile de surcouches (overlay,
 * ombre, ...) avec leur blend mode. Il remplace le duo masque + ombrage
 * dessiné à la main pour chaque modèle — le XML et les images qu'il
 * référence sont fournis ensemble par le graphiste.
 *
 * Ordre de montage, du bas vers le haut :
 *   underlay* → fond → design découpé par le masque → overlay*
 *
 * `underlay` est une extension au schéma Mediaclip, qui ne prévoit qu'un
 * fond unique. Une ombre portée livrée en image séparée déborde du produit
 * et doit passer derrière lui : sans cet élément, elle n'avait aucune place
 * dans la pile et l'asset restait déclaré mais jamais dessiné.
 *
 * Le mesh peut en théorie décrire un maillage de déformation (perspective)
 * — pour l'instant on ne gère que le cas rectangle (le plus courant), en
 * prenant le rectangle englobant des points du mesh. Un vrai mesh de
 * déformation demanderait un moteur de warp dédié, à ajouter plus tard si
 * un modèle en a besoin.
 */

export interface BeautyShotAsset {
  name: string;
  mimeType: string;
}

export interface BeautyShotOverlay {
  assetName: string;
  blendMode: string;
}

export interface BeautyShotZone {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  // Maillage de 4 points (2 × 2) : la zone est ce quadrilatère, en
  // perspective (haut-gauche, haut-droite, bas-droite, bas-gauche), et non
  // son rectangle englobant. Voir renderQuadZones.
  quad?: Quad;
}

export interface BeautyShotConfig {
  assets: BeautyShotAsset[];
  backgroundAssetName: string | null;
  maskAssetName: string | null;
  transparency: boolean;
  width: number;
  height: number;
  zones: BeautyShotZone[];
  // Couches posées SOUS le fond, dans l'ordre du XML. Extension au schéma
  // Mediaclip, qui ne connaît qu'un fond unique : une ombre portée est une
  // image à part, qui déborde du produit et doit passer derrière lui. Sans
  // ça, elle n'avait aucune place dans la pile et restait inutilisée.
  underlays: BeautyShotOverlay[];
  overlays: BeautyShotOverlay[];
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// Le XML déclare des tags préfixés (gifting:beautyShot) sans forcément
// garder le même préfixe partout — on cherche par suffixe plutôt que par
// clé exacte pour rester tolérant.
function findKey(obj: Record<string, unknown>, suffix: string): string | undefined {
  return Object.keys(obj).find((k) => k === suffix || k.endsWith(`:${suffix}`));
}

function assetNameFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  return url.startsWith("asset:") ? url.slice("asset:".length) : url;
}

function parseMeshBounds(meshText: string): { left: number; top: number; width: number; height: number; quad?: Quad } {
  const points = Array.from(meshText.matchAll(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g)).map((m) => ({
    x: parseFloat(m[1]),
    y: parseFloat(m[2]),
  }));
  if (points.length === 0) return { left: 0, top: 0, width: 0, height: 0 };
  // Mesh Mediaclip ligne par ligne : haut-gauche, haut-droite ; bas-gauche, bas-droite.
  const quad: Quad | undefined = points.length === 4 ? [points[0], points[1], points[3], points[2]] : undefined;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;
  return { left, top, width, height, quad };
}

export function parseBeautyShotXml(xml: string): BeautyShotConfig {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const rootKey = findKey(doc, "beautyShots") ?? "beautyShots";
  const root = (doc[rootKey] ?? doc) as Record<string, unknown>;

  const assetsKey = findKey(root, "assets");
  const assetsNode = assetsKey ? (root[assetsKey] as Record<string, unknown>) : {};
  const assets: BeautyShotAsset[] = asArray(assetsNode?.["asset"] as Record<string, unknown> | Record<string, unknown>[]).map(
    (a) => {
      const imageKey = findKey(a, "image");
      const image = imageKey ? (a[imageKey] as Record<string, unknown>) : {};
      return {
        name: String(a["@_name"] ?? ""),
        mimeType: String(image?.["@_mimeType"] ?? "image/png"),
      };
    }
  );

  const beautyShotKey = findKey(root, "beautyShot");
  const beautyShot = (beautyShotKey ? root[beautyShotKey] : undefined) as Record<string, unknown> | undefined;
  if (!beautyShot) {
    return {
      assets,
      backgroundAssetName: null,
      maskAssetName: null,
      transparency: true,
      width: 0,
      height: 0,
      zones: [],
      underlays: [],
      overlays: [],
    };
  }

  const zoneKey = findKey(beautyShot, "imageZone");
  const zones: BeautyShotZone[] = asArray(
    beautyShot[zoneKey ?? "imageZone"] as Record<string, unknown> | Record<string, unknown>[]
  ).map((z) => {
    const meshKey = findKey(z, "mesh");
    const meshText = meshKey ? String(z[meshKey] ?? "") : "";
    const bounds = parseMeshBounds(meshText);
    return { id: String(z["@_id"] ?? ""), ...bounds };
  });

  // `underlay` et `overlay` se lisent pareil : mêmes attributs, seule la
  // place dans la pile change. `findKey` cherche par suffixe, donc
  // « overlay » ne peut pas capter « underlay ».
  const couches = (suffix: string): BeautyShotOverlay[] =>
    asArray(
      beautyShot[findKey(beautyShot, suffix) ?? suffix] as Record<string, unknown> | Record<string, unknown>[]
    ).map((o) => ({
      assetName: assetNameFromUrl(String(o["@_url"] ?? "")) ?? "",
      blendMode: String(o["@_blendMode"] ?? "over"),
    }));

  const underlays = couches("underlay");
  const overlays = couches("overlay");

  return {
    assets,
    backgroundAssetName: assetNameFromUrl(beautyShot["@_backgroundUrl"] as string | undefined),
    maskAssetName: assetNameFromUrl(beautyShot["@_maskUrl"] as string | undefined),
    transparency: String(beautyShot["@_transparency"] ?? "true") === "true",
    width: parseInt(String(beautyShot["@_width"] ?? "0"), 10),
    height: parseInt(String(beautyShot["@_height"] ?? "0"), 10),
    zones,
    underlays,
    overlays,
  };
}

export function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

// Les images d'un bundle vivent TOUJOURS dans le même dossier que son XML.
// C'est ce qui permet de faire cohabiter deux conventions sans déplacer de
// fichier ni dupliquer le code de chargement : les bundles hérités sont
// sous `<templateId>/`, les nouveaux (plusieurs par modèle, voir la table
// template_mockups) sous `mockups/<mockupId>/`. On repart donc toujours du
// chemin du XML plutôt que d'un id.
export function beautyShotFolderOf(xmlPath: string): string {
  const parts = xmlPath.split("/");
  parts.pop();
  return parts.join("/");
}

// Chemin de stockage déterministe pour un asset donné : le nom de fichier
// original importe peu, seul le nom de l'asset (déclaré dans le XML) sert
// de clé, pour que ré-uploader un bundle sans changer tel ou tel visuel
// n'oblige pas à tout renvoyer.
export function beautyShotAssetPath(folder: string, assetName: string, mimeType: string): string {
  return `${folder}/beautyshot-${assetName}.${extensionForMimeType(mimeType)}`;
}

export function beautyShotXmlPath(folder: string): string {
  return `${folder}/beautyshot.xml`;
}

// Dossier d'un mockup de la table template_mockups (un par ligne), distinct
// du dossier hérité `<templateId>/` qui ne peut en contenir qu'un.
export function mockupFolder(mockupId: string): string {
  return `mockups/${mockupId}`;
}

// Noms d'assets réellement utilisés par le rendu (fond, masque, couches du
// dessous et du dessus) — les autres entrées de <assets> peuvent être
// ignorées. Cette liste décide de ce qui est téléversé ET de ce qui est
// chargé au rendu : un asset absent d'ici n'existe nulle part.
export function usedAssetNames(config: BeautyShotConfig): string[] {
  const names = new Set<string>();
  if (config.backgroundAssetName) names.add(config.backgroundAssetName);
  if (config.maskAssetName) names.add(config.maskAssetName);
  for (const couche of [...config.underlays, ...config.overlays]) names.add(couche.assetName);
  return Array.from(names);
}

// Modes de fusion que sharp accepte. Un nom inconnu — une majuscule, ou un
// mode Photoshop comme « linearBurn » — ne faisait rien à l'import et
// provoquait une erreur opaque au premier mockup.
const BLEND_MODES = new Set([
  "clear", "source", "over", "in", "out", "atop", "dest", "dest-over", "dest-in",
  "dest-out", "dest-atop", "xor", "add", "saturate", "multiply", "screen",
  "overlay", "darken", "lighten", "colour-dodge", "color-dodge", "colour-burn",
  "color-burn", "hard-light", "soft-light", "difference", "exclusion",
]);

/**
 * Ce qui empêcherait ce bundle de produire un mockup. Renvoie un message, ou
 * null si tout va bien.
 *
 * Appelé À L'IMPORT (voir lib/templateBeautyShotUpload.ts) et non seulement
 * au rendu : un XML amputé de son `width`, de son `height` ou de son `mesh`
 * s'enregistrait sans broncher, et n'échouait qu'au premier mockup, sur un
 * message qui ne disait pas quel fichier reprendre. Les mêmes règles que
 * generateBeautyShotMockupPng, mais énoncées au moment où on peut encore
 * corriger le fichier.
 */
export function beautyShotXmlError(config: BeautyShotConfig): string | null {
  if (config.width <= 0 || config.height <= 0) {
    return "Le XML ne déclare pas la taille de la scène : il manque width et height sur <beautyShot>.";
  }
  const zone = config.zones.find((z) => z.id === "front") ?? config.zones[0];
  if (!zone) return "Le XML ne contient aucune <imageZone> : rien n'indique où poser le visuel.";
  if (zone.width <= 0 || zone.height <= 0) {
    return `La zone « ${zone.id || "front"} » est vide : son <mesh> ne donne pas deux points distincts.`;
  }
  if (zone.left < 0 || zone.top < 0 || zone.left + zone.width > config.width || zone.top + zone.height > config.height) {
    return (
      `La zone d'image (${Math.round(zone.width)}×${Math.round(zone.height)} px à ` +
      `${Math.round(zone.left)},${Math.round(zone.top)}) sort de la scène ` +
      `(${config.width}×${config.height} px) : le mesh ne correspond pas à ce produit.`
    );
  }
  if (!config.backgroundAssetName) return "Le XML ne déclare pas de backgroundUrl : le mockup n'aurait pas de fond.";

  for (const couche of [...config.underlays, ...config.overlays]) {
    if (!couche.assetName) return "Une couche (underlay/overlay) n'a pas d'attribut url.";
    if (!BLEND_MODES.has(couche.blendMode)) {
      return `Mode de fusion inconnu pour « ${couche.assetName} » : « ${couche.blendMode} ». Attendu par exemple multiply, overlay, screen.`;
    }
  }
  return null;
}

export function mimeTypeForAsset(config: BeautyShotConfig, assetName: string): string {
  return config.assets.find((a) => a.name === assetName)?.mimeType ?? "image/png";
}

// Lit le champ "beautyShotOverlayOpacities" envoyé par TemplateForm (un
// tableau de nombres 0-100, JSON, un par surcouche du XML). Retourne null
// (= 100 % partout) si absent ou invalide — jamais d'erreur bloquante pour
// ce réglage facultatif.
export function parseOverlayOpacitiesField(raw: FormDataEntryValue | null): number[] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const values = parsed.map((v) => Number(v));
    if (values.some((n) => !Number.isFinite(n) || n < 0 || n > 100)) return null;
    return values;
  } catch {
    return null;
  }
}

/**
 * Bords du produit dans son masque, en fraction de la largeur et de la
 * hauteur (0.12 = le produit commence à 12 % du bord). C'est ce qu'il faut
 * donner comme marges de zone pour que le visuel occupe le produit et non
 * toute l'image — voir marginLeft/Right/Top/Bottom de
 * generateBeautyShotMockupPng.
 *
 * Le masque découpe par son canal alpha (composite "dest-in"), c'est donc
 * l'alpha qu'on mesure ; un masque opaque peint en noir et blanc est lu par
 * sa luminosité, sans quoi il paraîtrait plein d'un bord à l'autre.
 */
export async function maskHorizontalBounds(
  maskImage: Buffer
): Promise<{ left: number; right: number; top: number; bottom: number } | null> {
  // Réduit d'abord : au pixel près c'est inutile ici, et un masque de scène
  // fait plusieurs millions de pixels.
  const SAMPLE_WIDTH = 240;
  const { data, info } = await sharp(maskImage)
    .resize({ width: SAMPLE_WIDTH, fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  if (width < 2) return null;
  const alphaVaries = (() => {
    for (let i = channels - 1; i < data.length; i += channels) if (data[i] < 250) return true;
    return false;
  })();

  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const opaque = alphaVaries ? data[i + channels - 1] > 16 : (data[i] + data[i + 1] + data[i + 2]) / 3 > 16;
      if (!opaque) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) return null;

  return {
    left: minX / width,
    right: (width - 1 - maxX) / width,
    top: minY / height,
    bottom: (height - 1 - maxY) / height,
  };
}

// Retire une bordure symétrique pour ne garder que le rectangle centré
// demandé. Sans marge à retirer, l'image ressort telle quelle.
async function extractCentered(
  image: Buffer,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number
): Promise<Buffer> {
  if (fromWidth <= toWidth && fromHeight <= toHeight) return image;
  return sharp(image)
    .extract({
      left: Math.max(0, Math.round((fromWidth - toWidth) / 2)),
      top: Math.max(0, Math.round((fromHeight - toHeight) / 2)),
      width: Math.min(toWidth, fromWidth),
      height: Math.min(toHeight, fromHeight),
    })
    .png()
    .toBuffer();
}

async function buildDesignForZone(
  template: Template,
  // null = pas de visuel de fond choisi (voir coverCropToBuffer) — un
  // montage fait seulement de calques reste possible.
  sourceImage: Buffer | null,
  logoImage: Buffer | null,
  zoneWidthPx: number,
  zoneHeightPx: number,
  positionX: number,
  positionY: number,
  logoShadow: LogoShadowSettings | null,
  zoom = 1,
  imageRotation = 0,
  layers: ResolvedLayer[] = [],
  // Quelle tranche de l'imprimé la caméra voit (voir TemplateMockup.position_x) :
  // c'est un réglage du MOCKUP, distinct du cadrage du visuel sur la page.
  viewPositionX = 0.5,
  viewPositionY = 0.5,
  viewZoom = 1
): Promise<Buffer> {
  // Le mockup se fabrique en DEUX temps, comme dans la vraie vie : on
  // imprime la page, puis on photographie le produit.
  //
  // 1. L'imprimé : le visuel est cadré sur la page (format rogné + fond
  //    perdu) avec le cadrage du produit / du client — exactement la même
  //    géométrie que generateProductPreviewPng et generate.ts, donc le même
  //    résultat que l'aperçu et que le PDF. La marge d'impression n'y entre
  //    pas : ce n'est qu'une bande blanche ajoutée autour de la page au
  //    moment du PDF, absente du produit fini.
  // 2. La prise de vue : l'imprimé rogné est posé dans la zone du mesh, qui
  //    n'en montre souvent qu'une tranche (une tasse ne se voit que d'un
  //    côté à la fois) — c'est viewPositionX qui choisit laquelle.
  //
  // Sauter l'étape 1 (ce que faisait ce code) revenait à poser la photo
  // brute sur le produit : sur une tasse, le mockup montrait la photo
  // entière alors que l'impression n'en garde qu'une bande.
  const trimWidthMm = template.width_mm > 0 ? template.width_mm : 1;
  const trimHeightMm = template.height_mm > 0 ? template.height_mm : 1;
  // Résolution : juste ce qu'il faut pour couvrir la zone après l'étape 2,
  // sans agrandir inutilement.
  const pxPerMm = Math.max(zoneWidthPx / trimWidthMm, zoneHeightPx / trimHeightMm);
  const trimWidthPx = Math.max(1, Math.round(pxPerMm * trimWidthMm));
  const trimHeightPx = Math.max(1, Math.round(pxPerMm * trimHeightMm));
  const pageWidthPx = Math.max(1, Math.round(pxPerMm * (trimWidthMm + template.bleed_mm * 2)));
  const pageHeightPx = Math.max(1, Math.round(pxPerMm * (trimHeightMm + template.bleed_mm * 2)));
  // Une seule source de vérité pour tout ce qui se mesure en mm (calques,
  // logo) : la résolution de l'imprimé qu'on vient de fixer.
  const printDpi = pxPerMm * 25.4;

  const page = await coverCropToBuffer(
    sourceImage,
    pageWidthPx,
    pageHeightPx,
    positionX,
    positionY,
    zoom,
    imageRotation
  );
  // Les calques sont positionnés en ratios de la page, fond perdu compris
  // (voir DesignLayer) : ils se posent donc sur la page, avant le rognage.
  // Le logo, lui, se mesure depuis le bord de coupe et reste posé tout à la
  // fin.
  const withLayers = await compositeLayers(page, layers, pageWidthPx, pageHeightPx, printDpi);
  const trimmed = await extractCentered(withLayers, pageWidthPx, pageHeightPx, trimWidthPx, trimHeightPx);

  const composites: sharp.OverlayOptions[] = [];
  if (logoImage && template.logo_width_mm > 0) {
    const mmToPx = (mm: number) => Math.round((mm / 25.4) * printDpi);
    const logoWidthPx = Math.max(1, mmToPx(template.logo_width_mm));
    const rawLogoPng = await rasterizeLogoToPng(logoImage, logoWidthPx);
    const meta = await sharp(rawLogoPng).metadata();
    const nativeW = meta.width ?? logoWidthPx;
    const nativeH = meta.height ?? logoWidthPx;
    const logoHeightPx = Math.max(1, Math.round(nativeH * (logoWidthPx / nativeW)));
    const logoPng = await sharp(rawLogoPng).resize(logoWidthPx, logoHeightPx).png().toBuffer();

    const marginXPx = mmToPx(template.logo_margin_x_mm);
    const marginYPx = mmToPx(template.logo_margin_y_mm);
    const left =
      template.logo_h_align === "left"
        ? marginXPx
        : template.logo_h_align === "right"
        ? trimWidthPx - marginXPx - logoWidthPx
        : (trimWidthPx - logoWidthPx) / 2;
    const top = template.logo_v_align === "top" ? marginYPx : trimHeightPx - marginYPx - logoHeightPx;

    composites.push(
      await logoOverlay(
        logoPng,
        logoShadow,
        Math.round(Math.min(Math.max(left, 0), Math.max(trimWidthPx - logoWidthPx, 0))),
        Math.round(Math.min(Math.max(top, 0), Math.max(trimHeightPx - logoHeightPx, 0))),
        trimWidthPx,
        trimHeightPx
      )
    );
  }

  // L'imprimé est prêt (visuel cadré, calques, logo) : reste l'étape 2, le
  // poser dans la zone du mesh. La zone n'en montre souvent qu'une tranche,
  // choisie par viewPositionX — c'est ce qui distingue « vue de gauche » de
  // « vue de droite » sur une tasse.
  const printed = await sharp(trimmed)
    .flatten({ background: "#ffffff" })
    .composite(composites)
    .ensureAlpha()
    .png()
    .toBuffer();

  return coverCropToBuffer(printed, zoneWidthPx, zoneHeightPx, viewPositionX, viewPositionY, viewZoom, 0);
}

export async function generateBeautyShotMockupPng(
  template: Template,
  config: BeautyShotConfig,
  assets: Map<string, Buffer>,
  // null = pas de visuel de fond choisi (voir coverCropToBuffer) — un
  // montage fait seulement de calques reste possible.
  sourceImage: Buffer | null,
  logoImage: Buffer | null,
  positionX = 0.5,
  positionY = 0.5,
  logoShadow: LogoShadowSettings | null = null,
  // Intensité (0-100) de chaque surcouche, dans l'ordre de config.overlays —
  // le XML ne décrit qu'un mode de fusion, jamais d'opacité ; c'est ce qui
  // rendait les mockups tout ou rien (souvent trop sombres avec "multiply").
  // null/manquant/hors de 0-100 = 100 (comportement d'origine, inchangé).
  overlayOpacities: (number | null | undefined)[] | null = null,
  // Zoom (recadrage) au-delà du minimum "cover" — voir coverCropToBuffer.
  // 1 = comportement d'origine (aucun appelant existant n'en envoie).
  zoom = 1,
  // Rotation du visuel lui-même (0/90/180/270) — voir coverCropToBuffer.
  imageRotation = 0,
  layers: ResolvedLayer[] = [],
  // Où le visuel commence et s'arrête dans le mesh, en fraction de sa
  // largeur et de sa hauteur : le mesh couvre souvent toute la scène alors
  // que le produit (découpé par le masque) n'en occupe qu'une partie. Tout à
  // 0 = le visuel s'étale d'un bord à l'autre du mesh, comme avant.
  marginLeft = 0,
  marginRight = 0,
  marginTop = 0,
  marginBottom = 0,
  // Prise de vue : quelle tranche de l'imprimé ce mockup montre (0 = bord
  // gauche du visuel, donc vue de droite du produit ; 1 = bord droit). Rien
  // à voir avec positionX/positionY, qui cadrent le visuel sur la page.
  viewPositionX = 0.5,
  viewPositionY = 0.5,
  // Resserre la prise de vue sur l'imprimé (1 = la tranche entière).
  viewZoom = 1,
  // Côté montré par un produit plié ouvert (zones en perspective) : le
  // verso a ses volets dans l'ordre inverse (voir foldPanels).
  side: "front" | "back" = "front"
): Promise<Buffer> {
  const canvasWidth = Math.max(1, config.width);
  const canvasHeight = Math.max(1, config.height);
  const zone = config.zones.find((z) => z.id === "front") ?? config.zones[0];
  if (!zone || zone.width <= 0 || zone.height <= 0) {
    throw new Error("Le XML du beauty shot ne définit pas de zone d'image exploitable.");
  }
  // La zone (mesh) doit tenir dans la scène : sinon sharp refuse de la
  // composer ("Image to composite must have same dimensions or smaller"),
  // un message qui ne dit pas quoi corriger. En pratique c'est presque
  // toujours un bundle dont le mesh vient d'un autre produit (mesh d'étui
  // de téléphone laissé dans le XML d'une tasse, par exemple) — d'où un
  // message qui donne les deux tailles.
  if (
    zone.left < 0 ||
    zone.top < 0 ||
    zone.left + zone.width > canvasWidth ||
    zone.top + zone.height > canvasHeight
  ) {
    throw new Error(
      `Bundle mockup incohérent : la zone d'image du XML (${Math.round(zone.width)}×${Math.round(zone.height)} px ` +
        `à ${Math.round(zone.left)},${Math.round(zone.top)}) sort de la scène (${canvasWidth}×${canvasHeight} px). ` +
        `Le mesh du beauty shot ne correspond pas à ce produit.`
    );
  }

  // Zones en perspective (maillage de 4 points, ex. un dépliant ouvert) :
  // chaque zone reçoit un volet de l'imprimé, déformé dans son quadrilatère.
  // Sinon, la zone rectangulaire d'origine, avec marges et masque.
  const quadZones = config.zones.filter((z) => z.quad);
  let designComposites: sharp.OverlayOptions[];
  if (quadZones.length > 0) {
    designComposites = await renderQuadZones(template, quadZones, canvasWidth, canvasHeight, side, (w, h) =>
      buildDesignForZone(template, sourceImage, logoImage, w, h, positionX, positionY, logoShadow, zoom, imageRotation, layers, 0.5, 0.5, 1)
    );
  } else {
    // Rectangle réellement occupé par le visuel dans le mesh, une fois les
    // marges retirées. C'est lui qui sert de référence pour la résolution :
    // sinon le visuel serait calculé pour une surface qu'il n'occupe pas —
    // c'est ce qui l'agrandissait sur les tasses, dont le mesh couvre toute la
    // scène alors que la tasse n'en occupe que le milieu.
    const zoneWidth = Math.round(zone.width);
    const zoneHeight = Math.round(zone.height);
    const marginLeftPx = Math.round(zoneWidth * Math.min(0.9, Math.max(0, marginLeft)));
    const marginRightPx = Math.round(zoneWidth * Math.min(0.9, Math.max(0, marginRight)));
    const marginTopPx = Math.round(zoneHeight * Math.min(0.9, Math.max(0, marginTop)));
    const marginBottomPx = Math.round(zoneHeight * Math.min(0.9, Math.max(0, marginBottom)));
    const designWidth = Math.max(1, zoneWidth - marginLeftPx - marginRightPx);
    const designHeight = Math.max(1, zoneHeight - marginTopPx - marginBottomPx);

    const designInner = await buildDesignForZone(
      template,
      sourceImage,
      logoImage,
      designWidth,
      designHeight,
      // Cadrage du visuel SUR LA PAGE : celui du produit ou du client.
      positionX,
      positionY,
      logoShadow,
      zoom,
      imageRotation,
      layers,
      // Cadrage de la PRISE DE VUE : celui du mockup.
      viewPositionX,
      viewPositionY,
      viewZoom
    );

    // Replacé dans le mesh à sa marge : ce qui reste de part et d'autre est
    // transparent, et de toute façon découpé par le masque.
    const design =
      designWidth !== zoneWidth || designHeight !== zoneHeight
        ? await sharp({
            create: { width: zoneWidth, height: zoneHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
          })
            .composite([{ input: designInner, left: marginLeftPx, top: marginTopPx }])
            .png()
            .toBuffer()
        : designInner;

    const maskBuffer = config.maskAssetName ? assets.get(config.maskAssetName) : null;
    const maskedDesign = maskBuffer
      ? await sharp(design)
          .composite([
            {
              input: await sharp(maskBuffer)
                .resize(zoneWidth, zoneHeight, { fit: "fill" })
                .ensureAlpha()
                .png()
                .toBuffer(),
              blend: "dest-in",
            },
          ])
          .png()
          .toBuffer()
      : design;
    designComposites = [{ input: maskedDesign, left: Math.round(zone.left), top: Math.round(zone.top) }];
  }

  // La scène se monte du bas vers le haut : couches du dessous (une ombre
  // portée, typiquement), puis le fond, puis le design découpé, puis les
  // surcouches. Le fond n'est donc plus forcément la couche la plus basse.
  let composed = await sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } },
  })
    .png()
    .toBuffer();

  for (const underlay of config.underlays) {
    const buffer = assets.get(underlay.assetName);
    if (!buffer) continue;
    composed = await sharp(composed)
      .composite([
        {
          input: await sharp(buffer)
            .resize(canvasWidth, canvasHeight, { fit: "cover" })
            .ensureAlpha()
            .png()
            .toBuffer(),
          blend: underlay.blendMode as sharp.Blend,
        },
      ])
      .png()
      .toBuffer();
  }

  const backgroundBuffer = config.backgroundAssetName ? assets.get(config.backgroundAssetName) : null;
  if (backgroundBuffer) {
    composed = await sharp(composed)
      .composite([
        {
          input: await sharp(backgroundBuffer)
            .resize(canvasWidth, canvasHeight, { fit: "cover" })
            .ensureAlpha()
            .png()
            .toBuffer(),
        },
      ])
      .png()
      .toBuffer();
  }

  composed = await sharp(composed).composite(designComposites).png().toBuffer();

  for (let index = 0; index < config.overlays.length; index++) {
    const overlay = config.overlays[index];
    const overlayBuffer = assets.get(overlay.assetName);
    if (!overlayBuffer) continue;
    const rawOpacity = overlayOpacities?.[index];
    const opacity = typeof rawOpacity === "number" && rawOpacity >= 0 && rawOpacity <= 100 ? rawOpacity : 100;
    let overlayResized = await sharp(overlayBuffer)
      .resize(canvasWidth, canvasHeight, { fit: "fill" })
      .ensureAlpha()
      .png()
      .toBuffer();
    if (opacity < 100) {
      // Ne touche qu'au canal alpha (RGB inchangés) : réduit la présence de
      // la couche sans en délaver les teintes.
      overlayResized = await sharp(overlayResized)
        .linear([1, 1, 1, opacity / 100], [0, 0, 0, 0])
        .png()
        .toBuffer();
    }
    composed = await sharp(composed)
      .composite([{ input: overlayResized, blend: overlay.blendMode as sharp.Blend }])
      .png()
      .toBuffer();
  }

  if (!config.transparency) {
    composed = await sharp(composed).flatten({ background: "#ffffff" }).png().toBuffer();
  }

  return composed;
}

/**
 * Volets de l'imprimé posés en perspective, un par zone à 4 coins, de gauche
 * à droite (centre des zones) : les volets du recto selon le pli du modèle
 * (voir lib/folds.ts), à défaut des parts égales de sa largeur.
 */
async function renderQuadZones(
  template: Template,
  zones: BeautyShotZone[],
  canvasWidth: number,
  canvasHeight: number,
  side: "front" | "back",
  printAt: (widthPx: number, heightPx: number) => Promise<Buffer>
): Promise<sharp.OverlayOptions[]> {
  const ordered = [...zones].sort(
    (a, b) => a.quad!.reduce((n, p) => n + p.x, 0) - b.quad!.reduce((n, p) => n + p.x, 0)
  );
  // L'imprimé entier (format fini), un peu plus grand que le plus haut volet.
  const tallest = Math.max(...ordered.map((z) => Math.max(...z.quad!.map((p) => p.y)) - Math.min(...z.quad!.map((p) => p.y))));
  const printHeight = Math.max(64, Math.round(tallest * 1.25));
  const printWidth = Math.max(64, Math.round((printHeight * template.width_mm) / template.height_mm));
  const print = await printAt(printWidth, printHeight);

  const fold = parseFold(template.fold);
  const n = ordered.length;
  const ranges =
    fold && fold.direction === "vertical" && fold.panels === n
      ? foldPanels(fold, template.width_mm, side).map((p) => [p.start / template.width_mm, (p.start + p.size) / template.width_mm])
      : Array.from({ length: n }, (_, i) => [i / n, (i + 1) / n]);

  return Promise.all(
    ordered.map(async (zone, i) => {
      const [from, to] = ranges[i];
      const left = Math.round(from * printWidth);
      const width = Math.max(1, Math.min(printWidth - left, Math.round((to - from) * printWidth)));
      const panel = await sharp(print).extract({ left, top: 0, width, height: printHeight }).png().toBuffer();
      return { input: await warpIntoQuad(panel, zone.quad!, canvasWidth, canvasHeight), left: 0, top: 0 };
    })
  );
}
