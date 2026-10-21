// Calcul de la grille d'imposition — fonctions pures (aucune dépendance
// serveur), partagées entre l'aperçu côté client et la génération du PDF
// côté serveur pour que les deux montrent toujours exactement la même chose.
//
// Toutes les valeurs sont en mm. Les coordonnées des cellules ont l'origine
// en HAUT à gauche de la feuille (comme à l'écran) ; la conversion vers le
// repère PDF (origine en bas à gauche) se fait au moment du dessin.

export type PieceOrientation = "auto" | "normal" | "rotated";

export interface SheetMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LayoutInput {
  sheetWidth: number;
  sheetHeight: number;
  margins: SheetMargins;
  // Espace entre deux pièces voisines (bord de fond perdu à bord de fond perdu,
  // ou trait de coupe à trait de coupe avec `trimBleed`).
  gutterX: number;
  gutterY: number;
  // Décalage de calibration de la découpeuse, appliqué à toute la grille
  // (positif = vers la droite / vers le bas).
  offsetX: number;
  offsetY: number;
  // Centre la grille dans la zone utile (sinon, collée en haut à gauche).
  centerGrid: boolean;
  // Taille d'une pièce, fond perdu inclus (= taille de la page du PDF source).
  pieceWidth: number;
  pieceHeight: number;
  orientation: PieceOrientation;
  // Grille imposée (profil Graphtec) : exactement `cols` × `rows` pièces, ou
  // aucune si elles ne tiennent pas dans la zone utile. Absente = autant de
  // pièces que la zone en contient.
  grid?: { cols: number; rows: number } | null;
  // Fond perdu par côté, quand les marges et l'espacement se mesurent depuis la
  // PIÈCE FINIE (trait de coupe) et non depuis le bord du fond perdu : c'est le
  // cas de la Graphtec, qui découpe au contour. Le fond perdu déborde alors
  // dans l'espacement et les marges. Absent = mesures au bord du fond perdu.
  trimBleed?: number | null;
}

export interface Cell {
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  // Zone où la pièce peut s'imprimer, quand son fond perdu chevaucherait celui
  // d'une voisine (espacement plus petit que deux fonds perdus) : la pièce est
  // rognée au milieu de l'espacement de ce côté-là. Absente = la cellule entière.
  clip?: { x: number; y: number; width: number; height: number };
}

export interface Layout {
  cols: number;
  rows: number;
  // Vrai si les pièces sont tournées de 90° sur la feuille.
  rotated: boolean;
  cellWidth: number;
  cellHeight: number;
  cells: Cell[];
  // Zone utile (feuille moins marges), pour l'aperçu.
  usable: { x: number; y: number; width: number; height: number };
}

// Tolérance sur les comparaisons de longueurs, en mm : absorbe les erreurs
// d'arrondi des conversions po/mm/pt sans jamais faire passer une pièce qui
// déborde vraiment.
const LENGTH_EPSILON_MM = 0.01;

function fitCount(available: number, size: number, gutter: number): number {
  if (size <= 0 || available + LENGTH_EPSILON_MM < size) return 0;
  return Math.floor((available + gutter + LENGTH_EPSILON_MM) / (size + gutter));
}

export function computeLayout(input: LayoutInput): Layout {
  const { margins } = input;
  const usable = {
    x: margins.left,
    y: margins.top,
    width: input.sheetWidth - margins.left - margins.right,
    height: input.sheetHeight - margins.top - margins.bottom,
  };

  // Ce qui se mesure entre les marges et l'espacement : la pièce entière, ou la
  // pièce finie (fond perdu retiré) si les mesures partent du trait de coupe.
  const trim = Math.max(0, input.trimBleed ?? 0);

  function candidate(rotated: boolean) {
    const cellWidth = rotated ? input.pieceHeight : input.pieceWidth;
    const cellHeight = rotated ? input.pieceWidth : input.pieceHeight;
    const fitCols = fitCount(usable.width, cellWidth - 2 * trim, input.gutterX);
    const fitRows = fitCount(usable.height, cellHeight - 2 * trim, input.gutterY);
    // Grille imposée : tout ou rien. Une grille partielle décalerait les pièces
    // par rapport au fichier de coupe, qui attend chacune à sa place.
    const fits = !input.grid || (input.grid.cols <= fitCols && input.grid.rows <= fitRows);
    const cols = !fits ? 0 : input.grid ? input.grid.cols : fitCols;
    const rows = !fits ? 0 : input.grid ? input.grid.rows : fitRows;
    return { rotated, cellWidth, cellHeight, cols, rows, count: cols * rows };
  }

  const normal = candidate(false);
  const turned = candidate(true);
  let chosen = normal;
  if (input.orientation === "rotated") chosen = turned;
  // Avec une grille imposée, les deux sens donnent le même nombre ou zéro : le
  // sens pivoté n'est donc retenu que si lui seul tient.
  else if (input.orientation === "auto" && turned.count > normal.count) chosen = turned;

  const { cols, rows, cellWidth, cellHeight, rotated } = chosen;
  // Pas d'une pièce à la suivante, et taille de la grille, mesurés sur ce que
  // séparent les marges et l'espacement (voir `trim`).
  const stepX = cellWidth - 2 * trim + input.gutterX;
  const stepY = cellHeight - 2 * trim + input.gutterY;
  const gridWidth = cols * (cellWidth - 2 * trim) + Math.max(cols - 1, 0) * input.gutterX;
  const gridHeight = rows * (cellHeight - 2 * trim) + Math.max(rows - 1, 0) * input.gutterY;
  const originX =
    usable.x + (input.centerGrid ? (usable.width - gridWidth) / 2 : 0) + input.offsetX;
  const originY =
    usable.y + (input.centerGrid ? (usable.height - gridHeight) / 2 : 0) + input.offsetY;

  // Fond perdu de trop entre deux voisines : ce qui dépasse le milieu de l'espacement.
  const overlapX = Math.max(0, trim - input.gutterX / 2);
  const overlapY = Math.max(0, trim - input.gutterY / 2);

  const cells: Cell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = originX + col * stepX - trim;
      const y = originY + row * stepY - trim;
      const cell: Cell = { col, row, x, y, width: cellWidth, height: cellHeight };
      if (overlapX > 0 || overlapY > 0) {
        // Rogné seulement du côté d'une voisine : en bordure de grille, le fond perdu reste entier.
        const left = col > 0 ? overlapX : 0;
        const right = col < cols - 1 ? overlapX : 0;
        const top = row > 0 ? overlapY : 0;
        const bottom = row < rows - 1 ? overlapY : 0;
        if (left || right || top || bottom) {
          cell.clip = { x: x + left, y: y + top, width: cellWidth - left - right, height: cellHeight - top - bottom };
        }
      }
      cells.push(cell);
    }
  }

  return { cols, rows, rotated, cellWidth, cellHeight, cells, usable };
}

