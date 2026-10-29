import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ImpositionError } from "@/lib/imposition/build";
import { saveImposition } from "@/lib/imposition/persist";
import { requireApiUser } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300; // plusieurs feuilles (fichier de plusieurs pages)

// Enregistre une nouvelle imposition (nom, configuration et PDF).
export async function POST(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase, user } = session;

  try {
    const saved = await saveImposition(await request.formData(), randomUUID(), user.id, null);
    return NextResponse.json({ imposition: saved });
  } catch (err) {
    if (err instanceof ImpositionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur lors de l'enregistrement." }, { status: 500 });
  }
}
