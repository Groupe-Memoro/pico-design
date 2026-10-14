import { NextResponse } from "next/server";
import { jsonError, sessionClient } from "@/lib/agendas/server";
import { quebecHolidays } from "@/lib/agendas/calendar";
import { AGENDA_FORMATS, DEFAULT_AGENDA_SETTINGS, defaultAgendaContent } from "@/lib/agendas/types";

export const runtime = "nodejs";

const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * Crée un agenda pour une année scolaire, avec ses blocs de départ
 * (couverture, semaines sur 2 pages, notes) et les fériés du Québec déjà
 * marqués : l'équipe n'a plus qu'à ajouter les congés et journées
 * pédagogiques de l'école.
 */
export async function POST(request: Request) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);
  const { supabase, user } = session;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("Nom de l'agenda manquant.");
  const start = isoDate(body.start_date);
  const end = isoDate(body.end_date);
  if (!start || !end || end < start) return jsonError("Dates de l'année scolaire invalides.");
  const format = AGENDA_FORMATS.find((f) => f.id === body.formatId) ?? AGENDA_FORMATS[0];
  const school = typeof body.school === "string" ? body.school.trim() : "";
  const yearLabel = typeof body.year_label === "string" ? body.year_label.trim() : "";

  const { data: agenda, error } = await supabase
    .from("agendas")
    .insert({
      name,
      school,
      year_label: yearLabel,
      width_mm: format.widthMm,
      height_mm: format.heightMm,
      start_date: start,
      end_date: end,
      settings: DEFAULT_AGENDA_SETTINGS,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !agenda) return jsonError(error?.message ?? "Création impossible.", 500);

  const cover = { ...defaultAgendaContent("cover"), title: yearLabel ? `Agenda ${yearLabel}` : "Agenda", subtitle: school };
  await supabase.from("agenda_pages").insert([
    { agenda_id: agenda.id, position: 0, kind: "cover", content: cover },
    { agenda_id: agenda.id, position: 1, kind: "calendar", content: defaultAgendaContent("calendar") },
    { agenda_id: agenda.id, position: 2, kind: "notes", content: defaultAgendaContent("notes") },
  ]);
  const holidays = quebecHolidays(start, end);
  if (holidays.length > 0) {
    await supabase.from("agenda_days").insert(holidays.map((h) => ({ agenda_id: agenda.id, day: h.day, kind: "ferie", label: h.label })));
  }

  return NextResponse.json({ id: agenda.id });
}
