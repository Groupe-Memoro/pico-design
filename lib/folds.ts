/**
 * Produits pliés (dépliants, cartes de souhait) : le pli d'un modèle
 * (templates.fold) et les volets qui en découlent, au recto et au verso.
 * Sans dépendance serveur : utilisé par le formulaire du modèle, les guides
 * de l'outil (lib/pdf/preview.ts) et les mockups générés (lib/pdf/foldedMockup.ts).
 *
 * Repère : distances en mm depuis le bord de coupe (fond perdu exclu), le long
 * de la largeur pour des plis verticaux (volets côte à côte), de la hauteur
 * pour des plis horizontaux (volets empilés).
 *
 * Verso : la feuille se retourne autour d'un axe vertical. Avec des plis
 * verticaux, l'ordre des volets s'inverse donc au verso (le volet de gauche du
 * recto est à droite du verso) ; avec des plis horizontaux, il reste le même.
 */

export type FoldType = "half" | "roll" | "accordion";
export type FoldDirection = "vertical" | "horizontal";

export interface FoldConfig {
  type: FoldType;
  direction: FoldDirection;
  // Nombre de volets (2 pour un pli simple, 3 pour un pli roulé ; 3 à 8 en accordéon).
  panels: number;
  // Zone de sécurité de chaque côté d'un pli.
  safetyMm: number;
  // Comment se compose le produit : sur la feuille entière (recto-verso), par
  // volet (une photo ou un fichier par volet), ou au choix.
  designMode: FoldDesignMode;
}

export type FoldDesignMode = "sheet" | "panels" | "both";

export const FOLD_DESIGN_MODES: { mode: FoldDesignMode; label: string }[] = [
  { mode: "sheet", label: "Par planche (fichier recto-verso)" },
  { mode: "panels", label: "Par volet" },
  { mode: "both", label: "Au choix : par planche ou par volet" },
];

export const allowsPanels = (fold: FoldConfig | null) => Boolean(fold && fold.designMode !== "sheet");
export const allowsSheet = (fold: FoldConfig | null) => !fold || fold.designMode !== "panels";

export const FOLD_TYPES: { type: FoldType; label: string }[] = [
  { type: "half", label: "Pli simple (2 volets)" },
  { type: "roll", label: "Pli roulé (3 volets)" },
  { type: "accordion", label: "Pli accordéon (Z)" },
];

// Le volet qui rentre à l'intérieur d'un pli roulé est plus étroit, pour ne
// pas buter contre le pli : 1/16 po, l'usage.
const ROLL_FOLD_INSET_MM = 1.5875;
const DEFAULT_FOLD_SAFETY_MM = 3.175;

export function parseFold(raw: unknown): FoldConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = FOLD_TYPES.find((t) => t.type === r.type)?.type;
  if (!type) return null;
  const direction: FoldDirection = r.direction === "horizontal" ? "horizontal" : "vertical";
  const panels = type === "half" ? 2 : type === "roll" ? 3 : Math.min(8, Math.max(3, Math.round(Number(r.panels)) || 3));
  const safety = Number(r.safetyMm);
  const designMode: FoldDesignMode = r.designMode === "panels" || r.designMode === "both" ? r.designMode : "sheet";
  return {
    type,
    direction,
    panels,
    safetyMm: Number.isFinite(safety) && safety >= 0 && safety <= 20 ? safety : DEFAULT_FOLD_SAFETY_MM,
    designMode,
  };
}

export interface FoldPanel {
  // Début et taille le long de l'axe des plis (mm depuis le bord de coupe).
  start: number;
  size: number;
  label: string;
}

// Tailles des volets au RECTO, dans l'ordre (gauche → droite, ou haut → bas).
function rectoSizes(fold: FoldConfig, length: number): number[] {
  if (fold.type === "roll") {
    const normal = (length + ROLL_FOLD_INSET_MM) / 3;
    // Le volet rabattu est le premier au recto (à gauche, ou en haut).
    return [normal - ROLL_FOLD_INSET_MM, normal, normal];
  }
  return Array.from({ length: fold.panels }, () => length / fold.panels);
}

