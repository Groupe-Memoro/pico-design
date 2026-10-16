/**
 * En-tête Content-Disposition d'un fichier à nom accentué (« Dépliant -
 * Plié roulé.pdf »). Un en-tête HTTP ne transporte que du Latin-1 : le nom
 * brut en UTF-8 arrive en « DÃ©pliant ». `filename*` (RFC 6266) porte le vrai
 * nom, encodé ; `filename`, sans accents, sert aux clients qui l'ignorent.
 */
export function contentDisposition(filename: string, type: "attachment" | "inline" = "attachment"): string {
  const ascii =
    filename
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7e]|["\\]/g, "_")
      .trim() || "fichier";
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Le nom d'un fichier reçu, lu dans son en-tête Content-Disposition.
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Encodage invalide : on retombe sur filename.
    }
  }
  return header.match(/filename="([^"]+)"/)?.[1] ?? null;
}
