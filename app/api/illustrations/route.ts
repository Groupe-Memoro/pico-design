import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import {
  ILLUSTRATIONS_BUCKET,
  MAX_ILLUSTRATION_BYTES,
  detectIllustrationType,
  illustrationPath,
  nameFromFileName,
} from "@/lib/illustrations";
import { requireApiUser } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

// Ajoute une ou plusieurs illustrations à la banque (champ `files`, en
// multipart). Chacune prend le nom de son fichier, modifiable ensuite. Un
// fichier refusé n'empêche pas les autres d'entrer : la réponse liste les deux.
export async function POST(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase, user } = session;

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });

  const storage = createAdminSupabaseClient().storage.from(ILLUSTRATIONS_BUCKET);
  const created = [];
  const refused: { name: string; reason: string }[] = [];

  for (const file of files) {
    if (file.size > MAX_ILLUSTRATION_BYTES) {
      refused.push({ name: file.name, reason: `trop lourd (${Math.round(file.size / 1048576)} Mo, maximum 15 Mo)` });
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = detectIllustrationType(bytes);
    if (!mime) {
      refused.push({ name: file.name, reason: "format non accepté (PNG, JPEG, WebP ou SVG)" });
      continue;
    }

    const id = randomUUID();
    const path = illustrationPath(id, mime);
    const { error: uploadError } = await storage.upload(path, bytes, { contentType: mime, upsert: false });
    if (uploadError) {
      refused.push({ name: file.name, reason: "envoi impossible" });
      continue;
    }
    const { data, error } = await supabase
      .from("illustrations")
      .insert({ id, name: nameFromFileName(file.name) || "Illustration", file_path: path, mime_type: mime, created_by: user.id })
      .select()
      .single();
    if (error) {
      await storage.remove([path]);
      refused.push({ name: file.name, reason: "enregistrement impossible" });
      continue;
    }
    created.push(data);
  }

  return NextResponse.json({ created, refused }, { status: created.length > 0 ? 200 : 400 });
}
