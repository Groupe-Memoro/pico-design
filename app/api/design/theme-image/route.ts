import sharp from "sharp";
import { NextResponse } from "next/server";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { grantAllows } from "@/lib/publicDesign";
import { hydrateStagedFiles } from "@/lib/design/stagedFiles";
import { publicUploadError } from "@/lib/uploadLimits";
import { panelThemePlacement, parsePanelKey } from "@/lib/folds";
import { applyOrientation } from "@/lib/pdf/orientation";
import { mmToPx } from "@/lib/pdf/units";
import { renderTheme } from "@/lib/pdf/productSource";
import { parseThemeSlotAdjustField, themeSlotFilesFromForm } from "@/lib/pdf/theme";
import { parseThemeTextsField } from "@/lib/themeText";
import type { Template } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Rend une partie d'un thème remplie par le client (voir lib/themeParts.ts) —
 * graphisme, ses photos et ses textes — à la résolution du modèle, en image
 * prête à devenir un fichier de l'outil :
 *  - face entière (`part` = front/back) : la page, fond perdu compris ;
 *  - volet (`part` = « front:1 ») : le volet, fond perdu du thème retiré du
 *    côté du pli (seuls les bords de la feuille le gardent), exactement sa
 *    case dans la feuille (voir panelCells).
 * Aperçu, PDF et commande traitent ensuite l'image comme un fichier ordinaire.
 *
 * Champs : templateId, themeId, part, rotated, themeSlot0…, themeSlotAdjust,
 * themeTexts. Même garde que les routes de rendu : une session, ou un
 * laissez-passer valable pour ce modèle.
 */
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let formData: FormData;
  try {
    formData = await hydrateStagedFiles(await request.formData());
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Fichier introuvable.");
  }
  const templateId = formData.get("templateId");
  const themeId = formData.get("themeId");
  const part = String(formData.get("part") ?? "front");
  if (typeof templateId !== "string" || typeof themeId !== "string") {
    return errorResponse("Paramètres manquants (templateId, themeId).");
  }
  if (!user) {
    if (!grantAllows(formData.get("grant"), templateId)) return errorResponse("Non authentifié.", 401);
    const limit = await checkRateLimit("preview", request);
    if (!limit.allowed) return tooManyRequests("preview");
    const tooBig = publicUploadError(formData);
    if (tooBig) return errorResponse(tooBig, 413);
  }
  const db = user ? supabase : createAdminSupabaseClient();

  const { data: rawTemplate } = await db.from("templates").select("*").eq("id", templateId).single<Template>();
  if (!rawTemplate) return errorResponse("Modèle introuvable.", 404);
  // Le thème doit être un thème de CE modèle (le client public lit les thèmes
  // avec la clé admin : rien d'autre ne doit sortir).
  const { data: themeRow } = await db.from("themes").select("template_id").eq("id", themeId).single<{ template_id: string }>();
  if (!themeRow || themeRow.template_id !== templateId) return errorResponse("Thème introuvable pour ce modèle.", 404);

  const template = applyOrientation(rawTemplate, formData.get("rotated") === "true");
  const b = template.bleed_mm;
  const dpi = template.dpi;
  const panel = parsePanelKey(part);
  const placement = panel ? panelThemePlacement(template, panel.side, panel.index) : null;
  if (panel && !placement) return errorResponse("Volet introuvable.");
  if (!panel && part !== "front" && part !== "back") return errorResponse("Partie du thème invalide.");

  const widthPx = mmToPx((placement ? placement.trimWidthMm : template.width_mm) + 2 * b, dpi);
  const heightPx = mmToPx((placement ? placement.trimHeightMm : template.height_mm) + 2 * b, dpi);
  try {
    const { buffer } = await renderTheme(db, themeId, {
      widthPx,
      heightPx,
      dpi,
      slotFiles: themeSlotFilesFromForm(formData),
      slotAdjust: parseThemeSlotAdjustField(formData.get("themeSlotAdjust")),
      texts: parseThemeTextsField(formData.get("themeTexts")),
      partKey: part,
    });
    let jpeg = buffer;
    if (placement) {
      // Fond perdu retiré côté pli : le volet garde le sien seulement au bord
      // de la feuille.
      const cut = mmToPx(b, dpi);
      const vertical = placement.direction === "vertical";
      const left = vertical && placement.cutStart ? cut : 0;
      const right = vertical && placement.cutEnd ? cut : 0;
      const top = !vertical && placement.cutStart ? cut : 0;
      const bottom = !vertical && placement.cutEnd ? cut : 0;
      jpeg = await sharp(buffer)
        .extract({ left, top, width: widthPx - left - right, height: heightPx - top - bottom })
        .jpeg({ quality: 90 })
        .toBuffer();
    }
    return new NextResponse(new Uint8Array(jpeg), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Rendu du thème impossible.");
  }
}
