import { getVariableDataImage, uploadVariableDataImage } from "@/lib/variableData/handlers";
import { STUDENT_CARDS } from "@/lib/variableData/configs";

export const runtime = "nodejs";

// Image fixe d'une zone (logo, signature…) : aperçu (GET ?path=) et envoi (POST).
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return getVariableDataImage(request, params.id, STUDENT_CARDS);
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return uploadVariableDataImage(request, params.id, STUDENT_CARDS);
}
