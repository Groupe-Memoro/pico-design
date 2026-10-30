import { requireApiUser, serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { ALLOWED_VISUAL_TYPES, prepareUploadedFile } from "@/lib/visualUpload";
import { storageFileName } from "@/lib/storageName";
import { detectPattern } from "@/lib/visualPattern";

export const runtime = "nodejs"; // la rasterisation PDF a besoin du runtime Node, pas Edge.

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const formData = await request.formData();
  const name = formData.get("name");
  const file = formData.get("file");
  const collectionId = formData.get("collectionId");
  const isPattern = formData.get("isPattern");

  if (typeof name !== "string") {
    return NextResponse.json({ error: "Paramètre manquant (name)." }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    name,
    collection_id: typeof collectionId === "string" && collectionId ? collectionId : null,
  };
  // Absent = inchangé ; "auto" = deviné d'après l'image (voir plus bas).
  if (isPattern === "true" || isPattern === "false") update.is_pattern = isPattern === "true";

  let previousPath: string | null = null;
  if (file instanceof File && file.size > 0) {
    const { data: current } = await supabase
      .from("visuals")
      .select("file_path")
      .eq("id", params.id)
      .single<{ file_path: string | null }>();
    previousPath = current?.file_path ?? null;
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
    // Chemin unique à chaque remplacement : la vignette est mise en cache par
    // le navigateur selon ce chemin (voir thumbnail/route.ts), un fichier de
    // même nom écrasé sur place resterait affiché avec l'ancienne image.
    const filePath = `${params.id}/${Date.now().toString(36)}-${storageFileName(prepared.filename)}`;
    const { error: uploadError } = await supabase.storage
      .from("visuals")
      .upload(filePath, prepared.buffer, { contentType: prepared.contentType, upsert: true });
    if (uploadError) {
      return serverError(uploadError, "Impossible d'enregistrer le visuel.");
    }
    update.file_path = filePath;
    update.mime_type = prepared.contentType;
    if (isPattern === "auto") update.is_pattern = await detectPattern(prepared.buffer, prepared.contentType);
  }
  if (isPattern === "auto" && update.is_pattern === undefined) {
    // Pas de nouveau fichier : détection sur le fichier actuel.
    const { data: current } = await supabase
      .from("visuals")
      .select("file_path, mime_type")
      .eq("id", params.id)
      .single<{ file_path: string; mime_type: string }>();
    const { data: blob } = current ? await supabase.storage.from("visuals").download(current.file_path) : { data: null };
    if (current && blob) update.is_pattern = await detectPattern(Buffer.from(await blob.arrayBuffer()), current.mime_type);
  }

  const { data, error } = await supabase
    .from("visuals")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    // La ligne pointe toujours vers l'ancien fichier : retirer le nouveau, orphelin.
    if (typeof update.file_path === "string") {
      await supabase.storage.from("visuals").remove([update.file_path]).catch(() => {});
    }
    return serverError(error, "Impossible de mettre à jour le visuel.");
  }
  // L'ancien fichier n'est plus référencé (les produits relisent le chemin du
  // visuel à chaque rendu) : le retirer, sans bloquer si ça échoue.
  if (previousPath && previousPath !== update.file_path) {
    await supabase.storage.from("visuals").remove([previousPath]).catch(() => {});
  }
  return NextResponse.json({ visual: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { data, error } = await supabase.from("visuals").delete().eq("id", params.id).select();

  if (error) return serverError(error, "Impossible de supprimer le visuel.");
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Visuel introuvable ou suppression non autorisée." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
