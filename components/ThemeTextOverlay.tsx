"use client";

import { useEffect, useState } from "react";
import { fontOptionById } from "@/lib/design/fonts";
import { THEME_TEXT_LINE_HEIGHT, fitThemeTextSize, themeZoneText } from "@/lib/themeText";
import type { ThemeTextZone } from "@/lib/types";

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
}: {
  zones: ThemeTextZone[];
  // Texte du client par zone ; absent = texte de départ de la zone.
  texts?: (string | null | undefined)[];
  pageWidthMm: number;
  boxWidth: number;
  boxHeight: number;
}) {
  // Les largeurs mesurées avant le chargement des polices seraient fausses :
  // on remesure une fois chacune chargée.
  const [fontsVersion, setFontsVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const specs = Array.from(new Set(zones.map((z) => fontSpec(z, 16))));
    Promise.all(specs.map((s) => document.fonts.load(s).catch(() => null))).then(() => {
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
