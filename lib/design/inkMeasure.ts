// Mesure de l'encre d'un texte dans le navigateur, au pixel : le texte est
// dessiné dans un canevas hors écran, puis on cherche ses premiers et derniers
// pixels. Les mesures fournies par le navigateur (actualBoundingBox…) varient
// d'un navigateur à l'autre (Safari) ; celle-ci suit le dessin réel de la
// police — c'est ce qui colle le texte au bord de sa zone dans l'aperçu.

// Corps de mesure (px) : assez grand pour une précision au centième de corps.
const SIZE = 200;
const cache = new Map<string, InkMetrics>();

export interface InkMetrics {
  // Pour 1 unité de corps : l'encre va de -left à +right autour du point de départ.
  left: number;
  right: number;
  // Hauteur ascendante → descendante de la police, pour 1 unité de corps.
  height: number;
}

// `font` : la police CSS sans la taille, ex. `700 "Inter"`. `version` change
// quand une police finit de se charger (la mesure d'avant était faite avec une
// police de remplacement).
export function measureInk(font: string, text: string, version = 0): InkMetrics {
  const key = `${version}|${font}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { left: 0, right: text.length * 0.6, height: 1.2 };
  const css = font.replace(/^(\d+)\s+/, `$1 ${SIZE}px `);
  ctx.font = css;
  const m = ctx.measureText(text);
  const height = ((m.fontBoundingBoxAscent ?? SIZE * 0.9) + (m.fontBoundingBoxDescent ?? SIZE * 0.25)) / SIZE;
  // Marge d'un corps de chaque côté : une lettre qui déborde (italique, J) reste dans le canevas.
  canvas.width = Math.ceil(m.width + SIZE * 2);
  canvas.height = Math.ceil(SIZE * 2);
  ctx.font = css;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#000";
  ctx.fillText(text, SIZE, SIZE * 1.3);
  const { data, width, height: h } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let min = width;
  let max = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
  }
  const metrics =
    max < 0
      ? { left: 0, right: m.width / SIZE, height }
      : { left: (SIZE - min) / SIZE, right: (max + 1 - SIZE) / SIZE, height };
  if (cache.size > 2000) cache.clear();
  cache.set(key, metrics);
  return metrics;
}
