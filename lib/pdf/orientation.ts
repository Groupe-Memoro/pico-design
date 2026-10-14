import { parseFold } from "../folds";
import type { Template } from "../types";

function rotateFold(raw: unknown) {
  const fold = parseFold(raw);
  return fold ? { ...fold, direction: fold.direction === "vertical" ? "horizontal" : "vertical" } : raw ?? null;
}

/**
 * Retourne le modèle avec largeur/hauteur (et les marges qui ont un axe
 * x/y) inversées si `rotated`, pour utiliser un même modèle en portrait ou
 * en paysage selon le produit — sans modifier le modèle en base. Pure
 * fonction (pas de dépendance serveur), utilisable côté client et serveur.
 */
export function applyOrientation(template: Template, rotated: boolean): Template {
  if (!rotated) return template;
  return {
    ...template,
    width_mm: template.height_mm,
    height_mm: template.width_mm,
    safety_margin_x_mm: template.safety_margin_y_mm,
    safety_margin_y_mm: template.safety_margin_x_mm,
    print_margin_x_mm: template.print_margin_y_mm,
    print_margin_y_mm: template.print_margin_x_mm,
    logo_margin_x_mm: template.logo_margin_y_mm,
    logo_margin_y_mm: template.logo_margin_x_mm,
    // Les plis tournent avec le format : verticaux deviennent horizontaux.
    fold_marks_vertical_mm: template.fold_marks_horizontal_mm,
    fold_marks_horizontal_mm: template.fold_marks_vertical_mm,
    fold: rotateFold(template.fold),
  };
}

export function isLandscape(widthMm: number, heightMm: number): boolean {
  return widthMm >= heightMm;
}