// Positions distinctes triées (les erreurs d'arrondi flottant sont absorbées).
function uniquePositions(values: number[]): number[] {
  return [...new Set(values.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
}

// Traits de coupe de la découpeuse : elle coupe de bord à bord, une coupe par
// bord de pièce finie (à `bleedMm` du bord de la cellule), sur toute la hauteur
// (`xs`, positions horizontales) ou toute la largeur (`ys`, positions
// verticales) de la feuille. Deux cartes qui se touchent donnent donc deux
// traits rapprochés (la bande de fond perdu entre elles est du rebut).
// Partagé entre l'aperçu (traits orange) et l'export Duplo.
export function cutLines(layout: Layout, bleedMm: number): { xs: number[]; ys: number[] } {
  // Jamais plus que la moitié de la plus petite dimension, pour ne pas inverser le rectangle.
  const bleed = Math.max(0, Math.min(bleedMm, Math.min(layout.cellWidth, layout.cellHeight) / 2));
  return {
    xs: uniquePositions(layout.cells.flatMap((c) => [c.x + bleed, c.x + c.width - bleed])),
    ys: uniquePositions(layout.cells.flatMap((c) => [c.y + bleed, c.y + c.height - bleed])),
  };
}

export interface SourceCopies {
  copies: number;
}

// Répartit les cellules (ordre de lecture : gauche→droite, haut→bas) entre
// les sources : chacune reçoit ses copies d'un seul bloc, dans l'ordre de la
// liste. Retourne, pour chaque cellule, l'index de la source (ou null si
// vide), ainsi que le nombre de copies qui ne tiennent pas.
export function assignCells(
  sources: SourceCopies[],
  cellCount: number
): { assignment: (number | null)[]; overflow: number } {
  const assignment: (number | null)[] = new Array(cellCount).fill(null);
  let next = 0;
  let overflow = 0;
  sources.forEach((source, index) => {
    const copies = Math.max(0, Math.floor(source.copies));
    for (let i = 0; i < copies; i++) {
      if (next < cellCount) assignment[next++] = index;
      else overflow++;
    }
  });
  return { assignment, overflow };
}

export type FlipEdge = "long" | "short";

// Recto-verso : la feuille est retournée autour d'un axe pour imprimer le
// verso. Retourne `true` si cet axe est vertical (le verso est alors miroité
// horizontalement : une pièce en colonne c se retrouve en colonne cols-1-c),
// `false` s'il est horizontal (miroir vertical).
export function flipAxisIsVertical(sheetWidth: number, sheetHeight: number, edge: FlipEdge): boolean {
  const portrait = sheetHeight >= sheetWidth;
  // Portrait : le bord long est vertical, on tourne la feuille autour de lui.
  return edge === "long" ? portrait : !portrait;
}

// Position miroir d'une cellule du recto pour le verso, selon l'axe de retournement.
export function mirrorCell(
  cell: Cell,
  sheetWidth: number,
  sheetHeight: number,
  verticalAxis: boolean
): Cell {
  // La zone de rognage suit la pièce dans son miroir.
  const clip = cell.clip;
  return verticalAxis
    ? {
        ...cell,
        x: sheetWidth - cell.x - cell.width,
        ...(clip && { clip: { ...clip, x: sheetWidth - clip.x - clip.width } }),
      }
    : {
        ...cell,
        y: sheetHeight - cell.y - cell.height,
        ...(clip && { clip: { ...clip, y: sheetHeight - clip.y - clip.height } }),
      };
}
