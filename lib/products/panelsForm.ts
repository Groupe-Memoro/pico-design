import type { SupabaseClient } from "@supabase/supabase-js";
import { mosaicFromForm } from "@/lib/design/renderPdf";
import { resolveProductImage } from "@/lib/pdf/productSource";
import { parseThemeSlotAdjustField } from "@/lib/pdf/theme";

/**
 * Produit plié composé PAR VOLET (ProductForm) : un fichier par volet, au
 * recto et au verso, envoyé comme une mosaïque (mosaicPanels/backMosaicPanels).
 * Assemble ici chaque côté aux plis réels du modèle (voir panelCells,
 * lib/folds.ts) et le remplace par une image recto/verso ordinaire : la suite
 * des routes Produits ne voit qu'une image par côté, comme d'habitude.
 */
export async function panelsToSideImages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  formData: FormData
): Promise<FormData> {
  const frontPanels = formData.get("mosaicPanels") === "1";
  const backPanels = formData.get("backMosaicPanels") === "1";
  if (!frontPanels && !backPanels) return formData;

  const templateId = String(formData.get("templateId") ?? "");
  const rotated = formData.get("rotated") === "true";
  const cols = parseInt(String(formData.get("mosaicCols") ?? formData.get("backMosaicCols") ?? ""), 10) || 1;
  const rows = parseInt(String(formData.get("mosaicRows") ?? formData.get("backMosaicRows") ?? ""), 10) || 1;

  async function side(which: "front" | "back"): Promise<File | null> {
    const files = mosaicFromForm(formData, which);
    if (!files) return null;
    const resolved = await resolveProductImage(supabase, {
      templateId,
      file: null,
      visualId: null,
      visualMode: null,
      tileSizeMm: null,
      rotated,
      mosaicFiles: files,
      mosaicCols: cols,
      mosaicRows: rows,
      mosaicCellAdjust: parseThemeSlotAdjustField(formData.get(which === "back" ? "backMosaicCellAdjust" : "mosaicCellAdjust")),
      mosaicPanelSide: which,
    });
    return new File([new Uint8Array(resolved.buffer)], `volets-${which === "front" ? "recto" : "verso"}.jpg`, { type: "image/jpeg" });
  }

  const front = frontPanels ? await side("front") : null;
  const back = backPanels ? await side("back") : null;

  // Le reste du formulaire, sans les champs de mosaïque ; l'image assemblée
  // couvre exactement la page : cadrage centré.
  const out = new FormData();
  for (const [key, value] of formData.entries()) {
    if (/^(back)?mosaic/i.test(key)) continue;
    if (front && ["image", "visualId", "visualMode", "tileSizeMm", "positionX", "positionY"].includes(key)) continue;
    if (back && ["backImage", "backVisualId", "backVisualMode", "backTileSizeMm", "backPositionX", "backPositionY"].includes(key)) continue;
    out.append(key, value);
  }
  if (front) {
    out.append("image", front);
    out.append("positionX", "0.5");
    out.append("positionY", "0.5");
  }
  if (back) {
    out.append("backImage", back);
    out.append("backPositionX", "0.5");
    out.append("backPositionY", "0.5");
  }
  return out;
}
