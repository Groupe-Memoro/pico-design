"use client";

import { useEffect, useState } from "react";
import { fontOptionById } from "@/lib/design/fonts";
import { MAX_THEME_TEXT_LENGTH, THEME_TEXT_LINE_HEIGHT, fitThemeTextSize, themeZoneText } from "@/lib/themeText";
import type { ThemeTextZone } from "@/lib/types";
import { loadFont } from "@/lib/design/fontLoader";

/**
 * Aperçu des zones de texte d'un thème, par-dessus la page affichée
 * (`boxWidth`×`boxHeight` px pour `pageWidthMm` mm de large, fond perdu
 * compris) : même police, même réduction pour tenir dans la zone et même
 * alignement que le rendu serveur (themeTextToSvgGroup, lib/pdf/textLayer.ts).
 * Purement visuel : ne capte aucun clic.
 */
export default function ThemeTextOverlay({
  zones,
  texts,
  pageWidthMm,
  boxWidth,
  boxHeight,
  hiddenIndex = null,
  edit,
}: {
  zones: ThemeTextZone[];
  // Texte du client par zone ; absent = texte de départ de la zone.
  texts?: (string | null | undefined)[];
  pageWidthMm: number;
  boxWidth: number;
  boxHeight: number;
  // Zone en cours de modification : son texte est affiché par le champ
  // (couche `edit`), pas ici.
  hiddenIndex?: number | null;
  // Couche cliquable (outil Shopify) : un clic sur une zone ouvre, à sa place,
  // un champ dans la même police pour modifier le texte.
  edit?: {
    editingIndex: number | null;
    onStart: (index: number) => void;
    onChange: (index: number, text: string) => void;
    onEnd: () => void;
  };
}) {
  // Les largeurs mesurées avant le chargement des polices seraient fausses :
  // on remesure une fois chacune chargée.
  const [fontsVersion, setFontsVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const specs = Array.from(new Map(zones.map((z) => [fontSpec(z, 16), z.fontId])));
    Promise.all(specs.map(([spec, fontId]) => loadFont(fontId, spec))).then(() => {
      if (!cancelled) setFontsVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [zones]);

  if (boxWidth <= 0 || zones.length === 0) return null;
  const pxPerMm = boxWidth / Math.max(1, pageWidthMm);
  return (
    <>
      {zones.map((zone, i) => {
        if (edit) return <EditableZone key={zone.id} zone={zone} index={i} raw={texts?.[i] ?? zone.defaultText} pxPerMm={pxPerMm} boxWidth={boxWidth} boxHeight={boxHeight} fontsVersion={fontsVersion} edit={edit} />;
        if (i === hiddenIndex) return null;
        const text = themeZoneText(zone, texts?.[i]);
        if (!text.trim()) return null;
        const boxW = zone.widthRatio * boxWidth;
        const boxH = zone.heightRatio * boxHeight;
        const baseSize = zone.fontSizeMm * pxPerMm;
        const lines = text.split("\n");
        const size = fitThemeTextSize(baseSize, measureLines(zone, lines, baseSize, fontsVersion), boxW, boxH);
        const font = fontOptionById(zone.fontId);
        return (
          <div
            key={zone.id}
            className="pointer-events-none absolute flex flex-col justify-center"
            style={{
              left: (zone.positionX - zone.widthRatio / 2) * boxWidth,
              top: (zone.positionY - zone.heightRatio / 2) * boxHeight,
              width: boxW,
              height: boxH,
              transform: zone.rotationDeg ? `rotate(${zone.rotationDeg}deg)` : undefined,
              textAlign: zone.align,
              color: zone.color,
              fontFamily: `"${font.family}"`,
              fontWeight: zone.bold ? font.weightBold : font.weightRegular,
              fontStyle: zone.italic ? "italic" : "normal",
              fontSize: size,
              lineHeight: THEME_TEXT_LINE_HEIGHT,
              whiteSpace: "pre",
            }}
          >
            {lines.map((line, li) => (
              <div key={li}>{line || " "}</div>
            ))}
          </div>
        );
      })}
    </>
  );
}

// Une zone cliquable de l'outil : cadre pointillé au survol, et au clic un
// champ posé exactement sur la zone, dans la police, la taille ajustée, la
// couleur et l'alignement du rendu — on écrit « dans » le produit.
function EditableZone({
  zone,
  index,
  raw,
  pxPerMm,
  boxWidth,
  boxHeight,
  fontsVersion,
  edit,
}: {
  zone: ThemeTextZone;
  index: number;
  raw: string;
  pxPerMm: number;
  boxWidth: number;
  boxHeight: number;
  fontsVersion: number;
  edit: NonNullable<Parameters<typeof ThemeTextOverlay>[0]["edit"]>;
}) {
  const editing = edit.editingIndex === index;
  const boxW = zone.widthRatio * boxWidth;
  const boxH = zone.heightRatio * boxHeight;
  const shown = themeZoneText(zone, raw);
  const lines = (shown || " ").split("\n");
  const size = fitThemeTextSize(zone.fontSizeMm * pxPerMm, measureLines(zone, lines, zone.fontSizeMm * pxPerMm, fontsVersion), boxW, boxH);
  const font = fontOptionById(zone.fontId);
  const textStyle: React.CSSProperties = {
    fontFamily: `"${font.family}"`,
    fontWeight: zone.bold ? font.weightBold : font.weightRegular,
    fontStyle: zone.italic ? "italic" : "normal",
    fontSize: size,
    lineHeight: THEME_TEXT_LINE_HEIGHT,
    color: zone.color,
    textAlign: zone.align,
    textTransform: zone.uppercase ? "uppercase" : "none",
    caretColor: zone.color,
  };
  const max = zone.maxChars > 0 ? zone.maxChars : MAX_THEME_TEXT_LENGTH;
  return (
    <div
      className={`absolute ${editing ? "outline-dashed outline-2 outline-[var(--accent,#631028)]" : "cursor-text hover:outline-dashed hover:outline-1 hover:outline-[var(--accent,#631028)]"}`}
      style={{
        left: (zone.positionX - zone.widthRatio / 2) * boxWidth,
        top: (zone.positionY - zone.heightRatio / 2) * boxHeight,
        width: boxW,
        height: boxH,
        transform: zone.rotationDeg ? `rotate(${zone.rotationDeg}deg)` : undefined,
      }}
      // Le glisser du fond (ou d'un calque) ne doit pas partir d'ici.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => !editing && edit.onStart(index)}
      title={editing ? undefined : `${zone.label} — cliquer pour modifier`}
    >
      {editing &&
        (zone.multiline ? (
          <textarea
            autoFocus
            value={raw}
            maxLength={max}
            onChange={(e) => edit.onChange(index, e.target.value)}
            onBlur={edit.onEnd}
            onKeyDown={(e) => e.key === "Escape" && (e.currentTarget as HTMLTextAreaElement).blur()}
            className="absolute inset-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
            style={{
              ...textStyle,
              // Bloc centré verticalement, comme le rendu.
              paddingTop: Math.max(0, (boxH - lines.length * size * THEME_TEXT_LINE_HEIGHT) / 2),
              whiteSpace: "pre",
            }}
          />
        ) : (
          <input
            autoFocus
            value={raw}
            maxLength={max}
            onChange={(e) => edit.onChange(index, e.target.value)}
            onBlur={edit.onEnd}
            onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
            className="absolute inset-0 h-full w-full border-0 bg-transparent p-0 outline-none"
            style={textStyle}
          />
        ))}
    </div>
  );
}

function fontSpec(zone: ThemeTextZone, sizePx: number): string {
  const font = fontOptionById(zone.fontId);
  return `${zone.italic ? "italic " : ""}${zone.bold ? font.weightBold : font.weightRegular} ${sizePx}px "${font.family}"`;
}

let measureCanvas: HTMLCanvasElement | null = null;
// Largeur de chaque ligne à `sizePx`, mesurée avec la police de la zone.
// `_version` : force une nouvelle mesure une fois les polices chargées.
function measureLines(zone: ThemeTextZone, lines: string[], sizePx: number, _version: number): number[] {
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return lines.map(() => 0);
  ctx.font = fontSpec(zone, sizePx);
  return lines.map((line) => ctx.measureText(line).width);
}
