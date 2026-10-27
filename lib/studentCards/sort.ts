// Ordre de production des lignes du fichier (élèves, clients…) : jusqu'à
// trois critères, chacun une colonne en ordre croissant ou décroissant.

export interface SortKey {
  column: string;
  descending: boolean;
}

export const MAX_SORT_KEYS = 3;

// Comparaison « naturelle » en français : sans tenir compte des accents ni
// des majuscules, et les nombres par leur valeur (2 avant 10).
const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

/**
 * Index des lignes dans l'ordre demandé. Les cellules vides vont toujours à la
 * fin, quel que soit le sens ; à égalité sur tous les critères, l'ordre du
 * fichier est gardé.
 */
export function sortedRowIndexes(rows: Record<string, string>[], keys: SortKey[]): number[] {
  const indexes = rows.map((_, i) => i);
  const active = keys.filter((k) => k.column);
  if (active.length === 0) return indexes;
  return indexes.sort((a, b) => {
    for (const key of active) {
      const x = (rows[a][key.column] ?? "").trim();
      const y = (rows[b][key.column] ?? "").trim();
      if (!x || !y) {
        if (x !== y) return x ? -1 : 1;
        continue;
      }
      const order = collator.compare(x, y);
      if (order !== 0) return key.descending ? -order : order;
    }
    return a - b;
  });
}

// La ligne dont la valeur de la colonne est la plus longue (la première en
// cas d'égalité), pour vérifier qu'elle tient dans sa zone ; -1 si toutes
// sont vides.
export function longestRowIndex(rows: Record<string, string>[], column: string): number {
  let best = -1;
  let bestLength = 0;
  rows.forEach((row, i) => {
    const length = (row[column] ?? "").trim().length;
    if (length > bestLength) {
      best = i;
      bestLength = length;
    }
  });
  return best;
}
