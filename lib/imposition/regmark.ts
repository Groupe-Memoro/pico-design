// Repère REG (registration mark) lu par la Duplo : un L noir dont le coin
// extérieur est posé à `sideMm` du bord latéral et `leadMm` du bord d'attaque
// de la feuille, dans le coin d'ancrage (le même que le code-barres). Mesuré sur
// une feuille imposée par Fiery (600 dpi) : branches de 6,0 mm, traits de 0,68 mm,
// coin à 6,39 mm des bords pour un job dont Side mark et Lead mark valent 6,4.
// Fonctions pures, partagées entre l'aperçu et le PDF.

export type RegCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const REG_MARK_ARM_MM = 6;
const REG_MARK_STROKE_MM = 0.68;

export interface MmRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Les deux traits du L, en mm, origine en haut à gauche de la feuille.
export function regMarkRects(
  corner: RegCorner,
  sideMm: number,
  leadMm: number,
  sheetWidth: number,
  sheetHeight: number
): [MmRect, MmRect] {
  const right = corner.endsWith("right");
  const bottom = corner.startsWith("bottom");
  // Coin extérieur du L, et sens dans lequel les branches partent vers l'intérieur.
  const ox = right ? sheetWidth - sideMm : sideMm;
  const oy = bottom ? sheetHeight - leadMm : leadMm;
  const dx = right ? -1 : 1;
  const dy = bottom ? -1 : 1;
  const rect = (w: number, h: number): MmRect => ({
    x: Math.min(ox, ox + dx * w),
    y: Math.min(oy, oy + dy * h),
    width: w,
    height: h,
  });
  return [rect(REG_MARK_ARM_MM, REG_MARK_STROKE_MM), rect(REG_MARK_STROKE_MM, REG_MARK_ARM_MM)];
}

// Vrai si le L tient entièrement sur la feuille.
export function regMarkFits(rects: MmRect[], sheetWidth: number, sheetHeight: number): boolean {
  return rects.every(
    (r) => r.x >= -0.01 && r.y >= -0.01 && r.x + r.width <= sheetWidth + 0.01 && r.y + r.height <= sheetHeight + 0.01
  );
}
