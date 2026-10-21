// Profils d'imposition (voir supabase/migrations/0078_imposition_profiles.sql) :
// validation des données reçues par les routes, partagée.

const UUID = /^[0-9a-f-]{36}$/i;
const optionalId = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);

export function parseProfileBody(body: unknown):
  | { error: string }
  | {
      row: {
        name: string;
        sheet_id: string;
        machine: "duplo" | "graphtec";
        duplo_job_id: string | null;
        duplo_job2_id: string | null;
        duplo_job2_turn: "cw" | "ccw";
        cutter_id: string | null;
        orientation: "auto" | "normal" | "rotated";
        flip: "long" | "short";
      };
    } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").trim().slice(0, 120);
  if (!name) return { error: "Donnez un nom au profil." };
  const sheetId = optionalId(b.sheet_id);
  if (!sheetId) return { error: "Choisissez une feuille." };
  const machine = b.machine === "graphtec" ? "graphtec" : b.machine === "duplo" ? "duplo" : null;
  if (!machine) return { error: "Machine inconnue." };
  const duploJob = optionalId(b.duplo_job_id);
  const cutter = optionalId(b.cutter_id);
  if (machine === "duplo" && !duploJob) return { error: "Choisissez un job Duplo." };
  if (machine === "graphtec" && !cutter) return { error: "Choisissez un profil de découpe Graphtec." };
  return {
    row: {
      name,
      sheet_id: sheetId,
      machine,
      duplo_job_id: machine === "duplo" ? duploJob : null,
      duplo_job2_id: machine === "duplo" ? optionalId(b.duplo_job2_id) : null,
      duplo_job2_turn: b.duplo_job2_turn === "ccw" ? "ccw" : "cw",
      cutter_id: machine === "graphtec" ? cutter : null,
      orientation: b.orientation === "normal" || b.orientation === "rotated" ? b.orientation : "auto",
      flip: b.flip === "short" ? "short" : "long",
    },
  };
}
