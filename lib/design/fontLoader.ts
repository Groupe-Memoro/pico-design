import { fontOptionById } from "@/lib/design/fonts";

/**
 * Navigateur : feuille de style Google Fonts d'une police du catalogue
 * (normal, gras et leurs italiques disponibles), ajoutée une seule fois à la
 * page. La promesse se résout quand la feuille est chargée — ses @font-face
 * existent alors, et document.fonts.load peut attendre la police elle-même.
 * Sans effet pour les polices fournies (déclarées dans globals.css).
 */
const pending = new Map<string, Promise<void>>();

export function ensureFontCss(fontId: string): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  const font = fontOptionById(fontId);
  if (!font.google) return Promise.resolve();
  const existing = pending.get(font.family);
  if (existing) return existing;

  const nearest = (list: number[], target: number) =>
    list.reduce((best, w) => (Math.abs(w - target) < Math.abs(best - target) ? w : best), list[0]);
  const weights = Array.from(new Set([font.weightRegular, font.weightBold]));
  const italics = font.italicWeights?.length
    ? Array.from(new Set(weights.map((w) => nearest(font.italicWeights!, w))))
    : [];
  // Google exige les couples triés : italique (0, 1), puis graisse.
  const pairs = [...weights.sort((a, b) => a - b).map((w) => `0,${w}`), ...italics.sort((a, b) => a - b).map((w) => `1,${w}`)];
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family).replace(/%20/g, "+")}:ital,wght@${pairs.join(";")}&display=swap`;

  const promise = new Promise<void>((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    // Introuvable : la police de secours s'affiche, sans bloquer.
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
  pending.set(font.family, promise);
  return promise;
}

// Feuille de style chargée, puis la police elle-même (`spec` : syntaxe CSS
// « font », ex. `italic 700 20px "Pacifico"`).
export async function loadFont(fontId: string, spec: string): Promise<void> {
  await ensureFontCss(fontId);
  await document.fonts.load(spec).catch(() => null);
}
