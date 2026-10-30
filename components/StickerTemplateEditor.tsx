"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { CopyIcon, DownloadIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { fontOptionById, fontWeight } from "@/lib/design/fonts";
import { sheetLabel } from "@/lib/imposition/presets";
import { stickerSheetLayout } from "@/lib/stickers/layout";
import type { ImpositionCutter, ImpositionSheet } from "@/lib/types";
import {
  STICKER_ASSETS,
  STICKER_ASSET_COLUMN,
  STICKER_ASSET_LABELS,
  displayText,
  fitFontMm,
  newZone,
  type StickerAsset,
  type StickerTemplate,
  type StickerZone,
  type ZoneRotation,
} from "@/lib/stickers/types";
import FontPicker from "@/components/FontPicker";
import ColorPickerButton from "@/components/ColorPickerButton";
import { FontSizeInput, LengthInput, UnitsBar, unitLabel, useFontUnit, useLengthUnit } from "@/components/UnitInputs";
import { loadFont } from "@/lib/design/fontLoader";
import { measureInk } from "@/lib/design/inkMeasure";
import { formatInMm } from "@/lib/pdf/units";
import FontWeightSelect from "@/components/FontWeightSelect";

const ASSET_HELP: Record<StickerAsset, string> = {
  artwork: "La planche du graphiste, sans le nom. Imprimée sous le texte.",
  marks: "Les repères et codes lus par la Graphtec. Imprimés par-dessus tout.",
  guide: "Les lignes de coupe du graphiste : aident à placer les zones. Jamais imprimé.",
};

// Plus petite zone créée au glisser (mm) : en dessous, c'était un simple clic.
const MIN_ZONE_MM = 2;

type Drag =
  | { kind: "create"; startX: number; startY: number; x: number; y: number }
  | { kind: "move"; id: string; dx: number; dy: number }
  | { kind: "resize"; id: string }
  | null;

const round = (v: number) => Math.round(v * 10) / 10;

