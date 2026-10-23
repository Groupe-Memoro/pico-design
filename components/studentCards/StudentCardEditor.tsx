"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CopyIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import FontPicker from "@/components/FontPicker";
import { fontOptionById } from "@/lib/design/fonts";
import { loadFont } from "@/lib/design/fontLoader";
import { fitFontMm } from "@/lib/stickers/types";
import {
  BARCODE_TYPES,
  CARD_SIDE_LABELS,
  CARD_ZONE_LABELS,
  TWO_D_BARCODES,
  contentColumns,
  fillContent,
  looseKey,
  newCardZone,
  zoneText,
  type BarcodeType,
  type CardSample,
  type CardSide,
  type CardZone,
  type CardZoneKind,
  type StudentCardTemplate,
  type ZoneRotation,
} from "@/lib/studentCards/types";
import type { CsvData } from "@/lib/studentCards/csv";
import { PhotoIndex } from "@/lib/studentCards/photos";
import CardProduction from "@/components/studentCards/CardProduction";

const MIN_ZONE_MM = 1.5;
const round = (v: number) => Math.round(v * 10) / 10;

type Drag =
  | { kind: "create"; startX: number; startY: number; x: number; y: number }
  | { kind: "move"; id: string; dx: number; dy: number }
  | { kind: "resize"; id: string }
  | null;

