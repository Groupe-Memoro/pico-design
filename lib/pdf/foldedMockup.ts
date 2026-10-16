import sharp from "sharp";
import { foldAxisLength, foldPanels, type FoldConfig } from "../folds";
import { warpIntoQuad, type Point, type Quad } from "./quadWarp";

/**
 * Mockup d'un produit plié (dépliant, carte) sans photo : le côté imprimé,
 * à plat, est découpé en volets à leurs vraies largeurs (foldPanels), puis
 * chaque volet est posé en 3D, entrouvert selon le type de pli — en V pour
 * le pli en deux, en U pour le roulé, en zigzag pour l'accordéon — et
 * projeté en perspective, avec un éclairage par volet, l'ombre des plis
 * creux et une ombre portée.
 *
 * Plis horizontaux : la scène est construite plis verticaux (image tournée
 * d'un quart de tour), puis le rendu est remis droit.
 */

const CANVAS_W = 2000;
const CANVAS_H = 1500;
// Marge autour du dépliant, en fraction du canevas.
const MARGIN = 0.12;
// Inclinaison de la caméra, vue légèrement d'en haut (degrés).
const CAMERA_TILT_DEG = 7;
// Lumière venant d'en haut à gauche, devant le dépliant (caméra en z négatif).
const LIGHT = normalize([-0.5, 0.4, -1]);

type Vec3 = [number, number, number];

function normalize([x, y, z]: Vec3): Vec3 {
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
}

// Orientation de chaque volet autour de l'axe vertical (degrés) : 0 = face à
// la caméra ; positif = le volet s'éloigne vers la droite.
function panelAngles(fold: FoldConfig): number[] {
  if (fold.type === "half") return [26, -26];
  if (fold.type === "roll") return [28, 0, -28];
  // Accordéon : zigzag, le premier pli vient vers la caméra.
  return Array.from({ length: fold.panels }, (_, i) => (i % 2 === 0 ? -22 : 22));
}

/**
 * `print` : le côté entier au format fini (voir generateStationeryMockupPng,
 * `flat`), déjà orienté comme le modèle. `side` : le côté qu'il représente,
 * pour l'ordre des volets.
 */
