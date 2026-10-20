import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ALLOWED_VISUAL_TYPES, prepareUploadedFile } from "@/lib/visualUpload";
import { storageFileName } from "@/lib/storageName";

export const runtime = "nodejs"; // la rasterisation PDF a besoin du runtime Node, pas Edge.

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const formData = await request.formData();
  const name = formData.get("name");
  const file = formData.get("file");
  const collectionId = formData.get("collectionId");

  if (typeof name !== "string") {
    return NextResponse.json({ error: "Paramètre manquant (name)." }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    name,
    collection_id: typeof collectionId === "string" && collectionId ? collectionId : null,
  };

  if (file instanceof File && file.size > 0) {
    if (!ALLOWED_VISUAL_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Format non supporté (SVG, PNG, JPG ou PDF uniquement)." },
        { status: 400 }
      );
    }
    let prepared;
    try {
      prepared = await prepareUploadedFile(file);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur lors du traitement du fichier.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    const filePath = `${params.id}/${storageFileName(prepared.filename)}`;
    const { error: uploadError } = await supabase.storage
      .from("visuals")
      .upload(filePath, prepared.buffer, { contentType: prepared.contentType, upsert: true });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
    update.file_path = filePath;
    update.mime_type = prepared.contentType;
  }

  const { data, error } = await supabase
    .from("visuals")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ visual: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data, error } = await supabase.from("visuals").delete().eq("id", params.id).select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Visuel introuvable ou suppression non autorisée." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
