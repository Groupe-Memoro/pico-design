// Codes-barres des cartes étudiantes, en vectoriel (bwip-js) : nets à toute
// résolution d'imprimante. Serveur seulement (l'éditeur passe par
// /api/student-cards/barcode, qui rend le même SVG).

import bwipjs from "bwip-js/node";
import { BARCODE_TYPES, TWO_D_BARCODES, type BarcodeType } from "./types";

export interface BarcodeGeometry {
  // Taille du dessin, en unités du SVG.
  viewWidth: number;
  viewHeight: number;
  // Tracés : remplis, ou des traits (barres) d'épaisseur strokeWidth.
  paths: { d: string; strokeWidth: number | null }[];
  svg: string;
}

export class BarcodeError extends Error {}

// Codabar : des lettres de départ et d'arrêt (A à D) ; une valeur qui n'en a
// pas reçoit A…A, comme le font la plupart des systèmes de bibliothèque.
function prepareText(type: BarcodeType, text: string): string {
  if (type === "rationalizedCodabar" && !/^[A-D].*[A-D]$/i.test(text)) return `A${text}A`;
  return text;
}

function render(type: BarcodeType, text: string, showText: boolean, heightMm?: number): string {
  const encoded = prepareText(type, text);
  return bwipjs.toSVG({
    bcid: type,
    text: encoded,
    includetext: showText && !TWO_D_BARCODES.includes(type),
    textxalign: "center",
    // Sous les barres, la valeur seule : pas les lettres A…A ajoutées au Codabar.
    ...(encoded !== text ? { alttext: text } : {}),
    ...(heightMm ? { height: heightMm } : {}),
  });
}

// Erreur de bwip-js (« bwipp.ean13badLength#6878: EAN-13 must be… ») en
// français : la cause la plus courante, sinon le message d'origine.
function barcodeErrorMessage(type: BarcodeType, text: string, raw: string): string {
  const code = raw.match(/^bwipp\.(\w+)/)?.[1] ?? "";
  const detail = raw.replace(/^bwipp\.\w+(#\d+)?:\s*/, "");
  const name = BARCODE_TYPES[type];
  let why: string;
  if (/badLength/i.test(code)) {
    why =
      type === "ean13"
        ? "un EAN-13 demande 12 ou 13 chiffres"
        : type === "interleaved2of5"
          ? "l'entrelacé 2 de 5 demande un nombre pair de chiffres"
          : `longueur invalide pour un ${name}`;
  } else if (/badCharacter|badChar/i.test(code)) {
    why =
      type === "rationalizedCodabar"
        ? "le Codabar n'accepte que des chiffres et - $ : / . +"
        : type === "code39"
          ? "le Code 39 n'accepte que les majuscules, les chiffres et - . $ / + % espace"
          : `caractère non permis dans un ${name}`;
  } else {
    why = detail;
  }
  return `« ${text} » ne peut pas être codé en ${name} : ${why}.`;
}

function viewBoxOf(svg: string): [number, number] {
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return m ? [Number(m[1]), Number(m[2])] : [1, 1];
}

/**
 * Le code-barres d'une valeur, proportionné à sa zone (`boxWidthMm` ×
 * `boxHeightMm`, contenu non tourné) : un code linéaire prend la hauteur qui
 * donne les proportions de la zone — il la remplit sans être déformé, texte
 * compris ; un code 2D (QR…) reste carré, centré.
 */
export function barcodeGeometry(
  type: BarcodeType,
  text: string,
  boxWidthMm: number,
  boxHeightMm: number,
  showText: boolean
): BarcodeGeometry {
  if (!text) throw new BarcodeError("Valeur vide.");
  let svg: string;
  try {
    if (TWO_D_BARCODES.includes(type)) {
      svg = render(type, text, showText);
    } else {
      // La hauteur du dessin varie linéairement avec celle des barres : deux
      // essais donnent la droite, d'où la hauteur qui épouse la zone.
      const [w, h10] = viewBoxOf(render(type, text, showText, 10));
      const [, h20] = viewBoxOf(render(type, text, showText, 20));
      const perMm = (h20 - h10) / 10;
      const fixed = h10 - perMm * 10;
      const target = (w * boxHeightMm) / boxWidthMm;
      const heightMm = Math.max(2, (target - fixed) / perMm);
      svg = render(type, text, showText, heightMm);
    }
  } catch (err) {
    throw new BarcodeError(barcodeErrorMessage(type, text, err instanceof Error ? err.message : String(err)));
  }
  const [viewWidth, viewHeight] = viewBoxOf(svg);
  const paths = Array.from(svg.matchAll(/<path([^>]*)\/>/g), (m) => {
    const attrs = m[1];
    const d = attrs.match(/\sd="([^"]+)"/)?.[1] ?? "";
    const stroke = attrs.match(/stroke-width="([\d.]+)"/)?.[1];
    return { d, strokeWidth: stroke ? Number(stroke) : null };
  }).filter((p) => p.d);
  return { viewWidth, viewHeight, paths, svg };
}
