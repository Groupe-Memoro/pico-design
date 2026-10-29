import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validateDuploJobs } from "@/lib/imposition/duplo";
import { serverError } from "@/lib/api";

async function currentUser() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// Remplace le catalogue par le contenu d'un fichier AllJobs : les jobs déjà
// connus (même numéro) sont mis à jour en gardant leur identifiant, les
// nouveaux sont ajoutés, ceux qui ne sont plus dans le fichier sont retirés.
export async function PUT(request: Request) {
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const parsed = validateDuploJobs(await request.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { error: upsertError } = await supabase
    .from("imposition_duplo_jobs")
    .upsert(
      parsed.rows.map((row) => ({ ...row, created_by: user.id })),
      { onConflict: "job_no" }
    );
  if (upsertError) return serverError(upsertError, "Impossible d'enregistrer les jobs Duplo.");

  const { error: deleteError } = await supabase
    .from("imposition_duplo_jobs")
    .delete()
    .not("job_no", "in", `(${parsed.rows.map((r) => r.job_no).join(",")})`);
  if (deleteError) return serverError(deleteError, "Impossible d'enregistrer les jobs Duplo.");

  return NextResponse.json({ count: parsed.rows.length });
}

// Vide le catalogue.
export async function DELETE() {
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const { error } = await supabase.from("imposition_duplo_jobs").delete().gt("job_no", 0);
  if (error) return serverError(error, "Impossible de supprimer les jobs Duplo.");
  return NextResponse.json({ ok: true });
}
