// Fichiers d'un profil de découpe (marques, gabarit) dans le stockage privé
// "imposition". Partagé par la création (POST) et la modification (PATCH).

import type { createAdminSupabaseClient } from "@/lib/supabase/server";
import { detectMarksKind } from "./marks";
import { ASSET_COLUMN, CONTENT_TYPES, CUTTER_ASSETS, cutterAssetPath } from "./cutters";

type Storage = ReturnType<typeof createAdminSupabaseClient>["storage"];

const BUCKET = "imposition";

export class CutterAssetError extends Error {}

/**
 * Applique aux fichiers du profil ce que le formulaire demande : un fichier
 * reçu (champ `marks` ou `guide`) remplace l'actuel, `remove_marks` /
 * `remove_guide` le retire. Renvoie les colonnes de chemins à écrire en base
 * (seulement celles qui changent).
 */
export async function applyCutterAssets(
  storage: Storage,
  cutterId: string,
  form: FormData,
  current: { marks_path: string | null; guide_path: string | null }
): Promise<Partial<Record<"marks_path" | "guide_path", string | null>>> {
  const changes: Partial<Record<"marks_path" | "guide_path", string | null>> = {};
  for (const asset of CUTTER_ASSETS) {
    const column = ASSET_COLUMN[asset];
    const file = form.get(asset);
    const previous = current[column];

    if (file instanceof File && file.size > 0) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = detectMarksKind(bytes);
      if (!kind) {
        const label = asset === "marks" ? "Le fichier de marques" : "Le gabarit de guidage";
        throw new CutterAssetError(`${label} doit être un PDF, un PNG ou un JPEG.`);
      }
      const path = cutterAssetPath(cutterId, asset, kind);
      const { error } = await storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: CONTENT_TYPES[kind], upsert: true });
      if (error) {
        console.error(`Enregistrement de « ${file.name} » impossible.`, error);
        throw new CutterAssetError(`Enregistrement de « ${file.name} » impossible.`);
      }
      // Un PNG remplacé par un PDF n'a pas le même chemin : l'ancien est retiré.
      if (previous && previous !== path) await storage.from(BUCKET).remove([previous]);
      changes[column] = path;
    } else if (form.get(`remove_${asset}`) === "true" && previous) {
      await storage.from(BUCKET).remove([previous]);
      changes[column] = null;
    }
  }
  return changes;
}
