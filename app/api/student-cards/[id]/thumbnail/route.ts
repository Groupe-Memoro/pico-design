import { thumbnailVariableData } from "@/lib/variableData/handlers";
import { STUDENT_CARDS } from "@/lib/variableData/configs";

export const runtime = "nodejs";
export const maxDuration = 30;

// Vignette du recto pour la liste des modèles, en PNG.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return thumbnailVariableData(params.id, STUDENT_CARDS);
}
