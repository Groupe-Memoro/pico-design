import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import AgendasList, { type AgendaSummary } from "@/components/agendas/AgendasList";

// Module Agendas scolaires : la liste des agendas (voir
// supabase/migrations/0072_agendas.sql).
export default async function AgendasPage() {
  await requireUser();
  const { data } = await createServerSupabaseClient()
    .from("agendas")
    .select("id, name, school, year_label, start_date, end_date, updated_at, pdf_generated_at")
    .order("updated_at", { ascending: false });
  return <AgendasList agendas={(data as AgendaSummary[]) ?? []} />;
}
