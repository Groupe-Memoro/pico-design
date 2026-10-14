import { NextResponse } from "next/server";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { AGENDAS_BUCKET, agendaPageContent, agendaSettings, type Agenda, type AgendaDay, type AgendaPage } from "./types";

// Outils serveur du module Agendas, partagés par ses routes et sa page.

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function sessionClient() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}

export function agendaStorage() {
  return createAdminSupabaseClient().storage.from(AGENDAS_BUCKET);
}

// Les fichiers d'un agenda vivent sous <agendaId>/ : un chemin reçu du
// navigateur doit y être, sans quoi il pointerait vers un autre agenda.
export function isAgendaPath(agendaId: string, path: unknown): path is string {
  return typeof path === "string" && path.startsWith(`${agendaId}/`) && !path.includes("..");
}

// Vignette (écran) d'une photo d'impression : même nom, autre dossier.
export function thumbPathOf(photoPath: string): string {
  return photoPath.replace("/photos/", "/thumbs/");
}

type Supabase = ReturnType<typeof createServerSupabaseClient>;

export async function loadAgenda(supabase: Supabase, id: string) {
  const [{ data: agenda }, { data: days }, { data: pages }] = await Promise.all([
    supabase.from("agendas").select("*").eq("id", id).maybeSingle(),
    supabase.from("agenda_days").select("day, kind, label").eq("agenda_id", id).order("day"),
    supabase.from("agenda_pages").select("*").eq("agenda_id", id).order("position", { ascending: true }),
  ]);
  if (!agenda) return null;
  return {
    agenda: { ...(agenda as Agenda), settings: agendaSettings((agenda as Agenda).settings) } as Agenda,
    days: (days as AgendaDay[]) ?? [],
    pages: ((pages as AgendaPage[]) ?? []).map((p) => ({ ...p, content: agendaPageContent(p.kind, p.content) })),
  };
}

export function geometryOf(agenda: Pick<Agenda, "width_mm" | "height_mm" | "bleed_mm">) {
  return { widthMm: Number(agenda.width_mm), heightMm: Number(agenda.height_mm), bleedMm: Number(agenda.bleed_mm) };
}

// L'agenda a changé : sa date sert à signaler un PDF devenu ancien.
export async function touchAgenda(supabase: Supabase, id: string) {
  await supabase.from("agendas").update({ updated_at: new Date().toISOString() }).eq("id", id);
}

// Supprime des fichiers de l'agenda (une photo emporte sa vignette), sans
// faire échouer l'appelant : un fichier orphelin ne gêne personne.
export async function removeAgendaFiles(paths: (string | null | undefined)[]) {
  const all = paths.filter((p): p is string => Boolean(p)).flatMap((p) => (p.includes("/photos/") ? [p, thumbPathOf(p)] : [p]));
  if (all.length > 0) await agendaStorage().remove(all).catch(() => undefined);
}
