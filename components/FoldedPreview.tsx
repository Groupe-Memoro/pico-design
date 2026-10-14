"use client";

import { useState } from "react";
import { foldAxisLength, foldPanels, type FoldConfig } from "@/lib/folds";

/**
 * Aperçu d'un produit plié (dépliant, carte), en 3D CSS : les volets forment
 * une chaîne articulée aux plis, chacun avec son morceau du recto d'un côté et
 * du verso de l'autre (images à plat, format fini — voir /api/design/mockup,
 * `flat`). Deux vues, entrouvertes : l'extérieur et l'intérieur.
 *
 * Correspondance recto/verso : la feuille se retourne autour d'un axe
 * vertical, le point (x, y) du recto est donc derrière (largeur − x, y) au
 * verso — d'où le découpage du verso en miroir de celui du recto.
 */

type View = "outside" | "inside";

// Angle de chaque pli (degrés), selon le type et la vue : assez ouvert pour
// tout voir, assez plié pour sentir le produit.
// Les angles s'additionnent d'un volet à l'autre : un pli roulé reste donc
// plus ouvert, sans quoi sa couverture se verrait de profil.
function hingeAngles(fold: FoldConfig, view: View): number[] {
  const n = fold.panels - 1;
  if (fold.type === "accordion") {
    const base = view === "outside" ? 30 : 24;
    return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? base : -base));
  }
  const base = fold.type === "roll" ? (view === "outside" ? 22 : 20) : view === "outside" ? 32 : 26;
  return Array.from({ length: n }, () => base);
}

export default function FoldedPreview({
  fold,
  widthMm,
  heightMm,
  frontUrl,
  backUrl,
  initialView = "outside",
}: {
  fold: FoldConfig;
  widthMm: number;
  heightMm: number;
  frontUrl: string;
  backUrl: string;
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const vertical = fold.direction === "vertical";
  const length = foldAxisLength(fold, widthMm, heightMm);
  const panels = foldPanels(fold, length, "front");
  const angles = hingeAngles(fold, view);
  // Inclinaison cumulée de chaque volet : plus il tourne, plus il s'assombrit
  // (un dépliant blanc paraîtrait plat sans ombrage).
  const tilt = panels.map((_, i) => angles.slice(0, i).reduce((sum, a) => sum + a, 0));
  const shade = (i: number) => 0.04 + 0.16 * Math.abs(Math.sin((tilt[i] * Math.PI) / 180));

  // Échelle d'affichage : la feuille dépliée tient dans ~460 × 360 px.
  const scale = Math.min(460 / widthMm, 360 / heightMm);
  const W = widthMm * scale;
  const H = heightMm * scale;

  const face = (url: string, x: number, y: number, w: number, h: number, back: boolean): React.CSSProperties => ({
    position: "absolute",
    inset: 0,
    width: w,
    height: h,
    backgroundImage: `url(${url})`,
    backgroundSize: `${W}px ${H}px`,
    backgroundPosition: `${-x}px ${-y}px`,
    backfaceVisibility: "hidden",
    transform: back ? "rotateY(180deg)" : undefined,
    boxShadow: "0 0 0 0.5px rgba(0,0,0,0.12)",
  });

  // Volets imbriqués : chacun porte le suivant, accroché à son bord (droit ou bas).
  const renderPanel = (i: number): React.ReactNode => {
    const p = panels[i];
    const size = p.size * scale;
    const start = p.start * scale;
    const w = vertical ? size : W;
    const h = vertical ? H : size;
    const frontX = vertical ? start : 0;
    const frontY = vertical ? 0 : start;
    // Derrière ce volet, au verso : en miroir horizontal.
    const backX = vertical ? W - start - size : 0;
    const style: React.CSSProperties = {
      position: "absolute",
      width: w,
      height: h,
      transformStyle: "preserve-3d",
      transition: "transform 600ms ease",
      ...(i === 0
        ? { left: 0, top: 0 }
        : vertical
          ? { left: panels[i - 1].size * scale, top: 0, transformOrigin: "left center", transform: `rotateY(${angles[i - 1]}deg)` }
          : { left: 0, top: panels[i - 1].size * scale, transformOrigin: "center top", transform: `rotateX(${-angles[i - 1]}deg)` }),
    };
    return (
      <div key={i} style={style}>
        <div style={face(frontUrl, frontX, frontY, w, h, false)}>
          <div style={{ position: "absolute", inset: 0, background: `rgba(0,0,0,${shade(i)})` }} />
        </div>
        <div style={face(backUrl, backX, frontY, w, h, true)}>
          <div style={{ position: "absolute", inset: 0, background: `rgba(0,0,0,${shade(i)})` }} />
        </div>
        {i + 1 < panels.length && renderPanel(i + 1)}
      </div>
    );
  };

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-text">Aperçu plié</p>
        <div className="flex rounded-lg border border-border p-0.5 text-xs">
          {(["outside", "inside"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-2.5 py-1 ${view === v ? "bg-pico-black text-white" : "text-text-muted hover:bg-surface-muted"}`}
            >
              {v === "outside" ? "Extérieur" : "Intérieur"}
            </button>
          ))}
        </div>
      </div>
      <div
        className="flex items-center justify-center overflow-hidden rounded-xl bg-surface-muted"
        style={{ height: H + 80, perspective: 1600 }}
      >
        <div
          style={{
            position: "relative",
            width: W,
            height: H,
            transformStyle: "preserve-3d",
            transition: "transform 600ms ease",
            // L'intérieur : la feuille retournée, vue de l'autre côté.
            transform: `scale(0.86) rotateX(${vertical ? 10 : 18}deg) rotateY(${view === "inside" ? 180 + (vertical ? 16 : 0) : vertical ? -20 : 0}deg)`,
          }}
        >
          {renderPanel(0)}
        </div>
      </div>
    </div>
  );
}
