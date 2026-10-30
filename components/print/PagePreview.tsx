"use client";

import { fontOptionById, fontWeight } from "@/lib/design/fonts";
import { estimateFitSize, type LaidOutPage, type PrintGeometry } from "@/lib/print/elements";
import { ensureFontCss } from "@/lib/design/fontLoader";

const PT_TO_MM = 25.4 / 72;

/**
 * Aperçu d'une page (album, agenda) : les éléments de la mise en page (les mêmes que
 * le PDF), placés en pourcentage de la page. Le texte se mesure en unités du
 * conteneur (cqw) : il garde ses proportions à toute taille d'aperçu.
 * Les photos sont leurs vignettes (`thumbs`, chemin → adresse).
 */
export default function PagePreview({
  page,
  geometry,
  thumbs,
  showTrim = false,
}: {
  page: LaidOutPage;
  geometry: PrintGeometry;
  thumbs: Record<string, string>;
  // Trait du bord de coupe (le fond perdu reste visible autour).
  showTrim?: boolean;
}) {
  const W = geometry.widthMm + 2 * geometry.bleedMm;
  const H = geometry.heightMm + 2 * geometry.bleedMm;
  const box = (x: number, y: number, w: number, h: number): React.CSSProperties => ({
    position: "absolute",
    left: `${(x / W) * 100}%`,
    top: `${(y / H) * 100}%`,
    width: `${(w / W) * 100}%`,
    height: `${(h / H) * 100}%`,
  });
  // Une longueur en mm, en unités de la largeur de l'aperçu.
  const cqw = (mm: number) => `${(mm / W) * 100}cqw`;

  return (
    <div
      className="relative w-full overflow-hidden bg-white"
      style={{ aspectRatio: `${W} / ${H}`, containerType: "inline-size" }}
    >
      {page.elements.map((el, i) => {
        if (el.type === "rect") return <div key={i} style={{ ...box(el.x, el.y, el.w, el.h), background: el.color }} />;
        if (el.type === "line") {
          return (
            <div
              key={i}
              style={{ ...box(el.x1, el.y1, el.x2 - el.x1, 0), borderTop: `max(1px, ${cqw(el.widthPt * PT_TO_MM)}) solid ${el.color}` }}
            />
          );
        }
        if (el.type === "image") {
          const url = el.path ? thumbs[el.path] : undefined;
          return url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={url}
              alt=""
              draggable={false}
              style={{ ...box(el.x, el.y, el.w, el.h), objectFit: "cover", objectPosition: el.focus === "top" ? "center top" : "center" }}
            />
          ) : (
            <div key={i} style={box(el.x, el.y, el.w, el.h)} className="border border-dashed border-neutral-300 bg-neutral-100" />
          );
        }
        if (el.type === "pdf") {
          // Pas de rendu du PDF à l'écran : une case qui dit quelle page viendra là.
          return (
            <div
              key={i}
              style={{ ...box(el.x, el.y, el.w, el.h), fontSize: cqw(4) }}
              className="flex flex-col items-center justify-center gap-1 border border-dashed border-neutral-300 bg-neutral-50 text-neutral-500"
            >
              <span className="font-medium">PDF fourni</span>
              <span>page {el.pageIndex + 1}</span>
            </div>
          );
        }
        const font = fontOptionById(el.font);
        // Police Google : sa feuille de style (une seule fois).
        void ensureFontCss(el.font);
        const size = estimateFitSize(el.text, el.w, el.size, el.maxLines);
        return (
          <div
            key={i}
            style={{
              ...box(el.x, el.y, el.w, el.h),
              fontFamily: `"${font.family}"`,
              fontWeight: fontWeight(font, el),
              // Même dessin qu'à l'impression (pas de « taille optique » auto).
              fontOpticalSizing: "none",
              fontSize: cqw(size * PT_TO_MM),
              lineHeight: 1.25,
              color: el.color,
              textAlign: el.align,
              whiteSpace: "pre-line",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: el.maxLines,
              overflowWrap: "anywhere",
            }}
          >
            {el.text}
          </div>
        );
      })}
      {showTrim && (
        <div
          className="pointer-events-none absolute border border-dashed border-sky-400/70"
          style={box(geometry.bleedMm, geometry.bleedMm, geometry.widthMm, geometry.heightMm)}
        />
      )}
    </div>
  );
}
