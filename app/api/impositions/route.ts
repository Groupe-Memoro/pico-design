import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ImpositionError } from "@/lib/imposition/build";
import { saveImposition } from "@/lib/imposition/persist";

export const runtime = "nodejs";
export const maxDuration = 300; // plusieurs feuilles (fichier de plusieurs pages)

// Enregistre une nouvelle imposition (nom, configuration et PDF).
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  try {
    const saved = await saveImposition(await request.formData(), randomUUID(), user.id, null);
    return NextResponse.json({ imposition: saved });
  } catch (err) {
    if (err instanceof ImpositionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur lors de l'enregistrement." }, { status: 500 });
  }
}
