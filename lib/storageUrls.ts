import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Adresses signées de plusieurs fichiers d'un même bucket, en UNE requête à
 * Supabase (par tranches de 500) au lieu d'une par fichier — les pages de
 * liste (visuels, thèmes, produits…) en signaient des centaines à chaque
 * chargement. Les chemins vides sont ignorés ; un fichier introuvable n'a
 * simplement pas d'adresse.
 */
export async function signedUrls(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any>,
  bucket: string,
  paths: (string | null | undefined)[],
  expiresIn = 60 * 30
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(paths.filter((p): p is string => Boolean(p))));
  const urls = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 500) {
    const { data } = await client.storage.from(bucket).createSignedUrls(unique.slice(i, i + 500), expiresIn);
    for (const row of data ?? []) {
      if (row.path && row.signedUrl) urls.set(row.path, row.signedUrl);
    }
  }
  return urls;
}
