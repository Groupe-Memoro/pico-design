import { deleteVariableData, patchVariableData } from "@/lib/variableData/handlers";
import { STUDENT_CARDS } from "@/lib/variableData/configs";

export const runtime = "nodejs";

// Enregistre un modèle de carte : nom, école, zones, aperçu, fonds.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return patchVariableData(request, params.id, STUDENT_CARDS);
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  return deleteVariableData(params.id, STUDENT_CARDS);
}
