import { formatIn } from "@/lib/pdf/units";

// Libellé d'un modèle dans les sélecteurs : son nom, « - R » (recto) ou
// « - RV » (recto-verso), et ses dimensions finies si on les donne. Plusieurs
// modèles portent le même nom en recto et recto-verso, ou en plusieurs
// formats : ils ne se distingueraient pas autrement dans une liste.
// Affichage seulement, le nom en base est inchangé.
export function templateLabel(name: string, twoSided: boolean, size?: { widthMm: number; heightMm: number }): string {
  const sides = `${name.trim()} - ${twoSided ? "RV" : "R"}`;
  return size ? `${sides} · ${formatIn(size.widthMm)} × ${formatIn(size.heightMm)}` : sides;
}

// Raccourci pour une ligne de la table templates.
export function templateOptionLabel(t: { name: string; two_sided: boolean; width_mm: number; height_mm: number }): string {
  return templateLabel(t.name, t.two_sided, { widthMm: Number(t.width_mm), heightMm: Number(t.height_mm) });
}
