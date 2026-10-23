import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import StudentCardsList from "@/components/studentCards/StudentCardsList";
import type { StudentCardTemplate } from "@/lib/studentCards/types";

// Module Cartes étudiantes : les modèles de cartes, par école (voir
// supabase/migrations/0079_student_cards.sql).
export default async function StudentCardsPage() {
  await requireUser();
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from("student_card_templates")
    .select("*")
    .order("school", { ascending: true })
    .order("name", { ascending: true });
  return <StudentCardsList templates={(data as StudentCardTemplate[]) ?? []} />;
}
