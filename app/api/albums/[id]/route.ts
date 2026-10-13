import { NextResponse } from "next/server";
import { albumStorage, jsonError, sessionClient } from "@/lib/albums/server";
import { albumSettings } from "@/lib/albums/types";

export const runtime = "nodejs";

const number = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

// Modifie l'album : nom, école, année, format (mm), fond perdu, réglages.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["name", "school", "year"] as const) {
    if (typeof body[key] === "string") update[key] = (body[key] as string).trim();
  }
  if (update.name === "") return jsonError("Le nom ne peut pas être vide.");
  const width = number(body.width_mm, 50, 600);
  const height = number(body.height_mm, 50, 600);
  const bleed = number(body.bleed_mm, 0, 20);
  if (width !== undefined) update.width_mm = width;
  if (height !== undefined) update.height_mm = height;
  if (bleed !== undefined) update.bleed_mm = bleed;
  if (body.settings !== undefined) update.settings = albumSettings(body.settings);

  const { error } = await session.supabase.from("albums").update(update).eq("id", params.id);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}

// Supprime l'album, ses élèves, ses pages (cascade) et tous ses fichiers.
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);

  const storage = albumStorage();
  for (const folder of ["photos", "thumbs", ""]) {
    const prefix = folder ? `${params.id}/${folder}` : params.id;
    // Par lots : list() renvoie 100 fichiers par défaut.
    for (;;) {
      const { data } = await storage.list(prefix, { limit: 1000 });
      const files = (data ?? []).filter((f) => f.id).map((f) => `${prefix}/${f.name}`);
      if (files.length === 0) break;
      await storage.remove(files);
      if (files.length < 1000) break;
    }
  }

  const { error } = await session.supabase.from("albums").delete().eq("id", params.id);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}
