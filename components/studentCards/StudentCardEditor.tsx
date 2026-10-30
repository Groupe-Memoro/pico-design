"use client";

import VariableDataEditor from "@/components/variableData/VariableDataEditor";
import { STUDENT_VOCAB, type StudentCardTemplate } from "@/lib/studentCards/types";
import { formatSizeInMm } from "@/lib/pdf/units";

// Éditeur d'un modèle de carte étudiante : l'éditeur commun des documents à
// données variables, au format de la carte, avec l'école du modèle.
export default function StudentCardEditor({ template, schools }: { template: StudentCardTemplate; schools: string[] }) {
  const W = Number(template.width_mm);
  const H = Number(template.height_mm);
  return (
    <VariableDataEditor
      doc={template}
      pageWidth={W}
      pageHeight={H}
      apiBase="/api/student-cards"
      backHref="/cartes-etudiantes"
      subtitle={formatSizeInMm(W, H)}
      extraField={{ key: "school", label: "École", value: template.school, suggestions: schools }}
      rounded
      // Carte PVC : imprimée bord à bord, sans fond perdu ; textes à 3 mm du bord.
      guides={{ bleed: 0, safetyX: 3, safetyY: 3, folds: { front: { v: [], h: [] }, back: { v: [], h: [] } } }}
      vocab={STUDENT_VOCAB}
    />
  );
}
