import { createClient } from "@/lib/supabase/client";
import { STAGING_BUCKET, encodeStaged } from "@/lib/design/staging";

/**
 * Côté navigateur : avant d'appeler une route de rendu de l'outil de design,
 * dépose les fichiers lourds DIRECTEMENT dans le stockage et ne garde dans
 * le FormData que leur référence (voir lib/design/staging.ts). Vercel refuse
 * toute requête de plus de 4,5 Mo avant même d'atteindre la route ; le
 * serveur relit ensuite les fichiers (lib/design/stagedFiles.ts).
 *
 * Chaque fichier n'est déposé qu'une fois par page : l'aperçu, les mockups,
 * le PDF et l'enregistrement réutilisent le même dépôt.
 */

// Au-dessus, le fichier passe par le stockage ; en dessous, il reste dans la
// requête (les petits calques, les illustrations).
const INLINE_MAX_BYTES = 256 * 1024;

const staged = new WeakMap<File, Promise<string>>();

export async function stageLargeFiles(formData: FormData): Promise<FormData> {
  const entries = Array.from(formData.entries());
  const toStage = Array.from(
    new Set(
      entries
        .map(([, value]) => value)
        .filter((value): value is File => value instanceof File && value.size > INLINE_MAX_BYTES && !staged.has(value)),
    ),
  );

  if (toStage.length > 0) {
    // Une seule demande d'adresses pour tout le lot. La promesse est posée
    // tout de suite : deux appels simultanés (mockups recto et verso)
    // attendent le même dépôt au lieu d'envoyer deux fois le fichier.
    const batch = requestUploads(formData, toStage);
    toStage.forEach((file, i) => {
      staged.set(
        file,
        batch.then(async (uploads) => {
          const { path, token } = uploads[i];
          const { error } = await createClient()
            .storage.from(STAGING_BUCKET)
            .uploadToSignedUrl(path, token, file, { contentType: file.type || "application/octet-stream" });
          if (error) throw new Error(`Envoi de « ${file.name} » impossible : ${error.message}`);
          return encodeStaged({ path, name: file.name, type: file.type });
        }),
      );
    });
  }

  const result = new FormData();
  for (const [key, value] of entries) {
    const ref = value instanceof File ? staged.get(value) : undefined;
    if (ref) {
      try {
        result.append(key, await ref);
      } catch (err) {
        // Un dépôt raté ne doit pas rester en cache : le prochain essai
        // recommence l'envoi.
        staged.delete(value as File);
        throw err;
      }
    } else {
      result.append(key, value);
    }
  }
  return result;
}

/**
 * Dépose d'avance, en arrière-plan, les fichiers que le client vient de
 * choisir dans l'éditeur : quand il ouvre « Ton design », la photo est déjà
 * sur le serveur au lieu de partir à ce moment-là (plusieurs secondes pour une
 * photo de téléphone). Même cache que stageLargeFiles, donc aucun double
 * envoi ; un échec est oublié et l'envoi sera retenté au rendu.
 */
export function prestageFiles(files: (File | null | undefined)[], templateId: string, grant?: string): void {
  const formData = new FormData();
  formData.append("templateId", templateId);
  if (grant) formData.append("grant", grant);
  files.forEach((file, i) => {
    if (file) formData.append(`file${i}`, file);
  });
  stageLargeFiles(formData).catch(() => {});
}

async function requestUploads(formData: FormData, files: File[]): Promise<{ path: string; token: string }[]> {
  const res = await fetch("/api/design/stage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      templateId: formData.get("templateId"),
      grant: formData.get("grant"),
      files: files.map((f) => ({ size: f.size, type: f.type })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data.uploads) || data.uploads.length !== files.length) {
    throw new Error(data.error ?? "Préparation de l'envoi des fichiers impossible.");
  }
  return data.uploads;
}
