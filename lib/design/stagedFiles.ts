import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { STAGING_BUCKET, decodeStaged } from "@/lib/design/staging";

/**
 * Remet en place, dans le FormData reçu, les fichiers que le navigateur a
 * déposés directement dans le stockage (voir lib/design/stageUpload.ts) :
 * chaque référence redevient le File d'origine. Le reste de la route
 * travaille ensuite exactement comme si le fichier avait été envoyé dans la
 * requête — mêmes contrôles de taille (publicUploadError), même rendu.
 *
 * Lève une erreur si un fichier déposé est introuvable.
 */
export async function hydrateStagedFiles(formData: FormData): Promise<FormData> {
  const entries = Array.from(formData.entries());
  if (!entries.some(([, value]) => decodeStaged(value))) return formData;

  const storage = createAdminSupabaseClient().storage;
  const resolved = await Promise.all(
    entries.map(async ([key, value]): Promise<[string, FormDataEntryValue]> => {
      const ref = decodeStaged(value);
      if (!ref) return [key, value];
      const { data, error } = await storage.from(ref.bucket ?? STAGING_BUCKET).download(ref.path);
      if (error || !data) throw new Error("Un fichier envoyé est introuvable. Réessaie.");
      return [key, new File([await data.arrayBuffer()], ref.name, { type: ref.type || data.type })];
    }),
  );

  const hydrated = new FormData();
  for (const [key, value] of resolved) hydrated.append(key, value);
  return hydrated;
}
