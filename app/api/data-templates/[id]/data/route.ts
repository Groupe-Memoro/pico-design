import { getVariableDataFile } from "@/lib/variableData/handlers";
import { DATA_TEMPLATES } from "@/lib/variableData/configs";

export const runtime = "nodejs";

// Le fichier de données (Excel ou CSV) conservé avec le document.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return getVariableDataFile(params.id, DATA_TEMPLATES);
}
