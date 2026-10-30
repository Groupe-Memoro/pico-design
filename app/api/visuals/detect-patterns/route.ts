import { readJson, requireApiUser, serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { mapLimit } from "@/lib/concurrency";
import { selectAll } from "@/lib/supabase/selectAll";
import { detectPattern } from "@/lib/visualPattern";

export const runtime = "nodejs";
export const maxDuration = 300;

type Row = { id: string; file_path: string; mime_type: string };

// Passe des visuels existants à la détection des motifs répétables : ceux
// donnés (`ids`), sinon tous ceux qui ne sont pas déjà des motifs. Ne fait
// que marquer comme motif, jamais l'inverse : un choix manuel « motif » reste.
export async function POST(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const body = await readJson<{ ids?: unknown }>(request);
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : null;

  let rows: Row[];
  try {
    rows = await selectAll<Row>((from, to) => {
      const q = supabase.from("visuals").select("id, file_path, mime_type").eq("is_pattern", false);
      return (ids ? q.in("id", ids) : q).order("id").range(from, to);
    });
  } catch (err) {
    return serverError(err, "Impossible de charger les visuels.");
  }

  const found = (
    await mapLimit(rows, 4, async (v) => {
      const { data: blob } = await supabase.storage.from("visuals").download(v.file_path);
      if (!blob) return null;
      return (await detectPattern(Buffer.from(await blob.arrayBuffer()), v.mime_type)) ? v.id : null;
    })
  ).filter((id): id is string => id !== null);

  if (found.length > 0) {
    const { error } = await supabase.from("visuals").update({ is_pattern: true }).in("id", found);
    if (error) return serverError(error, "Impossible d'enregistrer les motifs détectés.");
  }
  return NextResponse.json({ checked: rows.length, marked: found.length });
}
