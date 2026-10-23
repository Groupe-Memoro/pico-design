import { notFound } from "next/navigation";
import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import StudentCardEditor from "@/components/studentCards/StudentCardEditor";
import type { StudentCardTemplate } from "@/lib/studentCards/types";

// Un modèle de carte étudiante : fonds, zones, et production des cartes à
// partir d'un CSV et des photos.
export default async function StudentCardTemplatePage({ params }: { params: { id: string } }) {
  await requireUser();
  const supabase = createServerSupabaseClient();
  const [{ data }, { data: schools }] = await Promise.all([
    supabase.from("student_card_templates").select("*").eq("id", params.id).maybeSingle<StudentCardTemplate>(),
    // Écoles déjà saisies : proposées dans le champ École.
    supabase.from("student_card_templates").select("school"),
  ]);
  if (!data) notFound();
  const schoolNames = Array.from(new Set(((schools as { school: string }[]) ?? []).map((s) => s.school).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b, "fr")
  );
  return <StudentCardEditor template={data} schools={schoolNames} />;
}
