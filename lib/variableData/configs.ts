// Configuration des deux sortes de documents à données variables (voir handlers.ts).

import type { VariableDataConfig } from "./handlers";

// Cartes étudiantes : le format est celui de la carte, sans fond perdu
// (l'imprimante à cartes imprime bord à bord).
export const STUDENT_CARDS: VariableDataConfig = {
  table: "student_card_templates",
  bucket: "student-cards",
  textFields: ["school"],
  pageSize: async (row) => ({ width: Number(row.width_mm), height: Number(row.height_mm) }),
};

// Gabarits à données variables : la page est celle du modèle, à plat, fond
// perdu compris — prête à imposer comme le PDF d'un produit.
export const DATA_TEMPLATES: VariableDataConfig = {
  table: "data_templates",
  bucket: "data-templates",
  pageSize: async (row, supabase) => {
    if (typeof row.template_id !== "string") return null;
    const { data } = await supabase
      .from("templates")
      .select("width_mm, height_mm, bleed_mm")
      .eq("id", row.template_id)
      .single<{ width_mm: number; height_mm: number; bleed_mm: number }>();
    if (!data) return null;
    const bleed = Number(data.bleed_mm) || 0;
    return { width: Number(data.width_mm) + bleed * 2, height: Number(data.height_mm) + bleed * 2 };
  },
};
