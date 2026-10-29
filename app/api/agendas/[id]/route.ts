import { NextResponse } from "next/server";
import { agendaStorage, jsonError, sessionClient } from "@/lib/agendas/server";
import { agendaSettings } from "@/lib/agendas/types";
import { serverError } from "@/lib/api";

export const runtime = "nodejs";

const number = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};
const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

// Modifie l'agenda : identité, format (mm), fond perdu, dates, réglages.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["name", "school", "year_label"] as const) {
    if (typeof body[key] === "string") update[key] = (body[key] as string).trim();
  }
  if (update.name === "") return jsonError("Le nom ne peut pas être vide.");
  const width = number(body.width_mm, 50, 600);
  const height = number(body.height_mm, 50, 600);
  const bleed = number(body.bleed_mm, 0, 20);
  if (width !== undefined) update.width_mm = width;
  if (height !== undefined) update.height_mm = height;
  if (bleed !== undefined) update.bleed_mm = bleed;
  const start = isoDate(body.start_date);
  const end = isoDate(body.end_date);
  if (start) update.start_date = start;
  if (end) update.end_date = end;
  if (start && end && end < start) return jsonError("La fin de l'année doit suivre son début.");
  if (body.settings !== undefined) update.settings = agendaSettings(body.settings);

  const { error } = await session.supabase.from("agendas").update(update).eq("id", params.id);
  if (error) return serverError(error, "Impossible d'enregistrer l'agenda.");
  return NextResponse.json({ ok: true });
}

// Supprime l'agenda, ses journées et ses pages (cascade), et tous ses fichiers.
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);

  const storage = agendaStorage();
  for (const folder of ["photos", "thumbs", "pdfs", ""]) {
    const prefix = folder ? `${params.id}/${folder}` : params.id;
    for (;;) {
      const { data } = await storage.list(prefix, { limit: 1000 });
      const files = (data ?? []).filter((f) => f.id).map((f) => `${prefix}/${f.name}`);
      if (files.length === 0) break;
      await storage.remove(files);
      if (files.length < 1000) break;
    }
  }

  const { error } = await session.supabase.from("agendas").delete().eq("id", params.id);
  if (error) return serverError(error, "Impossible de supprimer l'agenda.");
  return NextResponse.json({ ok: true });
}
