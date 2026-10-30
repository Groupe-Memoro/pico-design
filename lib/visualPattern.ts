import sharp from "sharp";

// Côté de l'image réduite analysée : assez pour juger les raccords, assez
// petit pour rester rapide (quelques ms par visuel).
const SIZE = 192;
// Un bord est « raccordé » quand son écart avec le bord opposé est plus près
// de l'écart entre deux colonnes voisines (continuité) que de l'écart entre
// deux colonnes sans rapport : 0 = raccord parfait, 1 = aucun lien.
const MAX_SEAM_SCORE = 0.35;
// Écart-type minimal (0-255) le long d'un bord pour qu'il ait du contenu : un
// logo sur fond blanc a des bords unis identiques, sans être un motif.
const MIN_EDGE_CONTENT = 6;
// Grille (n × n) du masque de contenu pour la recherche de répétition, et
// écart maximal (0 = identique, 1 = aucune superposition) d'un décalage qui
// « retombe » sur le motif.
const SHIFT_GRID = 48;
const MAX_REPEAT_SCORE = 0.25;

type Pixels = { data: Buffer; w: number; h: number };

function px(img: Pixels, x: number, y: number, c: number): number {
  return img.data[(y * img.w + x) * 3 + c];
}

// Écart moyen entre la colonne x1 et la colonne x2 (ou les rangées, si `rows`).
function lineDiff(img: Pixels, a: number, b: number, rows: boolean): number {
  const n = rows ? img.w : img.h;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      sum += rows ? Math.abs(px(img, i, a, c) - px(img, i, b, c)) : Math.abs(px(img, a, i, c) - px(img, b, i, c));
    }
  }
  return sum / (n * 3);
}

function lineStdDev(img: Pixels, at: number, rows: boolean): number {
  const n = rows ? img.w : img.h;
  const lum: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = rows ? [i, at] : [at, i];
    lum.push(0.299 * px(img, x, y, 0) + 0.587 * px(img, x, y, 1) + 0.114 * px(img, x, y, 2));
  }
  const mean = lum.reduce((s, v) => s + v, 0) / n;
  return Math.sqrt(lum.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
}

// Raccord sur un axe, de 0 (bords opposés continus) à 1 (sans rapport).
function seamScore(img: Pixels, rows: boolean): number {
  const len = rows ? img.h : img.w;
  const edge = lineDiff(img, 0, len - 1, rows);
  let near = 0;
  let far = 0;
  const half = Math.floor(len / 2);
  for (let i = 0; i < len - 1; i++) near += lineDiff(img, i, i + 1, rows);
  for (let i = 0; i < len - half; i++) far += lineDiff(img, i, i + half, rows);
  near /= len - 1;
  far /= len - half;
  // Image très régulière (colonnes voisines aussi différentes que lointaines) :
  // le raccord doit alors valoir une continuité ordinaire.
  if (far - near < 2) return edge <= near * 1.2 + 1 ? 0 : 1;
  return Math.max(0, (edge - near) / (far - near));
}

/**
 * Devine si un visuel est un motif répétable (raccord invisible à gauche/droite
 * et en haut/bas). Heuristique : un visuel détecté à tort se corrige à la main
 * dans sa fiche.
 */
export async function looksLikePattern(buffer: Buffer, isSvg: boolean): Promise<boolean> {
  const { data, info } = await sharp(buffer, isSvg ? { density: 150 } : undefined)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(SIZE, SIZE, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const img: Pixels = { data, w: info.width, h: info.height };

  const hasContent =
    lineStdDev(img, 0, false) >= MIN_EDGE_CONTENT ||
    lineStdDev(img, 0, true) >= MIN_EDGE_CONTENT;
  if (!hasContent) return repeatsOnPlainBackground(img);
  return seamScore(img, false) <= MAX_SEAM_SCORE && seamScore(img, true) <= MAX_SEAM_SCORE;
}

// Bords unis (ex. pois sur fond uni qui ne touchent pas les bords) : le raccord
// est alors trivial, comme pour un logo sur fond blanc. Ce qui les distingue :
// un motif se retrouve lui-même une fois décalé (ses éléments se répètent),
// un logo ou un badge, non.
function repeatsOnPlainBackground(img: Pixels): boolean {
  const bg = [0, 1, 2].map((c) => px(img, 0, 0, c));
  const isContent = (x: number, y: number) =>
    Math.abs(px(img, x, y, 0) - bg[0]) + Math.abs(px(img, x, y, 1) - bg[1]) + Math.abs(px(img, x, y, 2) - bg[2]) > 45;
  // Les quatre bords doivent être du même fond.
  for (let i = 0; i < img.w; i++) if (isContent(i, 0) || isContent(i, img.h - 1)) return false;
  for (let i = 0; i < img.h; i++) if (isContent(0, i) || isContent(img.w - 1, i)) return false;

  // Masque du contenu, réduit à une grille grossière pour essayer tous les décalages.
  const n = SHIFT_GRID;
  const mask = new Float32Array(n * n);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (isContent(x, y)) mask[Math.floor((y * n) / img.h) * n + Math.floor((x * n) / img.w)] += (n * n) / (img.w * img.h);
  const total = mask.reduce((a, v) => a + v, 0);
  if (total < n * n * 0.02) return false;

  // Écart entre l'image et elle-même décalée de (dx, dy), avec retour de
  // l'autre côté ; 2 × le contenu = aucune superposition.
  const wrap = (v: number) => ((v % n) + n) % n;
  const shiftDiff = (dx: number, dy: number) => {
    let d = 0;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) d += Math.abs(mask[y * n + x] - mask[wrap(y + dy) * n + wrap(x + dx)]);
    return d;
  };
  const half = n / 2;
  for (let dy = -half + 1; dy <= half; dy++) {
    for (let dx = -half + 1; dx <= half; dx++) {
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
      const d = shiftDiff(dx, dy);
      if (d > 2 * total * MAX_REPEAT_SCORE) continue;
      // Une forme unique (logo, badge) ressemble aussi à elle-même pour un petit
      // décalage, mais de moins en moins à mesure qu'on la décale. Un motif,
      // lui, retombe sur lui-même : nettement mieux qu'à mi-chemin.
      if (d <= 0.5 * shiftDiff(Math.round(dx / 2), Math.round(dy / 2))) return true;
    }
  }
  return false;
}

// Même chose, sans jamais faire échouer l'envoi d'un visuel.
export async function detectPattern(buffer: Buffer, contentType: string): Promise<boolean> {
  try {
    return await looksLikePattern(buffer, contentType === "image/svg+xml");
  } catch {
    return false;
  }
}
