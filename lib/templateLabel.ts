import { formatIn } from "@/lib/pdf/units";
import { finishedSize } from "@/lib/folds";

// Libellé d'un modèle dans les sélecteurs : son nom, « - R » (recto) ou
// « - RV » (recto-verso), et ses dimensions finies si on les donne. Plusieurs
// modèles portent le même nom en recto et recto-verso, ou en plusieurs
// formats : ils ne se distingueraient pas autrement dans une liste.
// Affichage seulement, le nom en base est inchangé.
export function templateLabel(name: string, twoSided: boolean, size?: { widthMm: number; heightMm: number }): string {
  const sides = `${name.trim()} - ${twoSided ? "RV" : "R"}`;
  return size ? `${sides} · ${formatIn(size.widthMm)} × ${formatIn(size.heightMm)}` : sides;
}

type SizedTemplate = { width_mm: number; height_mm: number; fold?: unknown };

// Raccourci pour une ligne de la table templates : le format FINI (plié pour
// un modèle plié, voir finishedSize).
export function templateOptionLabel(t: SizedTemplate & { name: string; two_sided: boolean }): string {
  const size = finishedSize(t);
  return templateLabel(t.name, t.two_sided, { widthMm: size.widthMm, heightMm: size.heightMm });
}

// Format fini d'un modèle, ex. `5" × 7"` ; `withOpen` ajoute la feuille
// dépliée d'un modèle plié : `5" × 7" (ouvert 10" × 7")`.
export function templateSizeLabel(t: SizedTemplate, withOpen = false, sep = " × "): string {
  const size = finishedSize(t);
  const main = `${formatIn(size.widthMm)}${sep}${formatIn(size.heightMm)}`;
  return withOpen && size.open ? `${main} (ouvert ${formatIn(size.open.widthMm)}${sep}${formatIn(size.open.heightMm)})` : main;
}
