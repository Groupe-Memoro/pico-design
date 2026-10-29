import sharp, { type Sharp } from "sharp";

// Extrait un point focal (0..1) d'une valeur de formulaire, avec repli sur
// le centre (0.5) si absente/invalide.
export function parsePositionValue(value: FormDataEntryValue | null): number {
  if (typeof value !== "string") return 0.5;
  const n = parseFloat(value);
  if (Number.isNaN(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/**
 * Recadre une image en "cover" (remplit exactement la cible, sans
 * déformation) avec un point focal ajustable : positionX/positionY vont de
 * 0 à 1 (0 = bord gauche/haut visible, 1 = bord droit/bas visible, 0.5 =
 * centré). C'est l'équivalent manuel du fit "cover" de sharp, mais avec une
 * position choisie par l'utilisateur plutôt que centrée ou détectée
 * automatiquement (ancien comportement "attention").
 *
 * `zoom` (1 = le minimum qui couvre la cible, sans marge) resserre (>1) ou
 * élargit (<1) le cadrage — utilisé par l'étape « Aperçu » de Design
 * Shopify. En dessous de 1, l'image ne couvre plus toute la cible : le
 * surplus est comblé en blanc, centré/positionné comme le reste de l'image
 * (dézoomer laisse voir une marge blanche plutôt que de déformer/couper).
 *
 * `rotation` (0/90/180/270) pivote le visuel lui-même avant le recadrage —
 * distinct de `rotated` (Portrait/Paysage du modèle) ailleurs dans l'app :
 * ici c'est l'image qui tourne dans son cadre, pas le cadre qui change de
 * forme. Une rotation à angle droit n'a pas besoin de fond de secours
 * (`sharp` réoriente les pixels sans ajouter de bord).
 *
 * `image` null : aucun visuel de fond choisi — un canvas blanc à la taille
 * cible, directement (rien à recadrer). Permet un montage fait seulement de
 * calques (texte/image/forme, voir lib/design/layers.ts), sans visuel.
 */
export async function coverCropToBuffer(
  image: Buffer | null,
  targetWidthPx: number,
  targetHeightPx: number,
  positionX = 0.5,
  positionY = 0.5,
  zoom = 1,
  rotation = 0
): Promise<Buffer> {
  const { pipeline, inheritsFormat } = await coverCropPipeline(
    image,
    targetWidthPx,
    targetHeightPx,
    positionX,
    positionY,
    zoom,
    rotation
  );
  // Recadrage simple : même format que la source (comportement d'origine).
  // Fond blanc ajouté ou canvas synthétique : pas de format à hériter, il faut
  // le préciser, sinon le buffer n'est pas une image ré-décodable.
  return inheritsFormat ? pipeline.toBuffer() : pipeline.png().toBuffer();
}

/**
 * Même recadrage que `coverCropToBuffer`, mais renvoyé comme pipeline sharp
 * non encodé : l'appelant choisit l'encodage final. Le PDF d'impression
 * (generate.ts) encode ainsi une seule fois, en JPEG 92, au lieu de passer
 * par un JPEG intermédiaire (qualité 80 par défaut de sharp) puis de le
 * ré-encoder — chaque génération JPEG dégrade un peu l'image.
 *
 * Orientation EXIF, rotation, redimensionnement, découpe et fond blanc sont
 * enchaînés dans un seul pipeline (un seul décodage). Le fond blanc du
 * dézoom aplatit la transparence, comme le faisait la composition sur un
 * canvas blanc.
 */
export async function coverCropPipeline(
  image: Buffer | null,
  targetWidthPx: number,
  targetHeightPx: number,
  positionX = 0.5,
  positionY = 0.5,
  zoom = 1,
  rotation = 0
): Promise<{ pipeline: Sharp; inheritsFormat: boolean }> {
  if (!image) {
    return {
      pipeline: sharp({
        create: { width: targetWidthPx, height: targetHeightPx, channels: 3, background: "#ffffff" },
      }),
      inheritsFormat: false,
    };
  }
  // Orientation EXIF (photo de téléphone) d'abord : le navigateur la respecte
  // à l'écran, le recadrage doit partir de la même image droite. sharp admet
  // l'orientation automatique suivie d'une rotation dans le même pipeline.
  const meta = await sharp(image).metadata();
  const quarterTurn = rotation % 180 !== 0;
  const uprightW = meta.autoOrient?.width ?? meta.width ?? targetWidthPx;
  const uprightH = meta.autoOrient?.height ?? meta.height ?? targetHeightPx;
  const origW = quarterTurn ? uprightH : uprightW;
  const origH = quarterTurn ? uprightW : uprightH;
  const coverScale = Math.max(targetWidthPx / origW, targetHeightPx / origH);
  const scale = coverScale * Math.max(0.1, zoom);
  const scaledW = Math.max(1, Math.round(origW * scale));
  const scaledH = Math.max(1, Math.round(origH * scale));

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

  let pipeline = sharp(image).rotate();
  if (rotation) pipeline = pipeline.rotate(rotation);
  pipeline = pipeline.resize(scaledW, scaledH);

  if (scaledW >= targetWidthPx && scaledH >= targetHeightPx) {
    // Comportement d'origine : l'image dépasse (ou remplit tout juste) la
    // cible dans les deux sens, on découpe l'excédent (extract après resize).
    const left = Math.round((scaledW - targetWidthPx) * clamp01(positionX));
    const top = Math.round((scaledH - targetHeightPx) * clamp01(positionY));
    return {
      pipeline: pipeline.extract({ left, top, width: targetWidthPx, height: targetHeightPx }),
      inheritsFormat: true,
    };
  }

  // Dézoomé : l'image est plus petite que la cible dans au moins un sens —
  // la poser sur un fond blanc à la taille cible plutôt que d'extraire
  // (sharp refuse un extract plus grand que la source). Si un seul des deux
  // sens dépasse encore (image très étirée), le ramener d'abord à la taille
  // cible.
  const clampedW = Math.min(scaledW, targetWidthPx);
  const clampedH = Math.min(scaledH, targetHeightPx);
  if (clampedW < scaledW || clampedH < scaledH) {
    pipeline = pipeline.extract({
      left: Math.round((scaledW - clampedW) * clamp01(positionX)),
      top: Math.round((scaledH - clampedH) * clamp01(positionY)),
      width: clampedW,
      height: clampedH,
    });
  }
  const left = Math.round((targetWidthPx - clampedW) * clamp01(positionX));
  const top = Math.round((targetHeightPx - clampedH) * clamp01(positionY));
  return {
    pipeline: pipeline
      .flatten({ background: "#ffffff" })
      .extend({
        left,
        top,
        right: targetWidthPx - clampedW - left,
        bottom: targetHeightPx - clampedH - top,
        background: "#ffffff",
      }),
    inheritsFormat: false,
  };
}
