/**
 * Nom de fichier utilisable dans une clé de stockage Supabase, qui refuse
 * les accents (« Invalid key » pour « 40X30 École.png »). Les lettres
 * accentuées perdent leur accent (É → E), le reste devient « _ ».
 */
export function storageFileName(name: string, fallback = "fichier"): string {
  const clean = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_(?=\.[^.]*$)|_$/g, "");
  // Au plus 100 caractères, extension comprise.
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 ? clean.slice(dot) : "";
  const base = (dot > 0 ? clean.slice(0, dot) : clean).slice(0, 100 - ext.length);
  return base ? base + ext : fallback + ext;
}
