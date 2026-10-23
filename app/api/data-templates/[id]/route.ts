import { deleteVariableData, patchVariableData } from "@/lib/variableData/handlers";
import { DATA_TEMPLATES } from "@/lib/variableData/configs";

export const runtime = "nodejs";

// Enregistre un gabarit : nom, recto-verso, zones, aperçu, fonds.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return patchVariableData(request, params.id, DATA_TEMPLATES);
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  return deleteVariableData(params.id, DATA_TEMPLATES);
}
