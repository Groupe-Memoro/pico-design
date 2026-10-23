import { getVariableDataImage, uploadVariableDataImage } from "@/lib/variableData/handlers";
import { DATA_TEMPLATES } from "@/lib/variableData/configs";

export const runtime = "nodejs";

// Image fixe d'une zone (logo, signature…) : aperçu (GET ?path=) et envoi (POST).
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return getVariableDataImage(request, params.id, DATA_TEMPLATES);
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return uploadVariableDataImage(request, params.id, DATA_TEMPLATES);
}
