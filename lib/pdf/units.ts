// Conversion mm <-> points PDF (1 pouce = 72 points = 25.4 mm).
export const MM_TO_PT = 72 / 25.4;

export function mmToPt(mm: number): number {
  return mm * MM_TO_PT;
}

// Dimensions en pixels nécessaires pour imprimer `mm` à `dpi` (300 dpi = qualité impression standard).
export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

// Conversion mm <-> pouces, pour les champs de dimensions (stockées en mm).
export function mmToIn(mm: number): number {
  return mm / 25.4;
}

export function inToMm(inches: number): number {
  return inches * 25.4;
}

// Formatte une dimension en mm vers un affichage en pouces (ex. "3.54"").
// Trois décimales au plus : 1/8 po s'affiche 0.125, pas 0.13 (les zéros
// inutiles disparaissent : 3.5, pas 3.500).
export function formatIn(mm: number): string {
  return `${Math.round(mmToIn(mm) * 1000) / 1000}"`;
}
