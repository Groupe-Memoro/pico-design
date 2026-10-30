/**
 * Contrôle d'un fichier de thème (graphisme ou fond) avant l'envoi : il doit
 * couvrir la page du modèle, fond perdu compris. Un fichier aux autres
 * proportions est agrandi sans déformation et recadré au centre (voir
 * composeThemeImage, cadrage 'cover') ; ce module dit ce qui sera coupé.
 * Sans dépendance serveur : utilisé par ThemeForm.
 */

export interface ThemePage {
  width_mm: number;
  height_mm: number;
  bleed_mm: number;
  dpi: number;
}

export type ThemeFileCheck =
  // Bonnes proportions (à 0,5 % près).
  | { kind: "ok"; dpi: number }
  // Proportions du format fini : fait sans fond perdu. Agrandi pour couvrir le
  // fond perdu, le bord du dessin tombe dans la coupe.
  | { kind: "no-bleed"; dpi: number; cropXMm: number; cropYMm: number }
  // Autres proportions : recadré au centre.
  | { kind: "crop"; dpi: number; cropXMm: number; cropYMm: number };

const TOLERANCE = 0.005;

export function themePageMm(t: ThemePage): { widthMm: number; heightMm: number } {
  return { widthMm: t.width_mm + 2 * t.bleed_mm, heightMm: t.height_mm + 2 * t.bleed_mm };
}

// Taille en pixels attendue à la résolution du modèle.
export function themePagePx(t: ThemePage): { width: number; height: number } {
  const { widthMm, heightMm } = themePageMm(t);
  return { width: Math.round((widthMm / 25.4) * t.dpi), height: Math.round((heightMm / 25.4) * t.dpi) };
}

export function checkThemeFile(fileW: number, fileH: number, t: ThemePage): ThemeFileCheck {
  const { widthMm, heightMm } = themePageMm(t);
  const fileRatio = fileW / fileH;
  const pageRatio = widthMm / heightMm;
  // Agrandi pour couvrir la page : ce qui dépasse, de chaque côté, en mm de la page.
  const scale = Math.max(widthMm / fileW, heightMm / fileH);
  const cropXMm = (fileW * scale - widthMm) / 2;
  const cropYMm = (fileH * scale - heightMm) / 2;
  // Résolution effective à l'impression.
  const dpi = Math.round(25.4 / scale);
  if (Math.abs(fileRatio / pageRatio - 1) <= TOLERANCE) return { kind: "ok", dpi };
  const trimRatio = t.width_mm / t.height_mm;
  if (t.bleed_mm > 0 && Math.abs(fileRatio / trimRatio - 1) <= TOLERANCE) return { kind: "no-bleed", dpi, cropXMm, cropYMm };
  return { kind: "crop", dpi, cropXMm, cropYMm };
}

/**
 * Passage d'un thème d'avant (graphisme étiré, 'fill') au recadrage sans
 * déformation ('cover'), sans renvoyer le fichier : chaque cadre (emplacement,
 * zone de texte) est déplacé et redimensionné pour rester sur la même partie
 * du graphisme. Avec 'fill', une position de la page (0-1) est la même
 * position dans le fichier ; avec 'cover', le fichier dépasse la page d'un
 * côté (recadré au centre). Un cadre tourné garde sa rotation : la correction
 * de ses proportions est alors approchée.
 */
export function fillToCover(fileW: number, fileH: number, t: ThemePage) {
  const { widthMm, heightMm } = themePageMm(t);
  const ratio = fileW / fileH / (widthMm / heightMm);
  // Taille du fichier sur la page, en fractions de la page (≥ 1 d'un côté).
  const kx = Math.max(1, ratio);
  const ky = Math.max(1, 1 / ratio);
  const x = (u: number) => (u - 0.5) * kx + 0.5;
  const y = (v: number) => (v - 0.5) * ky + 0.5;
  return {
    frame<F extends { positionX: number; positionY: number; widthRatio: number; heightRatio: number }>(f: F): F {
      return { ...f, positionX: x(f.positionX), positionY: y(f.positionY), widthRatio: f.widthRatio * kx, heightRatio: f.heightRatio * ky };
    },
    // Repère en mm sur la page.
    guide(axis: "v" | "h", posMm: number): number {
      return axis === "v" ? x(posMm / widthMm) * widthMm : y(posMm / heightMm) * heightMm;
    },
  };
}
