import { NextResponse } from "next/server";
import { jsonError, sessionClient } from "@/lib/albums/server";
import { ALBUM_FORMATS, DEFAULT_ALBUM_SETTINGS, defaultContent } from "@/lib/albums/types";
import { serverError } from "@/lib/api";

export const runtime = "nodejs";

// Crée un album, avec ses blocs de départ : couverture, portraits, signatures.
export async function POST(request: Request) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);
  const { supabase, user } = session;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("Nom de l'album manquant.");
  const format = ALBUM_FORMATS.find((f) => f.id === body.formatId) ?? ALBUM_FORMATS[0];
  const school = typeof body.school === "string" ? body.school.trim() : "";
  const year = typeof body.year === "string" ? body.year.trim() : "";

  const { data: album, error } = await supabase
    .from("albums")
    .insert({
      name,
      school,
      year,
      width_mm: format.widthMm,
      height_mm: format.heightMm,
      settings: DEFAULT_ALBUM_SETTINGS,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !album) return serverError(error, "Création impossible.");

  const cover = { ...defaultContent("cover"), title: year ? `Finissants ${year}` : "Finissants", subtitle: school };
  await supabase.from("album_pages").insert([
    { album_id: album.id, position: 0, kind: "cover", content: cover },
    { album_id: album.id, position: 1, kind: "portraits", content: defaultContent("portraits") },
    { album_id: album.id, position: 2, kind: "signatures", content: defaultContent("signatures") },
  ]);

  return NextResponse.json({ id: album.id });
}
