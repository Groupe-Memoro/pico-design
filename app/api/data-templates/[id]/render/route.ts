import { renderVariableData } from "@/lib/variableData/handlers";
import { DATA_TEMPLATES } from "@/lib/variableData/configs";

export const runtime = "nodejs";
export const maxDuration = 120;

// Un lot de pages en PDF (voir renderVariableData).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return renderVariableData(request, params.id, DATA_TEMPLATES);
}
