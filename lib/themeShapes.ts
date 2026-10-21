import type { ThemeSlot, ThemeSlotPoint, ThemeSlotShape } from "@/lib/types";

/**
 * Formes des emplacements de Thème (voir ThemeSlot.shape) : un seul endroit
 * pour les décrire, utilisé par l'éditeur admin (ThemeForm), l'aperçu du
 * client (ImageSourcePicker, en clip-path CSS) et le rendu imprimé
 * (lib/pdf/theme.ts, en masque SVG). Sans dépendance serveur : chargé aussi
 * côté navigateur.
 *
 * Les sommets d'un polygone sont en ratios 0-1 du RECTANGLE de
 * l'emplacement, pas de la page : déplacer ou redimensionner l'emplacement
 * déplace la forme avec lui.
 */

// Nombre d'emplacements d'un thème : autant qu'on veut, borné seulement
// pour garder les envois raisonnables (une photo par emplacement).
export const MAX_THEME_SLOTS = 50;

export const MIN_POLYGON_SIDES = 3;
// Même limite pour un polygone régulier (« Côtés ») et pour un tracé au clic.
export const MAX_POLYGON_SIDES = 50;
export const MAX_POINTS = 50;

/** Polygone régulier inscrit dans le rectangle, premier sommet en haut. */
export function regularPolygon(sides: number): ThemeSlotPoint[] {
  const n = Math.min(MAX_POLYGON_SIDES, Math.max(MIN_POLYGON_SIDES, Math.round(sides)));
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: round(0.5 + 0.5 * Math.cos(angle)), y: round(0.5 + 0.5 * Math.sin(angle)) };
  });
}

/** Forme effective : un polygone sans sommets valables retombe sur le rectangle. */
export function slotShape(slot: ThemeSlot): ThemeSlotShape {
  if (slot.shape === "svg" && slot.maskSvg) return "svg";
  if (slot.shape === "ellipse") return "ellipse";
  if (slot.shape === "polygon" && (slot.points?.length ?? 0) >= MIN_POLYGON_SIDES) return "polygon";
  return "rect";
}

// --- Masque SVG -----------------------------------------------------------
// Ce que DESSINE le SVG (son opacité, pas sa couleur) est la zone de la
// photo ; le reste est découpé. Il est étiré au rectangle de l'emplacement,
// comme le cercle et le polygone. Le fichier vient de l'admin mais finit
// affiché chez le client et rendu par le serveur : il est nettoyé (ni script,
// ni gestionnaire d'événement, ni ressource externe).

const MAX_MASK_SVG_CHARS = 200_000;

export function sanitizeMaskSvg(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_MASK_SVG_CHARS) return null;
  const start = raw.search(/<svg[\s>]/i);
  const end = raw.toLowerCase().lastIndexOf("</svg>");
  if (start < 0 || end < start) return null;
  let svg = raw.slice(start, end + 6);
  svg = svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|foreignObject|style)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|foreignObject)[^>]*\/>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // Liens : seulement vers le document lui-même (#id) ou une image intégrée.
    .replace(/\s(xlink:)?href\s*=\s*("(?!#|data:image\/)[^"]*"|'(?!#|data:image\/)[^']*')/gi, "");
  if (!/^<svg[^>]*\sviewBox\s*=/i.test(svg)) {
    // Sans viewBox, on la tire de width/height pour pouvoir l'étirer.
    const root = svg.match(/^<svg[^>]*>/i)?.[0] ?? "";
    const w = parseFloat(root.match(/\swidth\s*=\s*["']?([\d.]+)/i)?.[1] ?? "");
    const h = parseFloat(root.match(/\sheight\s*=\s*["']?([\d.]+)/i)?.[1] ?? "");
    if (!(w > 0 && h > 0)) return null;
    svg = svg.replace(/^<svg/i, `<svg viewBox="0 0 ${w} ${h}"`);
  }
  if (!/^<svg[^>]*\sxmlns\s*=/i.test(svg)) svg = svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

/** Proportion largeur / hauteur de la viewBox d'un masque (1 à défaut). */
export function maskSvgAspect(svg: string): number {
  const vb = svg.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  const w = parseFloat(vb?.[1] ?? "");
  const h = parseFloat(vb?.[2] ?? "");
  return w > 0 && h > 0 ? w / h : 1;
}

/** Le masque à une taille donnée, étiré (sans garder ses proportions). */
export function maskSvgSized(svg: string, width: number | string, height: number | string): string {
  return svg.replace(/^<svg([^>]*)>/i, (_, attrs: string) => {
    const kept = attrs.replace(/\s(width|height|preserveAspectRatio)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    return `<svg${kept} width="${width}" height="${height}" preserveAspectRatio="none">`;
  });
}

/** Styles CSS de masque d'un emplacement « svg » (undefined pour les autres formes). */
export function slotMaskStyle(slot: ThemeSlot): Record<string, string> | undefined {
  if (slotShape(slot) !== "svg") return undefined;
  const url = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(maskSvgSized(slot.maskSvg!, "100%", "100%"))}")`;
  return {
    maskImage: url,
    WebkitMaskImage: url,
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
  };
}

/** clip-path CSS de la photo dans son emplacement (undefined = rectangle). */
export function slotClipPath(slot: ThemeSlot): string | undefined {
  const shape = slotShape(slot);
  if (shape === "ellipse") return "ellipse(50% 50% at 50% 50%)";
  if (shape === "polygon") {
    return `polygon(${slot.points!.map((p) => `${pct(p.x)} ${pct(p.y)}`).join(", ")})`;
  }
  return undefined;
}

/**
 * Contour SVG de la forme dans un rectangle de `width` × `height` (px), pour
 * le trait de l'aperçu et le masque du rendu imprimé.
 */
export function slotSvgShape(slot: ThemeSlot, width: number, height: number): string {
  const shape = slotShape(slot);
  if (shape === "ellipse") {
    return `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}"/>`;
  }
  if (shape === "polygon") {
    return `<polygon points="${slot.points!.map((p) => `${p.x * width},${p.y * height}`).join(" ")}"/>`;
  }
  return `<rect x="0" y="0" width="${width}" height="${height}"/>`;
}

/** Points SVG (attribut `points`) d'un polygone dans un rectangle donné. */
export function polygonPointsAttr(points: ThemeSlotPoint[], width: number, height: number): string {
  return points.map((p) => `${p.x * width},${p.y * height}`).join(" ");
}

/**
 * Forme lue depuis des données non fiables (formulaire, JSON enregistré) :
 * une forme inconnue ou un polygone invalide retombent sur le rectangle,
 * jamais d'erreur.
 */
export function sanitizeSlotShape(raw: { shape?: unknown; points?: unknown; maskSvg?: unknown }): Pick<ThemeSlot, "shape" | "points" | "maskSvg"> {
  if (raw.shape === "svg") {
    const maskSvg = sanitizeMaskSvg(raw.maskSvg);
    return maskSvg ? { shape: "svg", maskSvg } : {};
  }
  if (raw.shape === "ellipse") return { shape: "ellipse" };
  if (raw.shape === "polygon" && Array.isArray(raw.points)) {
    const points = raw.points
      .slice(0, MAX_POINTS)
      .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }));
    if (points.length >= MIN_POLYGON_SIDES) return { shape: "polygon", points };
  }
  return {};
}

// Angle ramené entre -180 et 180 degrés (0 si illisible), au dixième près.
export function normalizeRotation(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const a = ((((n + 180) % 360) + 360) % 360) - 180;
  return Math.round(a * 10) / 10;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function pct(n: number): string {
  return `${round(n * 100)}%`;
}
