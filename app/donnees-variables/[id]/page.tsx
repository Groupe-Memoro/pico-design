import { notFound } from "next/navigation";
import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import VariableDataEditor, { type VariableDataDoc } from "@/components/variableData/VariableDataEditor";
import { templateLabel } from "@/lib/templateLabel";
import { formatIn } from "@/lib/pdf/units";
import { foldAxisLength, foldPanels, parseFold } from "@/lib/folds";
import type { Template } from "@/lib/types";

// Plis d'une face (mm depuis la coupe) : ceux du pliage du modèle, sinon ses
// marques de pli.
function foldLines(template: Template, side: "front" | "back") {
  const fold = parseFold(template.fold);
  if (!fold) return { v: template.fold_marks_vertical_mm ?? [], h: template.fold_marks_horizontal_mm ?? [] };
  const length = foldAxisLength(fold, Number(template.width_mm), Number(template.height_mm));
  const lines = foldPanels(fold, length, side).slice(1).map((p) => p.start);
  return fold.direction === "vertical" ? { v: lines, h: [] } : { v: [], h: lines };
}

// Un gabarit à données variables : la page du modèle (fond perdu compris),
// son fond, ses zones, et la production à partir d'un fichier.
export default async function DataTemplatePage({ params }: { params: { id: string } }) {
  await requireUser();
  const supabase = createServerSupabaseClient();
  const { data: doc } = await supabase
    .from("data_templates")
    .select("*")
    .eq("id", params.id)
    .maybeSingle<VariableDataDoc & { template_id: string }>();
  if (!doc) notFound();
  const { data: template } = await supabase.from("templates").select("*").eq("id", doc.template_id).maybeSingle<Template>();
  if (!template) notFound();

  const bleed = Number(template.bleed_mm) || 0;
  const width = Number(template.width_mm) + bleed * 2;
  const height = Number(template.height_mm) + bleed * 2;
  return (
    <VariableDataEditor
      doc={doc}
      pageWidth={width}
      pageHeight={height}
      apiBase="/api/data-templates"
      backHref="/donnees-variables"
      subtitle={`Modèle ${templateLabel(template.name, template.two_sided, {
        widthMm: Number(template.width_mm),
        heightMm: Number(template.height_mm),
      })}${bleed > 0 ? ` · fond perdu ${formatIn(bleed)}` : ""}`}
      guides={{
        bleed,
        safetyX: Number(template.safety_margin_x_mm) || 0,
        safetyY: Number(template.safety_margin_y_mm) || 0,
        folds: { front: foldLines(template, "front"), back: foldLines(template, "back") },
      }}
    />
  );
}
