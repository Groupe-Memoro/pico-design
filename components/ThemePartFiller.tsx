"use client";

import { useEffect, useRef, useState } from "react";
import { MosaicCellDropZone } from "@/components/ImageSourcePicker";
import { SpinnerIcon } from "@/components/icons";
import { stageLargeFiles } from "@/lib/design/stageUpload";
import type { ThemePart } from "@/lib/types";

/**
 * Ce que le client met dans une partie d'un thème (voir lib/themeParts.ts) :
 * une photo par emplacement, un texte par zone. `renderedFile` : l'image rendue
 * par le serveur pour ces réglages-là (absent = à rendre).
 */
export interface ThemePartFill {
  slotFiles: (File | null)[];
  texts: (string | null)[];
  renderedFile?: File;
}

// Rend une partie remplie (voir app/api/design/theme-image) : face entière ou
// volet, fond perdu retiré côté pli. L'image devient le fichier de la face ou
// du volet ; aperçu, PDF et commande la traitent comme un fichier ordinaire.
export async function renderThemePart(args: {
  templateId: string;
  grant?: string;
  rotated: boolean;
  themeId: string;
  partKey: string;
  fill: ThemePartFill;
}): Promise<File> {
  let formData = new FormData();
  formData.append("templateId", args.templateId);
  if (args.grant) formData.append("grant", args.grant);
  formData.append("rotated", String(args.rotated));
  formData.append("themeId", args.themeId);
  formData.append("part", args.partKey);
  args.fill.slotFiles.forEach((f, j) => f && formData.append(`themeSlot${j}`, f));
  formData.append("themeTexts", JSON.stringify(args.fill.texts));
  formData = await stageLargeFiles(formData);
  const res = await fetch("/api/design/theme-image", { method: "POST", body: formData });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Rendu du thème impossible.");
  return new File([await res.blob()], `theme-${args.partKey.replace(":", "-")}.jpg`, { type: "image/jpeg" });
}

/**
 * Une partie du thème choisi, à remplir par le client : ses photos et ses
 * textes. Chaque changement relance le rendu (après une courte pause, pour ne
 * pas rendre à chaque lettre tapée), puis `onRendered` pose l'image à sa place.
 */
export default function ThemePartFiller({
  label,
  part,
  fill,
  needsRender,
  onFillChange,
  render,
  onRendered,
}: {
  label: string;
  part: ThemePart;
  fill: ThemePartFill;
  // Vrai tant que l'image de ces réglages n'est pas à sa place.
  needsRender: boolean;
  onFillChange: (fill: ThemePartFill) => void;
  render: (fill: ThemePartFill) => Promise<File>;
  onRendered: (fill: ThemePartFill, file: File) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callbacks = useRef({ render, onRendered });
  callbacks.current = { render, onRendered };

  useEffect(() => {
    if (!needsRender) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const file = await callbacks.current.render(fill);
        if (!cancelled) callbacks.current.onRendered(fill, file);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Rendu du thème impossible.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fill, needsRender]);

  const zones = part.text_zones ?? [];
  const update = (patch: Partial<ThemePartFill>) => onFillChange({ ...fill, ...patch, renderedFile: undefined });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text">{label}</span>
        {busy && <SpinnerIcon className="h-4 w-4 shrink-0 text-text-subtle" />}
      </div>
      {part.slots.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {part.slots.map((_, j) => (
            <MosaicCellDropZone
              key={j}
              label={`Photo ${j + 1}`}
              file={fill.slotFiles[j] ?? null}
              onFileChange={(f) => {
                const slotFiles = part.slots.map((__, k) => fill.slotFiles[k] ?? null);
                slotFiles[j] = f;
                update({ slotFiles });
              }}
            />
          ))}
        </div>
      )}
      {zones.map((zone, j) => (
        <label key={zone.id} className="block text-xs">
          <span className="text-text-muted">{zone.label || `Texte ${j + 1}`}</span>
          {zone.multiline ? (
            <textarea
              value={fill.texts[j] ?? zone.defaultText}
              rows={2}
              maxLength={zone.maxChars > 0 ? zone.maxChars : undefined}
              onChange={(e) => {
                const texts = zones.map((__, k) => fill.texts[k] ?? null);
                texts[j] = e.target.value;
                update({ texts });
              }}
              className="mt-0.5 w-full resize-none rounded-lg border border-border bg-surface px-2 py-1"
            />
          ) : (
            <input
              value={fill.texts[j] ?? zone.defaultText}
              maxLength={zone.maxChars > 0 ? zone.maxChars : undefined}
              onChange={(e) => {
                const texts = zones.map((__, k) => fill.texts[k] ?? null);
                texts[j] = e.target.value;
                update({ texts });
              }}
              className="mt-0.5 w-full rounded-lg border border-border bg-surface px-2 py-1"
            />
          )}
        </label>
      ))}
      {part.slots.length === 0 && zones.length === 0 && (
        <p className="text-xs text-text-muted">Rien à remplir : le graphisme est posé tel quel.</p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

// Thème « en parties » choisi par le client (cartes pliées, ou thème avec un
// verso) et ce qu'il a mis dans chaque partie, par clé de partie.
export interface CardTheme {
  theme: import("@/components/ThemesTable").ThemeWithOverlayUrl;
  fills: Record<string, ThemePartFill>;
}

export const emptyFill = (part: ThemePart): ThemePartFill => ({
  slotFiles: part.slots.map(() => null),
  texts: (part.text_zones ?? []).map(() => null),
});
