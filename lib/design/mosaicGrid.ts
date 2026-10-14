// Grille d'une mosaïque de photos : limites partagées entre l'Outil Shopify
// (choix d'une grille personnalisée) et les routes de rendu, qui les
// imposent. Sans plafond côté serveur, une grille forgée (10 000 × 10 000)
// ferait construire des millions de cases à une route ouverte au public.

// Colonnes et rangées, chacune : au-delà, une photo par case devient
// illisible sur les formats Pico, et l'envoi dépasse vite le plafond d'octets
// du public (voir lib/uploadLimits.ts).
export const MAX_MOSAIC_SIDE = 6;

export function isValidMosaicSide(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_MOSAIC_SIDE;
}

// Une composition par volet (produit plié) est une mosaïque d'une seule
// rangée ou colonne : jusqu'à 8 volets (accordéon), au lieu du plafond par côté.
export const MAX_PANELS = 8;

export function isValidMosaicGrid(cols: number, rows: number, panels: boolean): boolean {
  if (panels) return Number.isInteger(cols) && Number.isInteger(rows) && cols >= 1 && rows >= 1 && cols * rows <= MAX_PANELS && Math.min(cols, rows) === 1;
  return isValidMosaicSide(cols) && isValidMosaicSide(rows);
}