export async function generateFoldedMockupPng({
  print,
  fold,
  widthMm,
  heightMm,
  side,
  format = "png",
}: {
  print: Buffer;
  fold: FoldConfig;
  widthMm: number;
  heightMm: number;
  side: "front" | "back";
  // PNG par défaut ; WebP pour l'affichage à l'écran (plus rapide, plus léger).
  format?: "png" | "webp";
}): Promise<Buffer> {
  const vertical = fold.direction === "vertical";
  // Scène toujours en plis verticaux : un quart de tour anti-horaire met le
  // haut à gauche, les volets gardent donc leur ordre de gauche à droite.
  const sheet = vertical ? print : await sharp(print).rotate(270).toBuffer();
  const meta = await sharp(sheet).metadata();
  const sheetW = meta.width ?? 1;
  const sheetH = meta.height ?? 1;
  const lengthMm = foldAxisLength(fold, widthMm, heightMm);
  const depthMm = vertical ? heightMm : widthMm;
  const panels = foldPanels(fold, lengthMm, side);
  const angles = panelAngles(fold).slice(0, panels.length);

  // Chaîne de volets dans le plan horizontal (x vers la droite, z vers le fond).
  const edges: { x: number; z: number }[] = [{ x: 0, z: 0 }];
  panels.forEach((p, i) => {
    const t = (angles[i] * Math.PI) / 180;
    const last = edges[edges.length - 1];
    edges.push({ x: last.x + p.size * Math.cos(t), z: last.z + p.size * Math.sin(t) });
  });
  const midX = (Math.min(...edges.map((e) => e.x)) + Math.max(...edges.map((e) => e.x))) / 2;
  const minZ = Math.min(...edges.map((e) => e.z));

  // Projection : caméra à distance fixe, légèrement au-dessus.
  const span = Math.max(lengthMm, depthMm);
  const distance = span * 2.2;
  // Plis horizontaux : la scène est tournée, une inclinaison la pencherait de
  // côté une fois remise droite.
  const tilt = vertical ? (CAMERA_TILT_DEG * Math.PI) / 180 : 0;
  const project = (x: number, y: number, z: number): Point => {
    const yr = y * Math.cos(tilt) - z * Math.sin(tilt);
    const zr = y * Math.sin(tilt) + z * Math.cos(tilt);
    const s = distance / (distance + zr);
    return { x: x * s, y: -yr * s };
  };
  const top = depthMm / 2;
  const raw: Quad[] = panels.map((_, i) => {
    const a = edges[i], b = edges[i + 1];
    const ax = a.x - midX, bx = b.x - midX, az = a.z - minZ, bz = b.z - minZ;
    return [project(ax, top, az), project(bx, top, bz), project(bx, -top, bz), project(ax, -top, az)];
  });

  // Mise à l'échelle dans le canevas (dans le sens de la scène).
  const sceneW = vertical ? CANVAS_W : CANVAS_H;
  const sceneH = vertical ? CANVAS_H : CANVAS_W;
  const all = raw.flat();
  const minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y)), maxY = Math.max(...all.map((p) => p.y));
  const scale = Math.min((sceneW * (1 - 2 * MARGIN)) / (maxX - minX), (sceneH * (1 - 2 * MARGIN)) / (maxY - minY));
  const offX = (sceneW - (maxX - minX) * scale) / 2 - minX * scale;
  const offY = (sceneH - (maxY - minY) * scale) / 2 - minY * scale;
  const quads = raw.map((q) => q.map((p) => ({ x: p.x * scale + offX, y: p.y * scale + offY })) as Quad);

  // Chaque volet : découpé, ombré, déformé dans son quadrilatère.
  const pxPerMm = sheetW / lengthMm;
  const layers = await Promise.all(
    panels.map(async (p, i) => {
      const left = Math.min(sheetW - 1, Math.round(p.start * pxPerMm));
      const width = Math.max(1, Math.min(sheetW - left, Math.round(p.size * pxPerMm)));
      const t = (angles[i] * Math.PI) / 180;
      const normal: Vec3 = [Math.sin(t), 0, -Math.cos(t)];
      const lit = normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2];
      const brightness = Math.min(1.02, Math.max(0.6, 0.62 + 0.42 * lit));
      // Pli creux (loin de la caméra) : ombre le long du pli ; pli saillant :
      // léger reflet.
      const leftKind = i > 0 ? hingeKind(angles[i - 1], angles[i]) : null;
      const rightKind = i < panels.length - 1 ? hingeKind(angles[i], angles[i + 1]) : null;
      const shade = shadingSvg(width, sheetH, leftKind, rightKind);
      const panel = await sharp(sheet)
        .extract({ left, top: 0, width, height: sheetH })
        .composite([{ input: shade }])
        .linear(brightness, 0)
        .png({ compressionLevel: 0 })
        .toBuffer();
      return { input: await warpIntoQuad(panel, quads[i], sceneW, sceneH), left: 0, top: 0 };
    })
  );

  // Ombre portée : la silhouette du dépliant, floue, un peu plus bas.
  const silhouette = quads.map((q) => `<polygon points="${q.map((p) => `${p.x},${p.y}`).join(" ")}"/>`).join("");
  const shadowOffset = Math.round(sceneH * 0.018);
  // Vers le bas et un peu à droite, une fois la scène remise droite.
  const [shadowX, shadowY] = vertical ? [shadowOffset * 0.6, shadowOffset] : [shadowOffset, -shadowOffset * 0.6];
  const shadow = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${sceneW}" height="${sceneH}"><g fill="#000" fill-opacity="0.3" transform="translate(${shadowX},${shadowY})">${silhouette}</g></svg>`
    )
  )
    .blur(Math.max(1, sceneH * 0.014))
    .png({ compressionLevel: 0 })
    .toBuffer();
  // Arêtes du papier : un trait fin autour de chaque volet.
  const outline = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sceneW}" height="${sceneH}"><g fill="none" stroke="#000" stroke-opacity="0.14" stroke-width="1.2" stroke-linejoin="round">${silhouette}</g></svg>`
  );
  const background = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sceneW}" height="${sceneH}"><defs><radialGradient id="g" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#f6f5f3"/><stop offset="1" stop-color="#dedbd7"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`
  );

  const scene = sharp(background).composite([{ input: shadow }, ...layers, { input: outline }]);
  // La rotation s'applique avant la composition dans un même pipeline sharp :
  // d'où une étape à part pour les plis horizontaux.
  const out = vertical ? scene : sharp(await scene.png({ compressionLevel: 0 }).toBuffer()).rotate(90);
  return format === "webp" ? out.webp({ quality: 88 }).toBuffer() : out.png().toBuffer();
}

// Un pli entre deux volets (orientations de gauche et de droite) est creux
// quand le volet de gauche s'éloigne plus que celui de droite.
function hingeKind(left: number, right: number): "valley" | "mountain" {
  return left > right ? "valley" : "mountain";
}

// Dégradés d'un volet, près de ses plis : sombre dans un pli creux, clair
// sur un pli saillant.
function shadingSvg(width: number, height: number, left: string | null, right: string | null): Buffer {
  const band = (kind: string | null, x1: number, x2: number, id: string) => {
    if (!kind) return "";
    const color = kind === "valley" ? "#000" : "#fff";
    const opacity = kind === "valley" ? 0.16 : 0.08;
    return `<linearGradient id="${id}" x1="${x1}" x2="${x2}" y1="0" y2="0"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`;
  };
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>${band(left, 0, 0.22, "l")}${band(right, 1, 0.78, "r")}</defs>${
      left ? `<rect width="100%" height="100%" fill="url(#l)"/>` : ""
    }${right ? `<rect width="100%" height="100%" fill="url(#r)"/>` : ""}</svg>`
  );
}