function labels(fold: FoldConfig, side: "front" | "back"): string[] {
  const v = fold.direction === "vertical";
  if (fold.type === "half") {
    if (side === "front") return v ? ["Endos", "Couverture"] : ["Endos (à l'envers)", "Couverture"];
    return v ? ["Intérieur gauche", "Intérieur droit"] : ["Intérieur haut", "Intérieur bas"];
  }
  if (fold.type === "roll") {
    if (side === "front") return ["Volet rabattu", "Endos", "Couverture"];
    return v ? ["Intérieur gauche", "Intérieur centre", "Intérieur droit"] : ["Intérieur haut", "Intérieur centre", "Intérieur bas"];
  }
  return Array.from({ length: fold.panels }, (_, i) =>
    side === "front" ? (i === 0 ? "Couverture" : `Volet ${i + 1}`) : `Intérieur ${i + 1}`
  );
}

/**
 * Volets d'un côté, dans l'ordre où ils apparaissent sur ce côté. `length` est
 * la longueur coupée le long de l'axe des plis (largeur ou hauteur finie).
 */
export function foldPanels(fold: FoldConfig, length: number, side: "front" | "back"): FoldPanel[] {
  const sizes = rectoSizes(fold, length);
  // Au verso, plis verticaux : l'ordre s'inverse (la feuille est retournée).
  const ordered = side === "back" && fold.direction === "vertical" ? [...sizes].reverse() : sizes;
  const names = labels(fold, side);
  let start = 0;
  return ordered.map((size, i) => {
    const panel = { start, size, label: names[i] ?? `Volet ${i + 1}` };
    start += size;
    return panel;
  });
}

// Longueur de l'axe des plis d'un format fini.
export function foldAxisLength(fold: FoldConfig, widthMm: number, heightMm: number): number {
  return fold.direction === "vertical" ? widthMm : heightMm;
}

/**
 * Cases d'une composition par volet, sur la PAGE (fond perdu compris), pour un
 * côté : limites des colonnes et des rangées en fractions 0-1 (comme une
 * mosaïque, mais aux plis réels), et le nom de chaque volet. Les volets du
 * bord prennent le fond perdu ; deux volets voisins se touchent au pli.
 */
export function panelCells(
  t: { width_mm: number; height_mm: number; bleed_mm: number; fold: unknown },
  side: "front" | "back"
): { cols: number[]; rows: number[]; labels: string[] } | null {
  const fold = parseFold(t.fold);
  if (!fold) return null;
  const vertical = fold.direction === "vertical";
  const panels = foldPanels(fold, foldAxisLength(fold, t.width_mm, t.height_mm), side);
  const page = (vertical ? t.width_mm : t.height_mm) + 2 * t.bleed_mm;
  const edges = [0, ...panels.slice(1).map((p) => (t.bleed_mm + p.start) / page), 1];
  return {
    cols: vertical ? edges : [0, 1],
    rows: vertical ? [0, 1] : edges,
    labels: panels.map((p) => p.label),
  };
}

/**
 * Format fini d'un modèle : plié s'il a un pli (le plus grand volet, dans le
 * sens des plis), sinon ses dimensions. Ex. 10 × 7 po plié en deux → 5 × 7.
 * `open` : la feuille dépliée (null sans pli). Affichage seulement — le
 * modèle, l'imposition et le PDF travaillent toujours sur la feuille ouverte.
 */
export function finishedSize(t: { width_mm: number; height_mm: number; fold?: unknown }): {
  widthMm: number;
  heightMm: number;
  open: { widthMm: number; heightMm: number } | null;
} {
  const widthMm = Number(t.width_mm);
  const heightMm = Number(t.height_mm);
  const fold = parseFold(t.fold);
  if (!fold) return { widthMm, heightMm, open: null };
  const vertical = fold.direction === "vertical";
  const panel = Math.max(...foldPanels(fold, vertical ? widthMm : heightMm, "front").map((p) => p.size));
  return {
    widthMm: vertical ? panel : widthMm,
    heightMm: vertical ? heightMm : panel,
    open: { widthMm, heightMm },
  };
}
