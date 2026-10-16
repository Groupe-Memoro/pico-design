import sharp from "sharp";

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
  if (!image) {
    return sharp({
      create: { width: targetWidthPx, height: targetHeightPx, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
  }
  // Orientation EXIF (photo de téléphone) d'abord : le navigateur la respecte
  // à l'écran, le recadrage doit partir de la même image droite.
  const exif = (await sharp(image).metadata().catch(() => null))?.orientation ?? 1;
  const upright = exif > 1 ? await sharp(image).rotate().toBuffer() : image;
  const source = rotation ? await sharp(upright).rotate(rotation).toBuffer() : upright;
  const meta = await sharp(source).metadata();
  const origW = meta.width ?? targetWidthPx;
  const origH = meta.height ?? targetHeightPx;
  const coverScale = Math.max(targetWidthPx / origW, targetHeightPx / origH);
  const scale = coverScale * Math.max(0.1, zoom);
  const scaledW = Math.max(1, Math.round(origW * scale));
  const scaledH = Math.max(1, Math.round(origH * scale));

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

  if (scaledW >= targetWidthPx && scaledH >= targetHeightPx) {
    // Comportement d'origine : l'image dépasse (ou remplit tout juste) la
    // cible dans les deux sens, on découpe l'excédent. Redimensionnement et
    // découpe en un seul passage (extract après resize) : un encodage de
    // moins, donc plus rapide et sans perte JPEG intermédiaire.
    const left = Math.round((scaledW - targetWidthPx) * clamp01(positionX));
    const top = Math.round((scaledH - targetHeightPx) * clamp01(positionY));
    return sharp(source)
      .resize(scaledW, scaledH)
      .extract({ left, top, width: targetWidthPx, height: targetHeightPx })
      .toBuffer();
  }

  const resized = await sharp(source).resize(scaledW, scaledH).toBuffer();

  // Dézoomé : l'image est plus petite que la cible dans au moins un sens —
  // la composer sur un fond blanc à la taille cible plutôt que d'extraire
  // (sharp refuse un extract plus grand que la source). Si un seul des deux
  // sens dépasse encore (image très étirée), le ramener d'abord à la taille
  // cible : sharp refuse aussi de composer une image plus grande que le fond.
  const clampedW = Math.min(scaledW, targetWidthPx);
  const clampedH = Math.min(scaledH, targetHeightPx);
  const toComposite =
    clampedW < scaledW || clampedH < scaledH
      ? await sharp(resized)
          .extract({
            left: Math.round((scaledW - clampedW) * clamp01(positionX)),
            top: Math.round((scaledH - clampedH) * clamp01(positionY)),
            width: clampedW,
            height: clampedH,
          })
          .toBuffer()
      : resized;
  const left = Math.round((targetWidthPx - clampedW) * clamp01(positionX));
  const top = Math.round((targetHeightPx - clampedH) * clamp01(positionY));
  return sharp({
    create: { width: targetWidthPx, height: targetHeightPx, channels: 3, background: "#ffffff" },
  })
    .composite([{ input: toComposite, left, top }])
    // Synthétique (`create`) : pas de format à hériter d'un fichier source
    // comme dans la branche ci-dessus — il faut le préciser explicitement,
    // sinon le buffer renvoyé n'est pas une image ré-décodable par l'appelant.
    .png()
    .toBuffer();
}