// Largeur et hauteur d'un texte pour 1 mm de corps, mesurées par le canevas
// du navigateur (le serveur mesure avec fontkit : même règle d'ajustement,
// voir fitFontMm, à quelques pour cent près).
function useTextMeasure(fontsVersion: number) {
  return useCallback(
    (zone: StickerZone, text: string) => {
      const font = fontOptionById(zone.fontId);
      // Encre mesurée au pixel (voir measureInk) : fiable dans tous les navigateurs.
      const ink = measureInk(`${fontWeight(font, zone)} "${font.family}"`, text, fontsVersion);
      return { widthPerMm: ink.left + ink.right, heightPerMm: ink.height, left: ink.left, right: ink.right };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fontsVersion]
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";

export default function StickerTemplateEditor({
  template,
  cutters,
  sheets,
}: {
  template: StickerTemplate;
  cutters: ImpositionCutter[];
  sheets: ImpositionSheet[];
}) {
  const router = useRouter();
  // Profil Graphtec relié : la planche prend la zone utile de sa feuille.
  const [cutterId, setCutterId] = useState<string>(template.cutter_id ?? "");
  const cutter = cutters.find((c) => c.id === cutterId) ?? null;
  const cutterSheet = sheets.find((s) => s.id === cutter?.sheet_id) ?? null;
  const layout = stickerSheetLayout(template, cutter, cutterSheet);
  const W = layout.area.width;
  const H = layout.area.height;
  const [name, setName] = useState(template.name);
  const [zones, setZones] = useState<StickerZone[]>(template.zones ?? []);
  const [lengthUnit] = useLengthUnit();
  const [fontUnit] = useFontUnit();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [sampleName, setSampleName] = useState("Marie-Ève");
  const [showArtwork, setShowArtwork] = useState(true);
  const [showGuide, setShowGuide] = useState(true);
  const [assetVersion, setAssetVersion] = useState(0);
  const [uploading, setUploading] = useState<StickerAsset | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [names, setNames] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ url: string; filename: string } | null>(null);

  // Polices de l'aperçu : la mesure du texte n'est juste qu'une fois chargées.
  const [fontsVersion, setFontsVersion] = useState(0);
  const usedFonts = useMemo(() => Array.from(new Set(zones.map((z) => `${z.fontId}:${z.bold}:${z.weight ?? ""}`))).join(","), [zones]);
  useEffect(() => {
    const loads = zones.map((z) => {
      const f = fontOptionById(z.fontId);
      return loadFont(z.fontId, `${fontWeight(f, z)} 20px "${f.family}"`);
    });
    Promise.all(loads)
      .then(() => setFontsVersion((v) => v + 1))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usedFonts]);
  const measure = useTextMeasure(fontsVersion);

  // Quitter la page avec des zones non enregistrées : le navigateur prévient.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const selected = zones.find((z) => z.id === selectedId) ?? null;

  function changeZones(next: StickerZone[]) {
    setZones(next);
    setDirty(true);
  }
  function updateZone(id: string, patch: Partial<StickerZone>) {
    changeZones(zones.map((z) => (z.id === id ? clampZone({ ...z, ...patch }) : z)));
  }
  function clampZone(z: StickerZone): StickerZone {
    const width = Math.min(Math.max(MIN_ZONE_MM, z.width), W);
    const height = Math.min(Math.max(MIN_ZONE_MM, z.height), H);
    return {
      ...z,
      width: round(width),
      height: round(height),
      x: round(Math.min(Math.max(0, z.x), W - width)),
      y: round(Math.min(Math.max(0, z.y), H - height)),
    };
  }
  function duplicate(zone: StickerZone) {
    // Tout sauf l'identifiant : la copie reçoit le sien (newZone).
    const { id: _id, ...style } = zone;
    const copy = clampZone(newZone({ ...style, x: zone.x + 5, y: zone.y + 5 }));
    changeZones([...zones, copy]);
    setSelectedId(copy.id);
  }
  function removeZone(id: string) {
    changeZones(zones.filter((z) => z.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  // Flèches : déplace la zone sélectionnée (0,5 mm, 5 mm avec Maj) ;
  // Suppr / Retour arrière : la retire. Jamais pendant une saisie.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!selected) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const step = e.shiftKey ? 5 : 0.5;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (moves[e.key]) {
        e.preventDefault();
        updateZone(selected.id, { x: selected.x + moves[e.key][0], y: selected.y + moves[e.key][1] });
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeZone(selected.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function toMm(e: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const r = p.matrixTransform(ctm.inverse());
    return { x: Math.min(Math.max(0, r.x), W), y: Math.min(Math.max(0, r.y), H) };
  }

  function onBackgroundDown(e: React.PointerEvent) {
    const p = toMm(e);
    setSelectedId(null);
    setDrag({ kind: "create", startX: p.x, startY: p.y, x: p.x, y: p.y });
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  function onZoneDown(e: React.PointerEvent, zone: StickerZone) {
    e.stopPropagation();
    const p = toMm(e);
    setSelectedId(zone.id);
    setDrag({ kind: "move", id: zone.id, dx: p.x - zone.x, dy: p.y - zone.y });
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  function onHandleDown(e: React.PointerEvent, zone: StickerZone) {
    e.stopPropagation();
    setSelectedId(zone.id);
    setDrag({ kind: "resize", id: zone.id });
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const p = toMm(e);
    if (drag.kind === "create") setDrag({ ...drag, x: p.x, y: p.y });
    else if (drag.kind === "move") updateZone(drag.id, { x: p.x - drag.dx, y: p.y - drag.dy });
    else {
      const z = zones.find((zz) => zz.id === drag.id);
      if (z) updateZone(z.id, { width: p.x - z.x, height: p.y - z.y });
    }
  }
  function onPointerUp() {
    if (drag?.kind === "create") {
      const x = Math.min(drag.startX, drag.x);
      const y = Math.min(drag.startY, drag.y);
      const width = Math.abs(drag.x - drag.startX);
      const height = Math.abs(drag.y - drag.startY);
      if (width >= MIN_ZONE_MM && height >= MIN_ZONE_MM) {
        // La nouvelle zone reprend le style de la dernière : on en enchaîne souvent plusieurs.
        const last = zones[zones.length - 1];
        const zone = clampZone(
          newZone({
            ...(last ? { fontId: last.fontId, bold: last.bold, weight: last.weight, uppercase: last.uppercase, color: last.color, align: last.align } : {}),
            x,
            y,
            width,
            height,
            maxFontMm: Math.max(2, round(height * 0.6)),
          })
        );
        changeZones([...zones, zone]);
        setSelectedId(zone.id);
      }
    }
    setDrag(null);
  }

  async function save(): Promise<boolean> {
    setSaving(true);
    setMessage(null);
    const body = new FormData();
    body.append("name", name);
    body.append("cutter_id", cutterId);
    body.append("zones", JSON.stringify(zones));
    const res = await fetch(`/api/stickers/${template.id}`, { method: "PATCH", body }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setSaving(false);
    if (!res?.ok) {
      setMessage({ tone: "error", text: data.error ?? "L'enregistrement a échoué." });
      return false;
    }
    setDirty(false);
    setMessage({ tone: "ok", text: "Modèle enregistré." });
    router.refresh();
    return true;
  }

  async function uploadAsset(asset: StickerAsset, file: File | null, remove = false) {
    if (!file && !remove) return;
    setUploading(asset);
    setMessage(null);
    const body = new FormData();
    if (file) body.append(asset, file);
    if (remove) body.append(`remove_${asset}`, "true");
    const res = await fetch(`/api/stickers/${template.id}`, { method: "PATCH", body }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setUploading(null);
    if (!res?.ok) {
      setMessage({ tone: "error", text: data.error ?? "L'envoi a échoué." });
      return;
    }
    setAssetVersion((v) => v + 1);
    router.refresh();
  }

  async function generate() {
    if (dirty && !(await save())) return;
    setGenerating(true);
    setMessage(null);
    const res = await fetch(`/api/stickers/${template.id}/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names }),
    }).catch(() => null);
    setGenerating(false);
    if (!res?.ok) {
      const data = res ? await res.json().catch(() => ({})) : {};
      setMessage({ tone: "error", text: data.error ?? "La préparation a échoué." });
      return;
    }
    const blob = await res.blob();
    const count = names.split("\n").filter((n) => n.trim()).length;
    const first = names.split("\n").find((n) => n.trim())?.trim() ?? "planche";
    setResult({
      url: URL.createObjectURL(blob),
      filename: `${name} - ${count === 1 ? first : `${count} noms`}.pdf`.replace(/[\\/:*?"<>|]+/g, " "),
    });
  }

  const assetUrl = (asset: StickerAsset) => `/api/stickers/${template.id}/asset/${asset}?v=${assetVersion}`;
  const hasAsset = (asset: StickerAsset) => Boolean(template[STICKER_ASSET_COLUMN[asset]]);
  const strokeMm = Math.max(W, H) / 600;
  const nameCount = names.split("\n").filter((n) => n.trim()).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link href="/autocollants" className="text-xs text-neutral-500 underline hover:text-text">
            ← Tous les modèles
          </Link>
          <input
            value={name}
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            aria-label="Nom du modèle"
            className="mt-1 block w-full max-w-xl rounded-lg border border-transparent bg-transparent px-1 text-page-title font-semibold text-text hover:border-neutral-300 focus:border-neutral-300"
          />
          <p className="px-1 text-sm text-neutral-500">
            Planche {sheetLabel(W, H)}
            {cutter && cutterSheet ? ` dans une feuille ${sheetLabel(layout.sheetWidth, layout.sheetHeight)}` : ""} ·{" "}
            {zones.length} zone{zones.length > 1 ? "s" : ""} de nom
          </p>
          <label className="mt-2 flex flex-wrap items-center gap-2 px-1 text-sm text-neutral-600">
            Profil Graphtec
            <select
              value={cutterId}
              onChange={(e) => {
                const next = e.target.value;
                setCutterId(next);
                setDirty(true);
                // La planche change de taille : les zones restent à l'intérieur.
                const c = cutters.find((cc) => cc.id === next) ?? null;
                const l = stickerSheetLayout(template, c, sheets.find((s) => s.id === c?.sheet_id) ?? null);
                setZones((all) =>
                  all.map((z) => {
                    const width = Math.min(z.width, l.area.width);
                    const height = Math.min(z.height, l.area.height);
                    return {
                      ...z,
                      width,
                      height,
                      x: Math.min(z.x, l.area.width - width),
                      y: Math.min(z.y, l.area.height - height),
                    };
                  })
                );
              }}
              className="rounded-lg border border-neutral-300 bg-surface px-2 py-1 text-sm"
            >
              <option value="">Aucun — la planche occupe toute la feuille</option>
              {cutters.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.sheet_id}>
                  {c.name}
                  {c.sheet_id ? "" : " (sans format de papier)"}
                </option>
              ))}
            </select>
          </label>
          {cutter && (
            <p className="px-1 text-xs text-neutral-500">
              Marges du profil (haut / droite / bas / gauche) :{" "}
              {[cutter.margin_top_mm, cutter.margin_right_mm, cutter.margin_bottom_mm, cutter.margin_left_mm].map(formatInMm).join(" / ")}{" "}
              · calibration {formatInMm(cutter.offset_x_mm)} / {formatInMm(cutter.offset_y_mm)}. Le visuel se pose dans ces
              marges ; les codes Graphtec viennent du profil.
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-xs text-warning-strong">Modifications non enregistrées</span>}
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="flex items-center gap-2 btn-primary disabled:opacity-50"
          >
            {saving && <SpinnerIcon className="h-4 w-4" />}
            Enregistrer
          </button>
        </div>
      </div>

      {message && (
        <p className={`text-sm ${message.tone === "error" ? "text-danger" : "text-neutral-600"}`}>{message.text}</p>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Planche : visuel, nom d'exemple dans chaque zone, gabarit en transparence. */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-600">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={showArtwork} onChange={(e) => setShowArtwork(e.target.checked)} />
              Visuel
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={showGuide} onChange={(e) => setShowGuide(e.target.checked)} />
              Gabarit de guidage
            </label>
            <label className="flex items-center gap-1.5">
              Nom d&apos;exemple
              <input
                value={sampleName}
                onChange={(e) => setSampleName(e.target.value)}
                className="w-40 rounded border border-neutral-300 px-2 py-1"
              />
            </label>
          </div>
          <div className="overflow-auto rounded-xl border border-neutral-200 bg-neutral-100 p-3">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="mx-auto block max-h-[78vh] w-auto max-w-full touch-none select-none bg-white shadow-sm"
              style={{ aspectRatio: `${W} / ${H}`, cursor: drag?.kind === "create" ? "crosshair" : "default" }}
              onPointerDown={onBackgroundDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              role="img"
              aria-label="Planche du modèle"
            >
              {showArtwork && hasAsset("artwork") && (
                <image href={assetUrl("artwork")} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />
              )}
              {zones.map((z) => {
                const text = displayText(z, sampleName);
                if (!text) return null;
                const m = measure(z, text);
                const size = fitFontMm(z, m.widthPerMm, m.heightPerMm);
                const font = fontOptionById(z.fontId);
                const turned = z.rotation % 180 !== 0;
                const boxW = turned ? z.height : z.width;
                // Sans marge intérieure : le dessin des lettres touche le bord (ou est centré).
                const tx =
                  z.align === "left" ? -boxW / 2 + m.left * size : z.align === "right" ? boxW / 2 - m.right * size : ((m.left - m.right) / 2) * size;
                return (
                  <g
                    key={`t-${z.id}`}
                    transform={`translate(${z.x + z.width / 2} ${z.y + z.height / 2}) rotate(${z.rotation})`}
                    pointerEvents="none"
                  >
                    {/* Mis en page à 100, puis réduit : à la taille réelle, Safari
                        arrondit la police et le texte n'atteint plus le bord. */}
                    <text
                      x={(tx * 100) / size}
                      y={0}
                      transform={`scale(${size / 100})`}
                      fontFamily={`"${font.family}"`}
                      fontWeight={fontWeight(font, z)}
                      fontSize={100}
                      fill={z.color}
                      textAnchor="start"
                      dominantBaseline="central"
                    >
                      {text}
                    </text>
                  </g>
                );
              })}
              {showGuide && hasAsset("guide") && (
                // « multiply » : le blanc du gabarit s'efface, ses traits restent par-dessus.
                <image
                  href={assetUrl("guide")}
                  x={0}
                  y={0}
                  width={W}
                  height={H}
                  preserveAspectRatio="none"
                  opacity={0.7}
                  style={{ mixBlendMode: "multiply" }}
                  pointerEvents="none"
                />
              )}
              {zones.map((z, i) => {
                const isSelected = z.id === selectedId;
                const handle = strokeMm * 8;
                return (
                  <g key={`z-${z.id}`}>
                    <rect
                      x={z.x}
                      y={z.y}
                      width={z.width}
                      height={z.height}
                      fill={isSelected ? "rgba(255,106,0,0.10)" : "rgba(0,0,0,0.001)"}
                      stroke={isSelected ? "#ff6a00" : "#5c5347"}
                      strokeWidth={strokeMm * (isSelected ? 1.6 : 1)}
                      strokeDasharray={isSelected ? undefined : `${strokeMm * 4} ${strokeMm * 3}`}
                      style={{ cursor: "move" }}
                      onPointerDown={(e) => onZoneDown(e, z)}
                    />
                    <text
                      x={z.x + strokeMm * 3}
                      y={z.y + strokeMm * 3}
                      fontSize={strokeMm * 9}
                      fill={isSelected ? "#ff6a00" : "#5c5347"}
                      dominantBaseline="hanging"
                      pointerEvents="none"
                    >
                      {i + 1}
                    </text>
                    {isSelected && (
                      <rect
                        x={z.x + z.width - handle / 2}
                        y={z.y + z.height - handle / 2}
                        width={handle}
                        height={handle}
                        fill="#ff6a00"
                        style={{ cursor: "nwse-resize" }}
                        onPointerDown={(e) => onHandleDown(e, z)}
                      />
                    )}
                  </g>
                );
              })}
              {drag?.kind === "create" && (
                <rect
                  x={Math.min(drag.startX, drag.x)}
                  y={Math.min(drag.startY, drag.y)}
                  width={Math.abs(drag.x - drag.startX)}
                  height={Math.abs(drag.y - drag.startY)}
                  fill="rgba(255,106,0,0.12)"
                  stroke="#ff6a00"
                  strokeWidth={strokeMm}
                  pointerEvents="none"
                />
              )}
            </svg>
          </div>
          <p className="text-xs text-neutral-500">
            Glissez sur la planche pour tracer une zone de nom. Cliquez une zone pour la régler, glissez-la pour la
            déplacer, tirez son coin orange pour la redimensionner. Flèches : ajuster (Maj : par 5 mm). Suppr : retirer.
          </p>
        </div>

        <div className="space-y-4">
          {/* Fichiers du modèle */}
          <section className="space-y-3 card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-text">Fichiers du modèle</h2>
            {STICKER_ASSETS.map((asset) =>
              asset === "marks" && cutter ? (
                // Avec un profil, ses codes servent : rien à envoyer ici.
                <div key={asset} className="space-y-1 border-t border-neutral-100 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text">{STICKER_ASSET_LABELS.marks}</span>
                    <span className={`text-xs ${cutter.marks_path ? "text-success-strong" : "text-warning-strong"}`}>
                      {cutter.marks_path ? "✓ du profil" : "absents du profil"}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500">
                    Ceux du profil « {cutter.name} », imprimés sur toute la feuille. Ils se changent dans
                    l&apos;imposition (Profil de découpe → Gérer).
                  </p>
                </div>
              ) : (
              <div key={asset} className="space-y-1 border-t border-neutral-100 pt-3 first:border-0 first:pt-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text">{STICKER_ASSET_LABELS[asset]}</span>
                  <span className={`text-xs ${hasAsset(asset) ? "text-success-strong" : "text-warning-strong"}`}>
                    {uploading === asset ? "Envoi…" : hasAsset(asset) ? "✓ en place" : "manquant"}
                  </span>
                </div>
                <p className="text-xs text-neutral-500">{ASSET_HELP[asset]}</p>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    disabled={uploading !== null}
                    onChange={(e) => {
                      uploadAsset(asset, e.target.files?.[0] ?? null);
                      e.target.value = "";
                    }}
                    className="min-w-0 flex-1 text-xs"
                  />
                  {hasAsset(asset) && asset === "guide" && (
                    <a
                      href={`/api/stickers/${template.id}/asset/guide?download=1`}
                      title="Télécharger le gabarit"
                      aria-label="Télécharger le gabarit"
                      className="icon-btn"
                    >
                      <DownloadIcon className="h-4 w-4" />
                    </a>
                  )}
                  {hasAsset(asset) && (
                    <button
                      type="button"
                      onClick={() => confirm(`Retirer « ${STICKER_ASSET_LABELS[asset]} » ?`) && uploadAsset(asset, null, true)}
                      title="Retirer"
                      aria-label="Retirer"
                      className="rounded-lg p-1.5 text-neutral-500 hover:bg-danger-subtle hover:text-danger"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              )
            )}
          </section>

          {/* Zone sélectionnée */}
          <section className="space-y-3 card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text">
                {selected ? `Zone ${zones.indexOf(selected) + 1}` : "Zones de nom"}
              </h2>
              {selected && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => duplicate(selected)}
                    title="Dupliquer"
                    aria-label="Dupliquer la zone"
                    className="icon-btn"
                  >
                    <CopyIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeZone(selected.id)}
                    title="Supprimer"
                    aria-label="Supprimer la zone"
                    className="rounded-lg p-1.5 text-neutral-500 hover:bg-danger-subtle hover:text-danger"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
            {!selected ? (
              <p className="text-xs text-neutral-500">
                {zones.length === 0
                  ? "Aucune zone : glissez sur la planche pour en tracer une."
                  : "Cliquez une zone sur la planche pour régler sa police, sa couleur et sa taille."}
              </p>
            ) : (
              <div className="space-y-3">
                <UnitsBar font />
                <div className="grid grid-cols-4 gap-2">
                  {(["x", "y", "width", "height"] as const).map((key) => (
                    <Field key={key} label={`${{ x: "X", y: "Y", width: "Largeur", height: "Hauteur" }[key]} (${unitLabel(lengthUnit)})`}>
                      <LengthInput
                        valueMm={selected[key]}
                        onChange={(mm) => updateZone(selected.id, { [key]: mm })}
                        className={inputClass}
                      />
                    </Field>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Police">
                    <FontPicker
                      value={selected.fontId}
                      onChange={(fontId) => updateZone(selected.id, { fontId })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Graisse">
                    <FontWeightSelect
                      fontId={selected.fontId}
                      value={selected}
                      onChange={(patch) => updateZone(selected.id, patch)}
                      className={inputClass}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Couleur">
                    <div className="mt-1 flex h-9 items-center">
                      <ColorPickerButton
                        value={selected.color}
                        onChange={(color) => updateZone(selected.id, { color })}
                        label="Couleur du texte"
                      />
                    </div>
                  </Field>
                  <Field label={`Taille max. (${fontUnit})`}>
                    <FontSizeInput
                      valueMm={selected.maxFontMm}
                      minMm={1.5}
                      onChange={(maxFontMm) => updateZone(selected.id, { maxFontMm })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Rotation">
                    <select
                      value={selected.rotation}
                      onChange={(e) => updateZone(selected.id, { rotation: Number(e.target.value) as ZoneRotation })}
                      className={inputClass}
                    >
                      <option value={0}>0°</option>
                      <option value={90}>90°</option>
                      <option value={180}>180°</option>
                      <option value={270}>270°</option>
                    </select>
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-700">
                  <div className="flex overflow-hidden rounded-lg border border-neutral-300 text-xs">
                    {(["left", "center", "right"] as const).map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => updateZone(selected.id, { align: a })}
                        className={`px-2.5 py-1.5 ${selected.align === a ? "bg-pico-maroon text-white" : "hover:bg-neutral-50"}`}
                      >
                        {{ left: "Gauche", center: "Centre", right: "Droite" }[a]}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={selected.bold}
                      onChange={(e) => updateZone(selected.id, { bold: e.target.checked, weight: undefined })}
                    />
                    Gras
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={selected.uppercase}
                      onChange={(e) => updateZone(selected.id, { uppercase: e.target.checked })}
                    />
                    Majuscules
                  </label>
                </div>
                <p className="text-xs text-neutral-500">
                  Le nom prend la plus grande taille qui tienne dans la zone, sans dépasser la taille maximale.
                </p>
              </div>
            )}
          </section>

          {/* Préparer des planches */}
          <section className="space-y-3 card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-text">Préparer des planches</h2>
            <textarea
              value={names}
              onChange={(e) => setNames(e.target.value)}
              rows={5}
              placeholder={"Un nom par ligne, une planche par nom\nEx. Léa Tremblay"}
              className="w-full input"
            />
            <button
              type="button"
              onClick={generate}
              disabled={generating || nameCount === 0 || zones.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-pico-maroon px-4 py-2.5 text-sm font-medium text-white hover:bg-pico-maroon-dark disabled:opacity-50"
            >
              {generating && <SpinnerIcon className="h-4 w-4" />}
              {generating
                ? "Préparation…"
                : nameCount > 1
                  ? `Préparer ${nameCount} planches`
                  : "Préparer la planche"}
            </button>
            {zones.length === 0 && <p className="text-xs text-neutral-500">Tracez d&apos;abord au moins une zone de nom.</p>}
            {!(cutter ? cutter.marks_path : hasAsset("marks")) && zones.length > 0 && (
              <p className="text-xs text-warning-strong">Sans fichier de codes Graphtec, la planche ne pourra pas être découpée.</p>
            )}
          </section>
        </div>
      </div>

      {result && (
        <Modal
          title="Planches prêtes"
          onClose={() => {
            URL.revokeObjectURL(result.url);
            setResult(null);
          }}
          wide
        >
          <iframe src={result.url} title="Planches" className="h-[65vh] w-full rounded border border-neutral-200" />
          <div className="mt-4 flex gap-2">
            <a
              href={result.url}
              download={result.filename}
              className="flex flex-1 items-center justify-center gap-2 btn-primary"
            >
              <DownloadIcon className="h-4 w-4" />
              Télécharger le PDF
            </a>
            {hasAsset("guide") && (
              <a
                href={`/api/stickers/${template.id}/asset/guide?download=1`}
                className="flex items-center justify-center gap-2 btn-secondary"
              >
                <DownloadIcon className="h-4 w-4" />
                Gabarit de découpe
              </a>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
