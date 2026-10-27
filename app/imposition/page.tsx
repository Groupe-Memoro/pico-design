import Link from "next/link";
import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import ImpositionsTable, { type ImpositionRow } from "@/components/ImpositionsTable";

export default async function ImpositionsPage() {
  await requireUser();
  const supabase = createServerSupabaseClient();
  // Les plus récemment enregistrées en premier.
  const { data } = await supabase
    .from("impositions")
    .select("id, name, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);
  const rows = (data as ImpositionRow[]) ?? [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-page-title font-semibold text-text">Imposition</h1>
          <p className="text-sm text-neutral-500">
            {rows.length} imposition{rows.length > 1 ? "s" : ""} enregistrée{rows.length > 1 ? "s" : ""}.
          </p>
        </div>
        <Link
          href="/imposition/new"
          className="flex items-center gap-2 btn-primary"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
          </svg>
          Nouvelle imposition
        </Link>
      </div>

      <ImpositionsTable rows={rows} />
    </div>
  );
}
