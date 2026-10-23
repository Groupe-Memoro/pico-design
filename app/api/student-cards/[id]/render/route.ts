import { renderVariableData } from "@/lib/variableData/handlers";
import { STUDENT_CARDS } from "@/lib/variableData/configs";

export const runtime = "nodejs";
export const maxDuration = 120;

// Un lot de cartes en PDF (voir renderVariableData).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return renderVariableData(request, params.id, STUDENT_CARDS);
}
