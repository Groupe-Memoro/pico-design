// Magnétisme et alignement des zones de l'éditeur à données variables.
// Fonctions pures, en mm (repère de la page, coin haut-gauche).

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Repère placé par l'utilisateur : une ligne verticale (position en x) ou
// horizontale (en y), en mm depuis le coin haut-gauche de la page.
export interface UserGuide {
  id: string;
  axis: "v" | "h";
  pos: number;
}

export function parseUserGuides(raw: unknown, pageW: number, pageH: number): UserGuide[] | null {
  if (!Array.isArray(raw) || raw.length > 50) return null;
  const guides: UserGuide[] = [];
  for (const g of raw as Record<string, unknown>[]) {
    const axis = g.axis === "h" ? "h" : g.axis === "v" ? "v" : null;
    const pos = Number(g.pos);
    if (!axis || !Number.isFinite(pos)) return null;
    const max = axis === "v" ? pageW : pageH;
    guides.push({
      id: typeof g.id === "string" && g.id.length <= 64 ? g.id : `guide-${guides.length + 1}`,
      axis,
      pos: Math.round(Math.min(max, Math.max(0, pos)) * 100) / 100,
    });
  }
  return guides;
}

// Repères d'un thème, reçus en JSON (champ de formulaire). La page n'est pas
// connue ici (le modèle peut changer) : seules les valeurs absurdes sont
// bornées, l'éditeur garde chaque repère dans la page.
export function parseThemeGuidesField(raw: FormDataEntryValue | null): UserGuide[] | null {
  if (typeof raw !== "string") return null;
  try {
    return parseUserGuides(JSON.parse(raw), 2000, 2000);
  } catch {
    return null;
  }
}

/**
 * Décalage qui colle l'un des `edges` (bords et centre d'une zone, le long
 * d'un axe) à la cible la plus proche, si elle est à moins de `threshold`.
 * Renvoie le décalage et la ligne visée, ou null.
 */
export function snapAxis(edges: number[], targets: number[], threshold: number): { delta: number; line: number } | null {
  let best: { delta: number; line: number } | null = null;
  for (const e of edges) {
    for (const t of targets) {
      const delta = t - e;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line: t };
    }
  }
  return best;
}

export const edgesX = (b: Box) => [b.x, b.x + b.width / 2, b.x + b.width];
export const edgesY = (b: Box) => [b.y, b.y + b.height / 2, b.y + b.height];

export function boundsOf(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "distributeH" | "distributeV";

/**
 * Nouvelles positions des zones alignées sur `ref` (la page pour une zone
 * seule, l'ensemble sélectionné pour plusieurs). Répartir : écarts égaux
 * entre les zones, les deux extrêmes ne bougent pas (3 zones au moins).
 */
export function alignBoxes<T extends Box & { id: string }>(boxes: T[], ref: Box, mode: AlignMode): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (mode === "distributeH" || mode === "distributeV") {
    const horizontal = mode === "distributeH";
    const sorted = [...boxes].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
    if (sorted.length < 3) return out;
    const total = sorted.reduce((sum, b) => sum + (horizontal ? b.width : b.height), 0);
    const span = horizontal ? ref.width : ref.height;
    const gap = (span - total) / (sorted.length - 1);
    let cursor = horizontal ? ref.x : ref.y;
    for (const b of sorted) {
      out.set(b.id, horizontal ? { x: cursor, y: b.y } : { x: b.x, y: cursor });
      cursor += (horizontal ? b.width : b.height) + gap;
    }
    return out;
  }
  for (const b of boxes) {
    const x =
      mode === "left" ? ref.x : mode === "hcenter" ? ref.x + (ref.width - b.width) / 2 : mode === "right" ? ref.x + ref.width - b.width : b.x;
    const y =
      mode === "top" ? ref.y : mode === "vcenter" ? ref.y + (ref.height - b.height) / 2 : mode === "bottom" ? ref.y + ref.height - b.height : b.y;
    out.set(b.id, { x, y });
  }
  return out;
}
