import { requireApiUser, serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ALLOWED_VISUAL_TYPES, prepareUploadedFile } from "@/lib/visualUpload";
import { storageFileName } from "@/lib/storageName";

export const runtime = "nodejs"; // la rasterisation PDF a besoin du runtime Node, pas Edge.

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("visuals")
    .select("*")
    .order("name", { ascending: true });

  if (error) return serverError(error, "Impossible de charger les visuels.");
  return NextResponse.json({ visuals: data });
}

export async function POST(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase, user } = session;

  const formData = await request.formData();
  const name = formData.get("name");
  const file = formData.get("file");
  const collectionId = formData.get("collectionId");

  if (typeof name !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "Paramètres manquants (name, file)." }, { status: 400 });
  }
  if (!ALLOWED_VISUAL_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Format non supporté (SVG, PNG, JPG ou PDF uniquement)." },
      { status: 400 }
    );
  }

  const visualId = randomUUID();
  let prepared;
  try {
    prepared = await prepareUploadedFile(file);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur lors du traitement du fichier.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const filePath = `${visualId}/${storageFileName(prepared.filename)}`;

  const { error: uploadError } = await supabase.storage
    .from("visuals")
    .upload(filePath, prepared.buffer, { contentType: prepared.contentType, upsert: true });
  if (uploadError) {
    return serverError(uploadError, "Impossible d'enregistrer le visuel.");
  }

  const { data, error } = await supabase
    .from("visuals")
    .insert({
      id: visualId,
      name,
      file_path: filePath,
      mime_type: prepared.contentType,
      collection_id: typeof collectionId === "string" && collectionId ? collectionId : null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return serverError(error, "Impossible d'enregistrer le visuel.");
  return NextResponse.json({ visual: data });
}