// Largeur et hauteur d'un texte pour 1 mm de corps, mesurées par le canevas du
// navigateur (le serveur mesure avec fontkit : même règle, voir fitFontMm).
function useTextMeasure(fontsVersion: number) {
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  return useCallback(
    (zone: CardZone, text: string) => {
      if (!ctxRef.current) ctxRef.current = document.createElement("canvas").getContext("2d");
      const ctx = ctxRef.current;
      const font = fontOptionById(zone.fontId);
      if (!ctx) return { widthPerMm: text.length * 0.6, heightPerMm: 1.2 };
      ctx.font = `${zone.bold ? font.weightBold : font.weightRegular} 100px "${font.family}"`;
      const m = ctx.measureText(text);
      const height = (m.fontBoundingBoxAscent ?? 90) + (m.fontBoundingBoxDescent ?? 25);
      return { widthPerMm: m.width / 100, heightPerMm: height / 100 };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fontsVersion]
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";

// Valeur du menu « Information » pour le texte personnalisé.
const CUSTOM = "__custom__";

// « {Nom} » seul → « Nom » : le contenu est une colonne, choisie au menu.
function singleColumn(content: string): string | null {
  return content.match(/^\{([^{}]+)\}$/)?.[1].trim() ?? null;
}

// Colonnes du prénom et du nom de famille, d'après leur intitulé.
function nameColumns(columns: string[]): { first: string; last: string } | null {
  const first = columns.find((c) => /^(prenom|first ?name|given ?name)/.test(looseKey(c)));
  const last = columns.find((c) => /^(nom( de famille)?|last ?name|surname|family ?name)$/.test(looseKey(c)));
  return first && last ? { first, last } : null;
}

// Combinaisons du nom proposées au menu « Information affichée ».
function nameCombos(columns: string[]): { label: string; content: string }[] {
  const n = nameColumns(columns);
  if (!n) return [];
  return [
    { label: `${n.first} ${n.last}`, content: `{${n.first}} {${n.last}}` },
    { label: `${n.last}, ${n.first}`, content: `{${n.last}}, {${n.first}}` },
  ];
}

// Colonne qui ressemble à un identifiant d'élève : proposée pour le code-barres.
function guessIdColumn(columns: string[]): string | undefined {
  return columns.find((c) => /matricule|numero|no\b|code|id\b|fiche/.test(looseKey(c)));
}

export default function StudentCardEditor({ template, schools }: { template: StudentCardTemplate; schools: string[] }) {
  const router = useRouter();
  const W = Number(template.width_mm);
  const H = Number(template.height_mm);
  const [name, setName] = useState(template.name);
  const [school, setSchool] = useState(template.school);
  const [twoSided, setTwoSided] = useState(template.two_sided);
  const [zones, setZones] = useState<CardZone[]>(template.zones ?? []);
  const [sample, setSample] = useState<CardSample | null>(template.sample);
  const [photoColumn, setPhotoColumn] = useState<string>(template.photo_column ?? "");
  const [side, setSide] = useState<CardSide>("front");
  const [tool, setTool] = useState<CardZoneKind>("text");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [assetVersion, setAssetVersion] = useState(0);
  const [uploading, setUploading] = useState<CardSide | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  // Zones passées en « Texte personnalisé » : la saisie libre reste ouverte
  // même quand leur contenu n'est qu'une colonne, ou vide.
  const [customZones, setCustomZones] = useState<Set<string>>(new Set());
  const svgRef = useRef<SVGSVGElement>(null);

  // Données de la séance : le CSV chargé, les photos déposées, l'élève affiché.
  const [data, setData] = useState<CsvData | null>(null);
  const [photos, setPhotos] = useState<PhotoIndex>(() => new PhotoIndex([]));
  const [previewIndex, setPreviewIndex] = useState(0);

  const columns = data?.columns ?? sample?.columns ?? [];
  const previewRow = useMemo(
    () => data?.rows[previewIndex] ?? sample?.row ?? {},
    [data, previewIndex, sample]
  );
  const hasRowData = Object.values(previewRow).some((v) => v);

  // Photo de l'élève affiché, si elle est jumelée.
  const previewPhoto = photos.find(previewRow, photoColumn || null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewPhoto) return setPreviewPhotoUrl(null);
    const url = URL.createObjectURL(previewPhoto);
    setPreviewPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewPhoto]);

  // Polices de l'aperçu : la mesure du texte n'est juste qu'une fois chargées.
  const [fontsVersion, setFontsVersion] = useState(0);
  const usedFonts = useMemo(
    () => Array.from(new Set(zones.filter((z) => z.kind === "text").map((z) => `${z.fontId}:${z.bold}`))).join(","),
    [zones]
  );
  useEffect(() => {
    const loads = zones
      .filter((z) => z.kind === "text")
      .map((z) => {
        const f = fontOptionById(z.fontId);
        return loadFont(z.fontId, `${z.bold ? f.weightBold : f.weightRegular} 20px "${f.family}"`);
      });
    Promise.all(loads)
      .then(() => setFontsVersion((v) => v + 1))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usedFonts]);
  const measure = useTextMeasure(fontsVersion);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const sideZones = zones.filter((z) => z.side === side);
  const selected = zones.find((z) => z.id === selectedId) ?? null;

  function changeZones(next: CardZone[]) {
    setZones(next);
    setDirty(true);
  }
  function clampZone(z: CardZone): CardZone {
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
  function updateZone(id: string, patch: Partial<CardZone>) {
    changeZones(zones.map((z) => (z.id === id ? clampZone({ ...z, ...patch }) : z)));
  }
  function duplicate(zone: CardZone) {
    const { id: _id, ...rest } = zone;
    const copy = clampZone(newCardZone({ ...rest, x: zone.x + 2, y: zone.y + 2 }));
    changeZones([...zones, copy]);
    setSelectedId(copy.id);
  }
  function removeZone(id: string) {
    changeZones(zones.filter((z) => z.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!selected) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const step = e.shiftKey ? 2 : 0.2;
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
  function onZoneDown(e: React.PointerEvent, zone: CardZone) {
    e.stopPropagation();
    const p = toMm(e);
    setSelectedId(zone.id);
    setDrag({ kind: "move", id: zone.id, dx: p.x - zone.x, dy: p.y - zone.y });
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  function onHandleDown(e: React.PointerEvent, zone: CardZone) {
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
        // Un texte reprend le style du dernier texte : on en enchaîne souvent plusieurs.
        const lastText = [...zones].reverse().find((z) => z.kind === "text");
        const idColumn = guessIdColumn(columns);
        const zone = clampZone(
          newCardZone({
            ...(tool === "text" && lastText
              ? { fontId: lastText.fontId, bold: lastText.bold, color: lastText.color, align: lastText.align, uppercase: lastText.uppercase }
              : {}),
            side,
            kind: tool,
            x,
            y,
            width,
            height,
            content: tool === "barcode" && idColumn ? `{${idColumn}}` : "",
            maxFontMm: Math.max(1.5, round(height * 0.7)),
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
    body.append("school", school);
    body.append("two_sided", String(twoSided));
    body.append("zones", JSON.stringify(zones));
    body.append("photo_column", photoColumn);
    if (sample) body.append("sample", JSON.stringify(sample));
    const res = await fetch(`/api/student-cards/${template.id}`, { method: "PATCH", body }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setSaving(false);
    if (!res?.ok) {
      setMessage({ tone: "error", text: json.error ?? "L'enregistrement a échoué." });
      return false;
    }
    setDirty(false);
    setMessage({ tone: "ok", text: "Modèle enregistré." });
    router.refresh();
    return true;
  }

  async function uploadBackground(target: CardSide, file: File | null, remove = false) {
    if (!file && !remove) return;
    setUploading(target);
    setMessage(null);
    const body = new FormData();
    if (file) body.append(target, file);
    if (remove) body.append(`remove_${target}`, "true");
    const res = await fetch(`/api/student-cards/${template.id}`, { method: "PATCH", body }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setUploading(null);
    if (!res?.ok) {
      setMessage({ tone: "error", text: json.error ?? "L'envoi a échoué." });
      return;
    }
    setAssetVersion((v) => v + 1);
    router.refresh();
  }

  // Nouveau CSV : il devient l'aperçu du modèle (colonnes et première ligne).
  function onData(next: CsvData) {
    setData(next);
    setPreviewIndex(0);
    setSample({ columns: next.columns, row: next.rows[0] ?? {} });
    if (!photoColumn) {
      const guess =
        next.columns.find((c) => /photo|image|fichier/.test(looseKey(c))) ?? guessIdColumn(next.columns) ?? "";
      if (guess) setPhotoColumn(guess);
    }
    setDirty(true);
  }

  const hasBackground = (s: CardSide) => Boolean(s === "front" ? template.front_path : template.back_path);
  const backgroundUrl = (s: CardSide) => `/api/student-cards/${template.id}/asset/${s}?v=${assetVersion}`;
  const strokeMm = Math.max(W, H) / 400;
  const sides: CardSide[] = twoSided ? ["front", "back"] : ["front"];

  // Colonnes citées par les zones mais absentes du CSV chargé.
  const missingColumns = useMemo(() => {
    if (!columns.length) return [];
    const known = new Set(columns.map(looseKey));
    return Array.from(
      new Set(zones.flatMap((z) => (z.kind === "photo" ? [] : contentColumns(z.content))).filter((c) => !known.has(looseKey(c))))
    );
  }, [zones, columns]);

  function insertColumn(zone: CardZone, column: string) {
    const sep = zone.content && !zone.content.endsWith(" ") ? " " : "";
    updateZone(zone.id, { content: `${zone.content}${sep}{${column}}` });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link href="/cartes-etudiantes" className="text-xs text-neutral-500 underline hover:text-pico-black">
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
            className="mt-1 block w-full max-w-xl rounded-lg border border-transparent bg-transparent px-1 text-page-title font-semibold text-pico-black hover:border-neutral-300 focus:border-neutral-300"
          />
          <div className="mt-1 flex flex-wrap items-center gap-3 px-1 text-sm text-neutral-600">
            <label className="flex items-center gap-2">
              École
              <input
                list="student-card-schools"
                value={school}
                maxLength={120}
                onChange={(e) => {
                  setSchool(e.target.value);
                  setDirty(true);
                }}
                className="w-64 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm"
              />
              <datalist id="student-card-schools">
                {schools.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            <span className="text-neutral-500">
              {String(W).replace(".", ",")} × {String(H).replace(".", ",")} mm
            </span>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={twoSided}
                onChange={(e) => {
                  setTwoSided(e.target.checked);
                  if (!e.target.checked) setSide("front");
                  setDirty(true);
                }}
              />
              Recto-verso
            </label>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-xs text-amber-700">Modifications non enregistrées</span>}
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="flex items-center gap-2 rounded-lg bg-pico-maroon px-4 py-2 text-sm font-medium text-white hover:bg-pico-maroon-dark disabled:opacity-50"
          >
            {saving && <SpinnerIcon className="h-4 w-4" />}
            Enregistrer
          </button>
        </div>
      </div>

      {message && (
        <p className={`text-sm ${message.tone === "error" ? "text-red-600" : "text-neutral-600"}`}>{message.text}</p>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-600">
            <div className="flex overflow-hidden rounded-lg border border-neutral-300">
              {sides.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSide(s);
                    setSelectedId(null);
                  }}
                  className={`px-3 py-1.5 ${side === s ? "bg-pico-maroon text-white" : "bg-white hover:bg-neutral-50"}`}
                >
                  {CARD_SIDE_LABELS[s]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              Tracer
              <div className="flex overflow-hidden rounded-lg border border-neutral-300">
                {(["text", "photo", "barcode"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTool(k)}
                    className={`px-3 py-1.5 ${tool === k ? "bg-pico-black text-white" : "bg-white hover:bg-neutral-50"}`}
                  >
                    {CARD_ZONE_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-auto rounded-xl border border-neutral-200 bg-neutral-100 p-4">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="mx-auto block max-h-[70vh] w-full max-w-3xl touch-none select-none bg-white shadow-md"
              style={{ aspectRatio: `${W} / ${H}`, borderRadius: `${(3.18 / W) * 100}% / ${(3.18 / H) * 100}%` }}
              onPointerDown={onBackgroundDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              role="img"
              aria-label={`${CARD_SIDE_LABELS[side]} de la carte`}
            >
              {hasBackground(side) && (
                <image href={backgroundUrl(side)} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />
              )}
              {sideZones.map((z) => {
                const turned = z.rotation % 180 !== 0;
                const cw = turned ? z.height : z.width;
                const ch = turned ? z.width : z.height;
                const transform = `translate(${z.x + z.width / 2} ${z.y + z.height / 2}) rotate(${z.rotation})`;
                if (z.kind === "photo") {
                  return (
                    <g key={`c-${z.id}`} transform={transform} pointerEvents="none">
                      {previewPhotoUrl ? (
                        <image
                          href={previewPhotoUrl}
                          x={-cw / 2}
                          y={-ch / 2}
                          width={cw}
                          height={ch}
                          preserveAspectRatio="xMidYMid slice"
                        />
                      ) : (
                        <>
                          <rect x={-cw / 2} y={-ch / 2} width={cw} height={ch} fill="#e5e5e5" />
                          <text fontSize={Math.min(cw, ch) / 5} fill="#737373" textAnchor="middle" dominantBaseline="central">
                            Photo
                          </text>
                        </>
                      )}
                    </g>
                  );
                }
                if (z.kind === "barcode") {
                  const value = fillContent(z.content, previewRow) || (z.content ? "" : "123456789");
                  if (!value) return null;
                  const src = `/api/student-cards/barcode?type=${z.barcodeType}&text=${encodeURIComponent(value)}&w=${round(cw)}&h=${round(ch)}&showText=${z.showText ? 1 : 0}`;
                  return (
                    <g key={`c-${z.id}`} transform={transform} pointerEvents="none">
                      <image
                        href={src}
                        x={-cw / 2}
                        y={-ch / 2}
                        width={cw}
                        height={ch}
                        preserveAspectRatio={TWO_D_BARCODES.includes(z.barcodeType) ? "xMidYMid meet" : "none"}
                      />
                    </g>
                  );
                }
                // Texte : la ligne de l'élève, ou le contenu brut (« {Prénom} ») sans données.
                const text = hasRowData ? zoneText(z, previewRow) : z.uppercase ? z.content.toLocaleUpperCase("fr-CA") : z.content;
                if (!text) return null;
                const m = measure(z, text);
                const size = fitFontMm(z, m.widthPerMm, m.heightPerMm);
                const font = fontOptionById(z.fontId);
                const pad = cw * 0.04;
                const tx = z.align === "left" ? -cw / 2 + pad : z.align === "right" ? cw / 2 - pad : 0;
                return (
                  <g key={`c-${z.id}`} transform={transform} pointerEvents="none">
                    <text
                      x={tx}
                      y={0}
                      fontFamily={`"${font.family}"`}
                      fontWeight={z.bold ? font.weightBold : font.weightRegular}
                      fontSize={size}
                      fill={z.color}
                      textAnchor={z.align === "left" ? "start" : z.align === "right" ? "end" : "middle"}
                      dominantBaseline="central"
                    >
                      {text}
                    </text>
                  </g>
                );
              })}
              {sideZones.map((z) => {
                const isSelected = z.id === selectedId;
                const handle = strokeMm * 7;
                return (
                  <g key={`z-${z.id}`}>
                    <rect
                      x={z.x}
                      y={z.y}
                      width={z.width}
                      height={z.height}
                      fill={isSelected ? "rgba(255,106,0,0.10)" : "rgba(0,0,0,0.001)"}
                      stroke={isSelected ? "#ff6a00" : "#5c5347"}
                      strokeWidth={strokeMm * (isSelected ? 1.6 : 0.8)}
                      strokeDasharray={isSelected ? undefined : `${strokeMm * 3} ${strokeMm * 2}`}
                      style={{ cursor: "move" }}
                      onPointerDown={(e) => onZoneDown(e, z)}
                    />
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
            Choisissez quoi tracer (texte, photo ou code-barres), puis glissez sur la carte. Cliquez une zone pour la
            régler, glissez-la pour la déplacer, tirez son coin orange pour la redimensionner. Flèches : ajuster (Maj :
            par 2 mm). Suppr : retirer.
          </p>
          {data && data.rows.length > 0 && (
            <div className="flex items-center justify-center gap-2 text-sm text-neutral-600">
              <button
                type="button"
                onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                disabled={previewIndex === 0}
                className="rounded-lg border border-neutral-300 px-2 py-1 disabled:opacity-40"
                aria-label="Élève précédent"
              >
                ‹
              </button>
              <span>
                Élève {previewIndex + 1} / {data.rows.length}
              </span>
              <button
                type="button"
                onClick={() => setPreviewIndex((i) => Math.min(data.rows.length - 1, i + 1))}
                disabled={previewIndex >= data.rows.length - 1}
                className="rounded-lg border border-neutral-300 px-2 py-1 disabled:opacity-40"
                aria-label="Élève suivant"
              >
                ›
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* Fond de la face affichée */}
          <section className="space-y-2 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-pico-black">Fond du {CARD_SIDE_LABELS[side].toLowerCase()}</h2>
              <span className={`text-xs ${hasBackground(side) ? "text-green-700" : "text-amber-700"}`}>
                {uploading === side ? "Envoi…" : hasBackground(side) ? "✓ en place" : "manquant"}
              </span>
            </div>
            <p className="text-xs text-neutral-500">
              Le visuel du graphiste, au format de la carte (PDF, PNG ou JPEG), sans les données des élèves.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                disabled={uploading !== null}
                onChange={(e) => {
                  uploadBackground(side, e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
                className="min-w-0 flex-1 text-xs"
              />
              {hasBackground(side) && (
                <button
                  type="button"
                  onClick={() => confirm("Retirer ce fond ?") && uploadBackground(side, null, true)}
                  title="Retirer"
                  aria-label="Retirer le fond"
                  className="rounded-lg p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </section>

          {/* Zone sélectionnée */}
          <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-pico-black">
                {selected ? `Zone ${CARD_ZONE_LABELS[selected.kind].toLowerCase()}` : "Zones"}
              </h2>
              {selected && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => duplicate(selected)}
                    title="Dupliquer"
                    aria-label="Dupliquer la zone"
                    className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-pico-black"
                  >
                    <CopyIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeZone(selected.id)}
                    title="Supprimer"
                    aria-label="Supprimer la zone"
                    className="rounded-lg p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
            {!selected ? (
              <p className="text-xs text-neutral-500">
                {sideZones.length === 0
                  ? "Aucune zone sur cette face : choisissez quoi tracer, puis glissez sur la carte."
                  : "Cliquez une zone sur la carte pour la régler."}
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  {(["x", "y", "width", "height"] as const).map((key) => (
                    <Field key={key} label={{ x: "X (mm)", y: "Y (mm)", width: "Largeur", height: "Hauteur" }[key]}>
                      <input
                        type="number"
                        step={0.1}
                        value={selected[key]}
                        onChange={(e) => updateZone(selected.id, { [key]: Number(e.target.value) || 0 })}
                        className={inputClass}
                      />
                    </Field>
                  ))}
                </div>

                {selected.kind !== "photo" && (() => {
                  const raw = singleColumn(selected.content);
                  // La colonne du fichier telle qu'écrite (« {nom} » → « Nom »).
                  const chosen = raw ? columns.find((c) => looseKey(c) === looseKey(raw)) ?? raw : null;
                  const combos = selected.kind === "text" ? nameCombos(columns) : [];
                  const combo = combos.find((c) => c.content === selected.content.trim());
                  const custom = customZones.has(selected.id) || (selected.content !== "" && !chosen && !combo);
                  const value = custom ? CUSTOM : combo ? `combo:${combo.content}` : chosen ?? "";
                  const shown = fillContent(selected.content, previewRow);
                  return (
                    <div className="space-y-1.5">
                      <Field label={selected.kind === "barcode" ? "Information codée" : "Information affichée"}>
                        <select
                          value={value}
                          onChange={(e) => {
                            const next = e.target.value;
                            setCustomZones((set) => {
                              const copy = new Set(set);
                              if (next === CUSTOM) copy.add(selected.id);
                              else copy.delete(selected.id);
                              return copy;
                            });
                            if (next.startsWith("combo:")) updateZone(selected.id, { content: next.slice(6) });
                            else if (next !== CUSTOM) updateZone(selected.id, { content: next ? `{${next}}` : "" });
                          }}
                          className={inputClass}
                        >
                          <option value="">— Choisir —</option>
                          {combos.length > 0 && (
                            <optgroup label="Nom complet">
                              {combos.map((c) => (
                                <option key={c.content} value={`combo:${c.content}`}>
                                  {c.label}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {columns.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                          {chosen && !columns.some((c) => looseKey(c) === looseKey(chosen)) && (
                            <option value={chosen}>{chosen} (absente du fichier)</option>
                          )}
                          <option value={CUSTOM}>Texte personnalisé…</option>
                        </select>
                      </Field>
                      {custom && (
                        <>
                          <input
                            value={selected.content}
                            maxLength={500}
                            autoFocus
                            onChange={(e) => updateZone(selected.id, { content: e.target.value })}
                            placeholder={selected.kind === "barcode" ? "{Matricule}" : "{Prénom} {Nom} ou texte fixe"}
                            className={inputClass}
                          />
                          {columns.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {columns.map((c) => (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => insertColumn(selected, c)}
                                  className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:border-pico-maroon hover:text-pico-maroon"
                                >
                                  + {c}
                                </button>
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-neutral-500">
                            Combinez des colonnes et du texte fixe ; une colonne s&apos;écrit entre accolades : {"{Nom}"}.
                          </p>
                        </>
                      )}
                      {columns.length === 0 && !custom && (
                        <p className="text-xs text-neutral-500">
                          Chargez la liste des élèves (Excel ou CSV) pour choisir parmi ses colonnes.
                        </p>
                      )}
                      {hasRowData && shown && (
                        <p className="truncate text-xs text-neutral-500">
                          Élève affiché : <span className="text-pico-black">{shown}</span>
                        </p>
                      )}
                    </div>
                  );
                })()}

                {selected.kind === "text" && (
                  <>
                    <Field label="Police">
                      <FontPicker
                        value={selected.fontId}
                        onChange={(fontId) => updateZone(selected.id, { fontId })}
                        className={inputClass}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Couleur">
                        <input
                          type="color"
                          value={selected.color}
                          onChange={(e) => updateZone(selected.id, { color: e.target.value })}
                          className="mt-1 h-9 w-full cursor-pointer rounded border border-neutral-300"
                        />
                      </Field>
                      <Field label="Taille max. (mm)">
                        <input
                          type="number"
                          min={1.2}
                          step={0.1}
                          value={selected.maxFontMm}
                          onChange={(e) =>
                            updateZone(selected.id, { maxFontMm: Math.max(1.2, Number(e.target.value) || 1.2) })
                          }
                          className={inputClass}
                        />
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
                          onChange={(e) => updateZone(selected.id, { bold: e.target.checked })}
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
                  </>
                )}

                {selected.kind === "barcode" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Type">
                      <select
                        value={selected.barcodeType}
                        onChange={(e) => updateZone(selected.id, { barcodeType: e.target.value as BarcodeType })}
                        className={inputClass}
                      >
                        {Object.entries(BARCODE_TYPES).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {!TWO_D_BARCODES.includes(selected.barcodeType) && (
                      <label className="mt-5 flex items-center gap-1.5 text-sm text-neutral-700">
                        <input
                          type="checkbox"
                          checked={selected.showText}
                          onChange={(e) => updateZone(selected.id, { showText: e.target.checked })}
                        />
                        Chiffres sous les barres
                      </label>
                    )}
                  </div>
                )}

                {selected.kind === "photo" && (
                  <p className="text-xs text-neutral-500">
                    La photo de l&apos;élève remplit la zone, recadrée au besoin (le visage est privilégié). Les photos
                    se déposent plus bas, dans « Produire les cartes ».
                  </p>
                )}

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
            )}
          </section>

          <CardProduction
            templateId={template.id}
            templateName={name}
            zones={zones}
            data={data}
            onData={onData}
            photos={photos}
            onPhotos={setPhotos}
            photoColumn={photoColumn}
            onPhotoColumn={(c) => {
              setPhotoColumn(c);
              setDirty(true);
            }}
            previewIndex={previewIndex}
            missingColumns={missingColumns}
            beforeGenerate={async () => (dirty ? save() : true)}
          />
        </div>
      </div>
    </div>
  );
}
