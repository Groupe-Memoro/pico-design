import { getVariableDataBackground } from "@/lib/variableData/handlers";
import { STUDENT_CARDS } from "@/lib/variableData/configs";

export const runtime = "nodejs";
export const maxDuration = 30;

// Le fond d'une face, en PNG pour l'éditeur.
export async function GET(_request: Request, { params }: { params: { id: string; side: string } }) {
  return getVariableDataBackground(params.id, params.side, STUDENT_CARDS);
}
