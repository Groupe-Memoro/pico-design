import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ImpositionError, buildImposition } from "@/lib/imposition/build";
import { formatInches } from "@/lib/imposition/presets";

export const runtime = "nodejs";
export const maxDuration = 300; // plusieurs feuilles (fichier de plusieurs pages)

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Aperçu : génère le PDF imposé sans l'enregistrer.
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorResponse("Non authentifié.", 401);

  try {
    const { pdf, sheet } = await buildImposition(await request.formData());
    const filename = `imposition-${formatInches(sheet.width_mm)}x${formatInches(sheet.height_mm)}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ImpositionError) return errorResponse(err.message, err.status);
    return errorResponse(err instanceof Error ? err.message : "Erreur lors de la génération.");
  }
}
