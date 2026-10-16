import sharp from "sharp";

/**
 * Pose une image dans un quadrilatère quelconque (perspective) : le volet
 * d'un dépliant photographié de biais, par exemple. sharp ne sait faire que
 * des transformations affines ; ici, une homographie (carré → quadrilatère)
 * inversée échantillonne l'image pour chaque pixel du quadrilatère, en
 * bilinéaire, avec un sur-échantillonnage 2 × 2 pour lisser les bords.
 *
 * Coins dans l'ordre : haut-gauche, haut-droite, bas-droite, bas-gauche.
 */

export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];

type Mat3 = [number, number, number, number, number, number, number, number, number];

// Carré unité → quadrilatère (Heckbert, « Fundamentals of Texture Mapping »).
function squareToQuad([p0, p1, p2, p3]: Quad): Mat3 {
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (dx3 !== 0 || dy3 !== 0) {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1,
  ];
}

function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

/**
 * Dessine `source` (n'importe quelle image) dans `quad`, sur une toile
 * RGBA transparente de `width` × `height`, et renvoie un PNG à poser
 * par-dessus la scène.
 */
export async function warpIntoQuad(source: Buffer, quad: Quad, width: number, height: number): Promise<Buffer> {
  const { data: src, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sw = info.width, sh = info.height;
  const inv = invert(squareToQuad(quad));
  const out = Buffer.alloc(width * height * 4);

  const minX = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.x))));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...quad.map((p) => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.y))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...quad.map((p) => p.y))));
  const OFFSETS = [0.25, 0.75];

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let r = 0, g = 0, b = 0, a = 0, hits = 0;
      for (const oy of OFFSETS) {
        for (const ox of OFFSETS) {
          const px = x + ox, py = y + oy;
          const w = inv[6] * px + inv[7] * py + inv[8];
          const u = (inv[0] * px + inv[1] * py + inv[2]) / w;
          const v = (inv[3] * px + inv[4] * py + inv[5]) / w;
          if (u < 0 || u > 1 || v < 0 || v > 1) continue;
          // Bilinéaire dans l'image source.
          const fx = Math.min(sw - 1.001, u * (sw - 1));
          const fy = Math.min(sh - 1.001, v * (sh - 1));
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          const tx = fx - x0, ty = fy - y0;
          const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
          const mix = (k: number) =>
            (src[i00 + k] * (1 - tx) + src[i10 + k] * tx) * (1 - ty) + (src[i01 + k] * (1 - tx) + src[i11 + k] * tx) * ty;
          r += mix(0); g += mix(1); b += mix(2); a += mix(3);
          hits++;
        }
      }
      if (!hits) continue;
      const o = (y * width + x) * 4;
      // Moyenne des échantillons tombés dans le quadrilatère ; la couverture
      // (hits / 4) adoucit le bord.
      out[o] = r / hits;
      out[o + 1] = g / hits;
      out[o + 2] = b / hits;
      out[o + 3] = (a / hits) * (hits / 4);
    }
  }
  // Image intermédiaire : sans compression, l'encoder serait plus long que la déformer.
  return sharp(out, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
}
