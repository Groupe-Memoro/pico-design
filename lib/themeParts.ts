/**
 * Parties d'un thème (voir la migration 0087) : un thème de carte de souhait
 * peut avoir un graphisme au recto ET au verso (par planche), ou sur n'importe
 * quels volets (par volet) — couverture et intérieur gauche, par exemple. Le
 * client choisit le thème une fois et remplit les photos et textes de chaque
 * partie. Sans dépendance serveur.
 */
import type { Theme, ThemePart, ThemeScope } from "@/lib/types";
import { panelChoices, parseFold, parsePanelKey } from "@/lib/folds";

// Les parties d'un thème, y compris celle d'un thème d'avant (une seule : le
// recto, dans les colonnes du thème).
export function themeParts(theme: Theme): ThemePart[] {
  if (theme.parts && theme.parts.length > 0) return theme.parts;
  return [
    {
      key: "front",
      overlay_path: theme.overlay_path,
      background_path: theme.background_path ?? null,
      overlay_fit: theme.overlay_fit,
      slots: theme.slots,
      text_zones: theme.text_zones ?? [],
      guides: theme.guides ?? [],
    },
  ];
}

// Face d'une partie : « front », « back », ou celle d'un volet.
export function partSide(key: string): "front" | "back" {
  return key === "back" || key.startsWith("back:") ? "back" : "front";
}

// Parties possibles d'un thème pour un modèle : les faces (par planche) ou les
// volets (par volet), dans l'ordre recto puis verso, avec leur nom.
export function themePartChoices(
  t: { width_mm: number; height_mm: number; fold?: unknown; two_sided?: boolean },
  scope: ThemeScope
): { key: string; label: string }[] {
  if (scope === "panel") return panelChoices(t);
  const folded = Boolean(parseFold(t.fold));
  const faces = [{ key: "front", label: folded ? "Recto (extérieur)" : "Recto" }];
  if (t.two_sided !== false) faces.push({ key: "back", label: folded ? "Verso (intérieur)" : "Verso" });
  return faces;
}

export function isPartKey(key: string, scope: ThemeScope): boolean {
  return scope === "panel" ? parsePanelKey(key) !== null : key === "front" || key === "back";
}
