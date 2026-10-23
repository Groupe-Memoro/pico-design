// Fonds des pages à données variables (recto, verso) : cartes étudiantes
// dans le bucket privé "student-cards", gabarits dans "data-templates", sous
// <id du document>/.

import type { createAdminSupabaseClient } from "@/lib/supabase/server";
import { detectMarksKind } from "@/lib/imposition/marks";
import { CARD_SIDES, CARD_SIDE_LABELS, type CardSide } from "./types";

type Storage = ReturnType<typeof createAdminSupabaseClient>["storage"];
type Columns = Partial<Record<"front_path" | "back_path", string | null>>;

export const STUDENT_CARDS_BUCKET = "student-cards";
export const SIDE_COLUMN: Record<CardSide, "front_path" | "back_path"> = { front: "front_path", back: "back_path" };

const CONTENT_TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg" } as const;

export class CardAssetError extends Error {}

/**
 * Applique aux fonds du modèle ce que le formulaire demande : un fichier reçu
 * (champ `front` ou `back`) remplace l'actuel, `remove_<face>` le retire.
 * Renvoie les colonnes qui changent.
 */
export async function applyCardBackgrounds(
  storage: Storage,
  templateId: string,
  form: FormData,
  current: Columns,
  bucket = STUDENT_CARDS_BUCKET
): Promise<Columns> {
  const changes: Columns = {};
  for (const side of CARD_SIDES) {
    const column = SIDE_COLUMN[side];
    const file = form.get(side);
    const previous = current[column] ?? null;
    if (file instanceof File && file.size > 0) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = detectMarksKind(bytes);
      if (!kind) throw new CardAssetError(`Fond du ${CARD_SIDE_LABELS[side].toLowerCase()} : PDF, PNG ou JPEG attendu.`);
      const path = `${templateId}/${side}.${kind}`;
      const { error } = await storage
        .from(bucket)
        .upload(path, bytes, { contentType: CONTENT_TYPES[kind], upsert: true });
      if (error) throw new CardAssetError(`Enregistrement de « ${file.name} » impossible : ${error.message}`);
      if (previous && previous !== path) await storage.from(bucket).remove([previous]);
      changes[column] = path;
    } else if (form.get(`remove_${side}`) === "true" && previous) {
      await storage.from(bucket).remove([previous]);
      changes[column] = null;
    }
  }
  return changes;
}
