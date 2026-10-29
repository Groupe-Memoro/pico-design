import { createAdminSupabaseClient } from "@/lib/supabase/server";

/**
 * Design enregistré par un client depuis l'Outil Shopify, avant paiement
 * (voir supabase/migrations/0055_orders.sql).
 *
 * Principe : on conserve **le FormData tel que l'outil l'a composé** — les
 * champs texte dans `payload`, les fichiers dans le bucket `uploads`. Le PDF
 * se fabrique ensuite à la demande en REJOUANT ce FormData à travers le même
 * chemin de rendu que le téléchargement direct (voir renderPdfFromForm). Pas
 * de traduction d'un format vers un autre, donc rien qui puisse diverger.
 */

type Db = ReturnType<typeof createAdminSupabaseClient>;

// Champs à ne pas conserver : ils n'ont de sens que pour la requête en cours.
const VOLATILE_FIELDS = new Set(["grant", "templateId", "rotated", "batchId"]);

export interface DesignSubmission {
  id: string;
  template_id: string;
  rotated: boolean;
  payload: Record<string, string>;
  source_paths: { field: string; path: string; name: string; type: string }[];
  mockup_path: string | null;
  shopify_variant_id: string | null;
  quantity: number;
  created_at: string;
}

/** Sépare le FormData en champs texte (conservés en base) et fichiers. */
export function splitFormData(formData: FormData): {
  fields: Record<string, string>;
  files: { field: string; file: File }[];
} {
  const fields: Record<string, string> = {};
  const files: { field: string; file: File }[] = [];
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      if (value.size > 0) files.push({ field: key, file: value });
    } else if (!VOLATILE_FIELDS.has(key)) {
      fields[key] = value;
    }
  }
  return { fields, files };
}

/**
 * Reconstitue le FormData d'origine pour rejouer le rendu. Les fichiers sont
 * retéléchargés depuis le bucket et réinjectés sous leur champ d'origine :
 * c'est ce qui permet au module Commande d'obtenir exactement le PDF que le
 * client a vu à l'écran.
 */
export async function formDataFromSubmission(db: Db, submission: DesignSubmission): Promise<FormData> {
  const formData = new FormData();
  formData.append("templateId", submission.template_id);
  formData.append("rotated", String(submission.rotated));
  for (const [key, value] of Object.entries(submission.payload ?? {})) formData.append(key, value);

  // Téléchargements en parallèle, ajoutés dans l'ordre d'origine.
  const files = await Promise.all(
    (submission.source_paths ?? []).map(async (entry) => {
      const { data } = await db.storage.from("uploads").download(entry.path);
      if (!data) throw new Error(`Fichier introuvable pour ce design : ${entry.name}.`);
      const buffer = Buffer.from(await data.arrayBuffer());
      return { entry, file: new File([new Uint8Array(buffer)], entry.name, { type: entry.type }) };
    })
  );
  for (const { entry, file } of files) formData.append(entry.field, file);

  return formData;
}
