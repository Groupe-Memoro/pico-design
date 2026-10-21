/**
 * Moteur d'impression commun aux modules multipages (Albums, Agendas) : une
 * page est une liste d'éléments posés en mm. L'aperçu à l'écran
 * (components/print/PagePreview.tsx) et le PDF (lib/print/render.ts) lisent
 * ces MÊMES boîtes : l'écran montre ce qui sera imprimé.
 *
 * Repère : origine en haut à gauche de la page AVEC son fond perdu, y vers le
 * bas. Le fini commence donc à (bleed, bleed). Tailles de texte en points.
 */

export type ImageFocus = "top" | "smart";

export type LayoutElement =
  | { type: "rect"; x: number; y: number; w: number; h: number; color: string }
  | { type: "image"; x: number; y: number; w: number; h: number; path: string | null; focus: ImageFocus }
  // Une page d'un PDF fourni (code de vie…), mise à l'échelle dans sa boîte
  // sans déformation, centrée.
  | { type: "pdf"; x: number; y: number; w: number; h: number; path: string; pageIndex: number }
  | {
      type: "text";
      x: number;
      y: number;
      w: number;
      h: number;
      text: string;
      font: string;
      bold: boolean;
      size: number;
      color: string;
      align: "left" | "center" | "right";
      // Lignes au plus : au-delà, le texte rétrécit (jusqu'à 60 %), puis est coupé.
      maxLines: number;
    }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; color: string; widthPt: number };

export interface LaidOutPage {
  blockId: string;
  kind: string;
  // Numéro imprimé en pied de page, ou null (couverture, numéros masqués).
  number: number | null;
  elements: LayoutElement[];
}

export interface PrintGeometry {
  widthMm: number;
  heightMm: number;
  bleedMm: number;
}

const PT_TO_MM = 25.4 / 72;
const LINE_HEIGHT = 1.25;

export const lineMm = (sizePt: number) => sizePt * PT_TO_MM * LINE_HEIGHT;

// Taille de texte qui tient dans sa boîte, ESTIMÉE (≈ 0,55 em par caractère) :
// pour l'aperçu à l'écran seulement, le PDF mesure les vrais glyphes.
export function estimateFitSize(text: string, w: number, size: number, maxLines: number): number {
  const longestWord = Math.max(1, ...text.split(/\s+/).map((word) => word.length));
  const perLine = Math.max(longestWord, Math.ceil(text.length / maxLines));
  const needed = perLine * size * 0.55 * PT_TO_MM;
  return needed > w ? Math.max(size * 0.6, (size * w) / needed) : size;
}
