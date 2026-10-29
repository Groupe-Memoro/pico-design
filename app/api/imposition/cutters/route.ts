import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { CUTTER_ASSETS, cutterAssetPath, parseCutterForm } from "@/lib/imposition/cutters";
import { CutterAssetError, applyCutterAssets } from "@/lib/imposition/cutterAssets";
import { requireApiUser, serverError } from "@/lib/api";

export const runtime = "nodejs";

// Crée un profil de découpe Graphtec (champs + fichiers de marques et de gabarit, en multipart).
export async function POST(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase, user } = session;

  const form = await request.formData();
  const parsed = parseCutterForm(form);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data: cutter, error } = await supabase
    .from("imposition_cutters")
    .insert({ ...parsed.fields, machine: "graphtec", created_by: user.id })
    .select()
    .single();
  if (error || !cutter) return serverError(error, "Création impossible.");

  // Les fichiers se rangent sous l'id du profil : ils ne peuvent être envoyés qu'une fois la ligne créée.
  const storage = createAdminSupabaseClient().storage;
  try {
    const paths = await applyCutterAssets(storage, cutter.id, form, {
      marks_path: null,
      guide_path: null,
    });
    if (Object.keys(paths).length === 0) return NextResponse.json({ cutter });
    const { data: updated, error: updateError } = await supabase
      .from("imposition_cutters")
      .update(paths)
      .eq("id", cutter.id)
      .select()
      .single();
    if (updateError) {
      // Erreur de la base, pas du fichier envoyé : détail aux journaux, 500 générique.
      console.error("Mise à jour du profil de découpe impossible.", updateError);
      throw new Error("Création impossible.");
    }
    return NextResponse.json({ cutter: updated });
  } catch (err) {
    // Pas de profil à moitié créé : sans ses fichiers, on le retire, avec ce
    // qui a déjà pu être envoyé.
    await supabase.from("imposition_cutters").delete().eq("id", cutter.id);
    await storage
      .from("imposition")
      .remove(CUTTER_ASSETS.flatMap((a) => (["pdf", "png", "jpg"] as const).map((k) => cutterAssetPath(cutter.id, a, k))));
    const status = err instanceof CutterAssetError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Création impossible." }, { status });
  }
}
