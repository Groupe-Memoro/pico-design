import type { SupabaseClient } from "@supabase/supabase-js";
import type { ThemePart, ThemeScope } from "@/lib/types";
import { parseThemeSlotsField } from "@/lib/pdf/theme";
import { parseTextZonesField } from "@/lib/themeText";
import { parseThemeGuidesField } from "@/lib/variableData/snap";
import { storageFileName } from "@/lib/storageName";
import { isPartKey } from "@/lib/themeParts";

/**
 * Parties d'un thème envoyées par ThemeForm (voir lib/themeParts.ts) :
 *  - `parts` : JSON [{ key, slots, textZones, guides, fixFit, removeBackground }]
 *    dans l'ordre des onglets ;
 *  - `overlay@<key>` / `background@<key>` : les nouveaux fichiers de la partie.
 * Une partie sans nouveau graphisme garde celui qu'elle avait (`existing`).
 * Renvoie les parties prêtes à enregistrer, ou un message d'erreur.
 */
export async function themePartsFromForm(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  themeId: string,
  formData: FormData,
  scope: ThemeScope,
  existing: ThemePart[]
): Promise<ThemePart[] | string> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("parts") ?? ""));
  } catch {
    return "Parties du thème illisibles.";
  }
  if (!Array.isArray(raw) || raw.length === 0) return "Le thème doit avoir au moins un graphisme.";

  const parts: ThemePart[] = [];
  const seen = new Set<string>();
  for (const item of raw as Record<string, unknown>[]) {
    const key = String(item?.key ?? "");
    if (!isPartKey(key, scope) || seen.has(key)) return "Partie du thème invalide.";
    seen.add(key);
    const before = existing.find((p) => p.key === key);
    const name = partName(key);

    // Une partie peut n'avoir que du texte (l'intérieur d'une carte) : aucun
    // emplacement photo est permis ici, contrairement aux thèmes d'avant.
    const slotsRaw = Array.isArray(item.slots) ? item.slots : [];
    const slots = slotsRaw.length === 0 ? [] : parseThemeSlotsField(JSON.stringify(slotsRaw));
    if (!slots) return `Emplacements invalides (${name}).`;
    const textZones = parseTextZonesField(JSON.stringify(Array.isArray(item.textZones) ? item.textZones : []));
    if (!textZones) return `Zones de texte invalides (${name}).`;
    const guides = parseThemeGuidesField(JSON.stringify(Array.isArray(item.guides) ? item.guides : [])) ?? [];

    // Fichiers : un par partie, rangés sous le thème avec le nom de la partie.
    const folder = `themes/${themeId}/${key.replace(":", "-")}`;
    const upload = async (file: File, kind: "overlay" | "background") => {
      const path = `${folder}-${kind}-${storageFileName(file.name)}`;
      const { error } = await supabase.storage
        .from("overlays")
        .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "image/png", upsert: true });
      if (error) throw new Error(`Impossible d'enregistrer l'image du thème (${name}).`);
      return path;
    };

    const overlayFile = formData.get(`overlay@${key}`);
    let overlayPath = before?.overlay_path ?? null;
    // Nouveau graphisme : recadré sans déformation (voir 0085_theme_fit.sql).
    let fit = before?.overlay_fit ?? "fill";
    if (overlayFile instanceof File && overlayFile.size > 0) {
      overlayPath = await upload(overlayFile, "overlay");
      fit = "cover";
    } else if (item.fixFit === true) {
      fit = "cover";
    }
    if (!overlayPath) return `Graphisme manquant (${name}).`;

    const backgroundFile = formData.get(`background@${key}`);
    let backgroundPath = before?.background_path ?? null;
    if (backgroundFile instanceof File && backgroundFile.size > 0) backgroundPath = await upload(backgroundFile, "background");
    else if (item.removeBackground === true) backgroundPath = null;

    parts.push({
      key,
      overlay_path: overlayPath,
      background_path: backgroundPath,
      overlay_fit: fit,
      slots,
      text_zones: textZones,
      guides,
    });
  }
  return parts;
}

// Colonnes d'un thème : ses parties, et la première recopiée dans les
// colonnes d'avant (vignette de la liste, thèmes d'une seule partie).
export function themePartsColumns(parts: ThemePart[], scope: ThemeScope) {
  const first = parts[0];
  return {
    scope,
    parts,
    overlay_path: first.overlay_path,
    background_path: first.background_path ?? null,
    overlay_fit: first.overlay_fit ?? "cover",
    slots: first.slots,
    text_zones: first.text_zones ?? [],
    guides: first.guides ?? [],
  };
}

function partName(key: string): string {
  if (key === "front") return "recto";
  if (key === "back") return "verso";
  const [side, index] = key.split(":");
  return `volet ${Number(index) + 1} du ${side === "back" ? "verso" : "recto"}`;
}
