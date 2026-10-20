"use client";

import { useEffect, useRef, useState } from "react";
import type { Template, ThemeSlot, ThemeSlotShape, ThemeTextZone } from "@/lib/types";
import ThemeTextOverlay from "@/components/ThemeTextOverlay";
import { MAX_THEME_TEXT_ZONES, THEME_TEXT_ALIGNS, newThemeTextZone } from "@/lib/themeText";
import type { ThemeWithOverlayUrl } from "@/components/ThemesTable";
import { CopyIcon, SpinnerIcon } from "@/components/icons";
import FileDropZone from "@/components/FileDropZone";
import {
  MAX_POINTS,
  MAX_POLYGON_SIDES,
  MAX_THEME_SLOTS,
  MIN_POLYGON_SIDES,
  polygonPointsAttr,
  regularPolygon,
  slotClipPath,
  slotMaskStyle,
  sanitizeMaskSvg,
  maskSvgAspect,
  slotShape,
} from "@/lib/themeShapes";
import { templateOptionLabel } from "@/lib/templateLabel";
import FontSelectOptions from "@/components/FontSelectOptions";

const MIN_RATIO = 0.05;

// Emplacement par défaut d'un nouveau slot — carré (même taille physique en
// largeur et en hauteur, pas juste widthRatio === heightRatio : ces deux
// ratios sont relatifs à des dimensions différentes de la page — largeur et
// hauteur —, presque toujours inégales, donc un simple 0.35/0.35 donnerait
// un rectangle, pas un carré). Basé sur 35 % de la plus petite dimension de
// la page, pour rester raisonnable même sur un format très étiré (bannière,
// signet) — voir le commentaire de `pageAspectRatio`.
//
// Décalé selon son index pour que plusieurs slots ajoutés d'affilée ne se
// superposent pas exactement, même si l'admin les repositionne presque
// toujours ensuite.
function defaultSlot(index: number, pageAspectRatio: number): ThemeSlot {
  const offsets = [
    { x: 0.5, y: 0.5 },
    { x: 0.3, y: 0.35 },
    { x: 0.7, y: 0.65 },
  ];
  const o = offsets[index % offsets.length];
  const SIZE = 0.35;
  const { widthRatio, heightRatio } =
    pageAspectRatio >= 1
      ? { widthRatio: SIZE / pageAspectRatio, heightRatio: SIZE }
      : { widthRatio: SIZE, heightRatio: SIZE * pageAspectRatio };
  return { positionX: o.x, positionY: o.y, widthRatio, heightRatio };
}

function clampSlot(slot: ThemeSlot): ThemeSlot {
  const widthRatio = Math.min(1, Math.max(MIN_RATIO, slot.widthRatio));
  const heightRatio = Math.min(1, Math.max(MIN_RATIO, slot.heightRatio));
  const positionX = Math.min(1 - widthRatio / 2, Math.max(widthRatio / 2, slot.positionX));
  const positionY = Math.min(1 - heightRatio / 2, Math.max(heightRatio / 2, slot.positionY));
  // La forme (et ses sommets, relatifs au rectangle) suit l'emplacement.
  return { ...slot, positionX, positionY, widthRatio, heightRatio };
}

const SHAPE_OPTIONS: { value: ThemeSlotShape; label: string }[] = [
  { value: "rect", label: "Rectangle" },
  { value: "ellipse", label: "Cercle" },
  { value: "polygon", label: "Polygone" },
  { value: "svg", label: "Masque SVG" },
];
const DEFAULT_POLYGON_SIDES = 6;

/**
 * Éditeur d'un Thème (voir supabase/migrations/0046_themes.sql) : un modèle,
 * un graphisme (PNG avec transparence, affiché par-dessus les photos), et 1
 * N emplacements (`slots`) que l'admin place/redimensionne directement sur
 * un aperçu de la page du modèle, en glissant — même principe que les
 * calques de Design Shopify (voir ImageSourcePicker/LayerHandles), mais sans
 * rotation ici (positions/tailles seulement, suffisant pour un cadre photo).
 *
 * Le graphisme est affiché à opacité réduite pendant l'édition (pas dans le
 * rendu final, voir lib/pdf/theme.ts) : permet de voir à la fois ses zones
 * découpées ET les rectangles des emplacements, pour les aligner précisément.
 */
export default function ThemeForm({
  theme,
  templates,
  currentOverlayUrl,
  onSuccess,
  onBusyChange,
}: {
  theme?: ThemeWithOverlayUrl;
  templates: Template[];
  currentOverlayUrl?: string | null;
  onSuccess: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const isEditing = Boolean(theme);
  const [templateId, setTemplateId] = useState(theme?.template_id ?? templates[0]?.id ?? "");
  const [name, setName] = useState(theme?.name ?? "");
  // Calculés avant l'état `slots` (juste en dessous) : son initialisation
  // (defaultSlot) en a besoin pour un premier emplacement carré dès le
  // départ — sans template (aucun modèle disponible), 1 = carré par défaut.
  const template = templates.find((t) => t.id === templateId) ?? null;
  const pageAspectRatio = template ? (template.width_mm + template.bleed_mm * 2) / (template.height_mm + template.bleed_mm * 2) : 1;
  const [slots, setSlots] = useState<ThemeSlot[]>(() => theme?.slots ?? [defaultSlot(0, pageAspectRatio)]);
  // Zones de texte libres (voir lib/themeText.ts) : le client y écrit ce
  // qu'il veut ; la zone ouverte dans le panneau est encadrée sur l'aperçu.
  const [textZones, setTextZones] = useState<ThemeTextZone[]>(() => theme?.text_zones ?? []);
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  const [overlayFile, setOverlayFile] = useState<File | null>(null);
  const [overlayPreview, setOverlayPreview] = useState<string | null>(null);
  // Image de fond facultative (sous les photos) : un nouveau fichier, ou le
  // retrait de celle enregistrée.
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [backgroundPreview, setBackgroundPreview] = useState<string | null>(null);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracé d'un polygone au clic : l'emplacement visé (un existant, ou "new"
  // pour en ajouter un), les sommets posés (ratios de la PAGE) et la
  // position du pointeur pour le segment en cours.
  const [drawing, setDrawing] = useState<{
    target: number | "new";
    points: { x: number; y: number }[];
    hover: { x: number; y: number } | null;
  } | null>(null);

  useEffect(() => {
    onBusyChange?.(loading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function handleOverlayChange(f: File | null) {
    setOverlayFile(f);
    setOverlayPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  const overlayUrl = overlayPreview ?? currentOverlayUrl ?? null;

  function handleBackgroundChange(f: File | null) {
    setBackgroundFile(f);
    if (f) setRemoveBackground(false);
    setBackgroundPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  const currentBackgroundUrl = removeBackground ? null : (theme?.backgroundUrl ?? null);
  const backgroundUrl = backgroundPreview ?? currentBackgroundUrl;

  const previewBoxRef = useRef<HTMLDivElement>(null);
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBoxSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const dragRef = useRef<{
    index: number;
    mode: "move" | "resize" | "vertex";
    // Sommet déplacé (mode "vertex", polygone seulement).
    pointIndex?: number;
    startX: number;
    startY: number;
    startSlot: ThemeSlot;
  } | null>(null);

  function updateSlot(index: number, patch: Partial<ThemeSlot>) {
    setSlots((prev) => prev.map((s, i) => (i === index ? clampSlot({ ...s, ...patch }) : s)));
  }

  function beginDrag(e: React.PointerEvent<HTMLDivElement>, index: number, mode: "move" | "resize" | "vertex", pointIndex?: number) {
    e.stopPropagation();
    dragRef.current = { index, mode, pointIndex, startX: e.clientX, startY: e.clientY, startSlot: slots[index] };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleDragMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || boxSize.width === 0 || boxSize.height === 0) return;
    const dx = (e.clientX - d.startX) / boxSize.width;
    const dy = (e.clientY - d.startY) / boxSize.height;
    if (d.mode === "vertex") {
      // Sommet en ratios du rectangle de l'emplacement, borné à celui-ci.
      const points = d.startSlot.points ?? [];
      const start = points[d.pointIndex ?? 0];
      if (!start) return;
      const x = Math.min(1, Math.max(0, start.x + dx / d.startSlot.widthRatio));
      const y = Math.min(1, Math.max(0, start.y + dy / d.startSlot.heightRatio));
      updateSlot(d.index, { points: points.map((p, i) => (i === d.pointIndex ? { x, y } : p)) });
    } else if (d.mode === "move") {
      updateSlot(d.index, { positionX: d.startSlot.positionX + dx, positionY: d.startSlot.positionY + dy });
    } else {
      updateSlot(d.index, {
        widthRatio: d.startSlot.widthRatio + dx * 2,
        heightRatio: d.startSlot.heightRatio + dy * 2,
      });
    }
  }

  function endDrag() {
    dragRef.current = null;
  }

  // Zones de texte : même glisser que les emplacements (déplacer, poignée de
  // coin pour la taille), bornées à la page.
  const zoneDragRef = useRef<{ index: number; mode: "move" | "resize"; startX: number; startY: number; start: ThemeTextZone } | null>(null);

  function updateZone(index: number, patch: Partial<ThemeTextZone>) {
    setTextZones((prev) =>
      prev.map((z, i) => {
        if (i !== index) return z;
        const next = { ...z, ...patch };
        const widthRatio = Math.min(1, Math.max(0.02, next.widthRatio));
        const heightRatio = Math.min(1, Math.max(0.02, next.heightRatio));
        return {
          ...next,
          widthRatio,
          heightRatio,
          positionX: Math.min(1 - widthRatio / 2, Math.max(widthRatio / 2, next.positionX)),
          positionY: Math.min(1 - heightRatio / 2, Math.max(heightRatio / 2, next.positionY)),
        };
      })
    );
  }

  function beginZoneDrag(e: React.PointerEvent<HTMLDivElement>, index: number, mode: "move" | "resize") {
    e.stopPropagation();
    setSelectedZone(index);
    zoneDragRef.current = { index, mode, startX: e.clientX, startY: e.clientY, start: textZones[index] };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleZoneDragMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = zoneDragRef.current;
    if (!d || boxSize.width === 0 || boxSize.height === 0) return;
    const dx = (e.clientX - d.startX) / boxSize.width;
    const dy = (e.clientY - d.startY) / boxSize.height;
    if (d.mode === "move") updateZone(d.index, { positionX: d.start.positionX + dx, positionY: d.start.positionY + dy });
    // Coin bas-droit : le coin haut-gauche reste en place.
    else
      updateZone(d.index, {
        widthRatio: d.start.widthRatio + dx,
        heightRatio: d.start.heightRatio + dy,
        positionX: d.start.positionX + dx / 2,
        positionY: d.start.positionY + dy / 2,
      });
  }

  function endZoneDrag() {
    zoneDragRef.current = null;
  }

  function addZone() {
    setTextZones((prev) => (prev.length >= MAX_THEME_TEXT_ZONES ? prev : [...prev, newThemeTextZone(prev.length)]));
    setSelectedZone(textZones.length);
  }

  function removeZone(index: number) {
    setTextZones((prev) => prev.filter((_, i) => i !== index));
    setSelectedZone(null);
  }

  // Forme d'un emplacement. Cercle et polygone partent d'un emplacement
  // carré sur la page (largeur conservée) : un cercle, pas un ovale, tant
  // qu'on ne l'étire pas.
  // Masque SVG : choisi dans un fichier, nettoyé (voir sanitizeMaskSvg), et
  // l'emplacement prend les proportions du dessin (largeur conservée).
  const maskInput = useRef<HTMLInputElement>(null);
  const maskTarget = useRef<number | null>(null);
  async function applyMaskFile(file: File | undefined) {
    const index = maskTarget.current;
    if (!file || index === null) return;
    const maskSvg = sanitizeMaskSvg(await file.text());
    if (!maskSvg) {
      setError("Ce fichier n'est pas un SVG utilisable (il lui faut une viewBox, ou une largeur et une hauteur).");
      return;
    }
    setError(null);
    const slot = slots[index];
    updateSlot(index, {
      shape: "svg",
      maskSvg,
      points: undefined,
      heightRatio: (slot.widthRatio * pageAspectRatio) / maskSvgAspect(maskSvg),
    });
  }

  function setSlotShape(index: number, shape: ThemeSlotShape) {
    const slot = slots[index];
    if (shape === "svg") {
      maskTarget.current = index;
      maskInput.current?.click();
      return;
    }
    if (!slot || slotShape(slot) === shape) return;
    const square = { heightRatio: slot.widthRatio * pageAspectRatio };
    if (shape === "rect") updateSlot(index, { shape: undefined, points: undefined, maskSvg: undefined });
    else if (shape === "ellipse") updateSlot(index, { ...square, shape: "ellipse", points: undefined, maskSvg: undefined });
    else updateSlot(index, { ...square, shape: "polygon", points: regularPolygon(DEFAULT_POLYGON_SIDES), maskSvg: undefined });
  }

  function setPolygonSides(index: number, sides: number) {
    if (!Number.isFinite(sides)) return;
    updateSlot(index, { shape: "polygon", points: regularPolygon(sides) });
  }

  function startDrawing(target: number | "new") {
    setError(null);
    setDrawing({ target, points: [], hover: null });
  }

  // Ferme le tracé : l'emplacement prend le rectangle englobant des sommets,
  // et les sommets y sont ramenés en ratios de ce rectangle (voir
  // ThemeSlot.points).
  function finishDrawing(points: { x: number; y: number }[]) {
    const target = drawing?.target;
    setDrawing(null);
    if (target === undefined || points.length < MIN_POLYGON_SIDES) return;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(Math.max(...xs) - minX, 0.01);
    const height = Math.max(Math.max(...ys) - minY, 0.01);
    const slot = clampSlot({
      positionX: minX + width / 2,
      positionY: minY + height / 2,
      widthRatio: width,
      heightRatio: height,
      shape: "polygon",
      points: points.map((p) => ({
        x: Math.round(((p.x - minX) / width) * 10000) / 10000,
        y: Math.round(((p.y - minY) / height) * 10000) / 10000,
      })),
    });
    setSlots((prev) =>
      target === "new"
        ? prev.length >= MAX_THEME_SLOTS
          ? prev
          : [...prev, slot]
        : prev.map((s, i) => (i === target ? slot : s)),
    );
  }

  function pagePoint(e: React.PointerEvent | React.MouseEvent): { x: number; y: number } | null {
    const rect = previewBoxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function handleDrawClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!drawing) return;
    const point = pagePoint(e);
    if (!point) return;
    // Double-clic : ferme le polygone (le premier clic a déjà posé le sommet).
    if (e.detail >= 2) {
      finishDrawing(drawing.points);
      return;
    }
    // Clic sur le premier sommet (à 10 px près) : ferme le polygone.
    const first = drawing.points[0];
    if (first && drawing.points.length >= MIN_POLYGON_SIDES) {
      const dx = (point.x - first.x) * boxSize.width;
      const dy = (point.y - first.y) * boxSize.height;
      if (Math.hypot(dx, dy) <= 10) {
        finishDrawing(drawing.points);
        return;
      }
    }
    if (drawing.points.length >= MAX_POINTS) return;
    setDrawing({ ...drawing, points: [...drawing.points, point] });
  }

  useEffect(() => {
    if (!drawing) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawing(null);
      // Pendant la saisie d'un champ (nom du thème…), Entrée et Retour
      // arrière gardent leur rôle habituel.
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Enter") {
        e.preventDefault();
        finishDrawing(drawing!.points);
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        setDrawing((d) => (d ? { ...d, points: d.points.slice(0, -1) } : d));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing]);

  function addSlot() {
    setSlots((prev) => (prev.length >= MAX_THEME_SLOTS ? prev : [...prev, defaultSlot(prev.length, pageAspectRatio)]));
  }

  function removeSlot(index: number) {
    setSlots((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  // Copie l'emplacement `index` tel quel (même position/taille) — pratique
  // pour partir d'un réglage déjà bon plutôt que de repositionner un
  // nouvel emplacement à partir de zéro (voir defaultSlot). Légèrement
  // décalée pour rester visible/attrapable par-dessus l'original — sans ce
  // décalage, le duplicata serait invisible (pile sur l'original) tant
  // qu'on ne le glisse pas.
  function duplicateSlot(index: number) {
    setSlots((prev) => {
      if (prev.length >= MAX_THEME_SLOTS) return prev;
      const source = prev[index];
      const offset = 0.04;
      return [...prev, clampSlot({ ...source, positionX: source.positionX + offset, positionY: source.positionY + offset })];
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId) {
      setError("Choisis un modèle.");
      return;
    }
    if (!isEditing && !overlayFile) {
      setError("Choisis un graphisme.");
      return;
    }
    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("templateId", templateId);
    formData.append("name", name);
    formData.append("slots", JSON.stringify(slots));
    formData.append("textZones", JSON.stringify(textZones));
    if (overlayFile) formData.append("overlay", overlayFile);
    if (backgroundFile) formData.append("background", backgroundFile);
    else if (removeBackground) formData.append("removeBackground", "true");

    const res = await fetch(isEditing ? `/api/themes/${theme!.id}` : "/api/themes", {
      method: isEditing ? "PATCH" : "POST",
      body: formData,
    });
    const data = await res.json();

    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Erreur lors de l'enregistrement.");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium">Nom du thème</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex. Cadre Noël"
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Modèle</label>
          <select
            required
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {templateOptionLabel(t)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">
            Graphisme (PNG avec transparence){currentOverlayUrl ? " — laisser vide pour garder l'actuel" : ""}
          </label>
          <div className="mt-1">
            <FileDropZone
              file={overlayFile}
              onFileChange={handleOverlayChange}
              accept="image/png,image/svg+xml"
              previewUrl={overlayPreview ?? currentOverlayUrl ?? null}
            />
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Zones transparentes = là où les photos du client apparaîtront ; le reste (cadre, décor) reste
            visible par-dessus.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium">
            Image de fond (facultative){currentBackgroundUrl ? " — laisser vide pour garder l'actuelle" : ""}
          </label>
          <div className="mt-1">
            <FileDropZone
              file={backgroundFile}
              onFileChange={handleBackgroundChange}
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              previewUrl={backgroundUrl}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-500">
              Posée sous les photos, étirée à la page : visible là où il n&apos;y a pas de photo.
            </p>
            {currentBackgroundUrl && !backgroundFile && (
              <button
                type="button"
                onClick={() => setRemoveBackground(true)}
                className="shrink-0 text-xs text-red-600 hover:underline"
              >
                Retirer le fond
              </button>
            )}
            {removeBackground && !backgroundFile && (
              <button
                type="button"
                onClick={() => setRemoveBackground(false)}
                className="shrink-0 text-xs text-neutral-600 hover:underline"
              >
                Annuler le retrait
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label className="block text-sm font-medium">
              Emplacements photo ({slots.length})
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => startDrawing("new")}
                disabled={slots.length >= MAX_THEME_SLOTS || !template || Boolean(drawing)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
              >
                ✎ Tracer un emplacement
              </button>
              <button
                type="button"
                onClick={addSlot}
                disabled={slots.length >= MAX_THEME_SLOTS || Boolean(drawing)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
              >
                + Ajouter un emplacement
              </button>
            </div>
          </div>
          {template && (
            <div className="mt-3 space-y-2">
              {slots.map((slot, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="w-16 font-medium text-neutral-700">Photo {i + 1}</span>
                  <div className="flex overflow-hidden rounded-lg border border-neutral-300">
                    {SHAPE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setSlotShape(i, option.value)}
                        aria-pressed={slotShape(slot) === option.value}
                        className={`px-2.5 py-1 ${
                          slotShape(slot) === option.value
                            ? "bg-blue-600 text-white"
                            : "bg-white text-neutral-700 hover:bg-neutral-50"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => startDrawing(i)}
                    disabled={Boolean(drawing)}
                    className="rounded-lg border border-neutral-300 px-2.5 py-1 text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
                  >
                    ✎ Tracer
                  </button>
                  {slotShape(slot) === "svg" && (
                    <button
                      type="button"
                      onClick={() => {
                        maskTarget.current = i;
                        maskInput.current?.click();
                      }}
                      className="rounded-lg border border-neutral-300 px-2.5 py-1 text-neutral-700 hover:bg-neutral-50"
                    >
                      Remplacer le SVG
                    </button>
                  )}
                  {slotShape(slot) === "polygon" && (
                    <label className="flex items-center gap-1.5 text-neutral-600">
                      Côtés
                      <input
                        type="number"
                        min={MIN_POLYGON_SIDES}
                        max={MAX_POLYGON_SIDES}
                        value={slot.points!.length}
                        onChange={(e) => setPolygonSides(i, parseInt(e.target.value, 10))}
                        className="w-14 rounded border border-neutral-300 px-2 py-1"
                      />
                      <span className="text-neutral-400">(remet une forme régulière)</span>
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label className="block text-sm font-medium">Zones de texte ({textZones.length})</label>
            <button
              type="button"
              onClick={addZone}
              disabled={textZones.length >= MAX_THEME_TEXT_ZONES || !template}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
            >
              + Ajouter une zone de texte
            </button>
          </div>
          {textZones.length === 0 && (
            <p className="text-xs text-neutral-500">Le client pourra écrire son propre texte (nom, date, message…) dans chaque zone.</p>
          )}
          <div className="space-y-2">
            {textZones.map((zone, i) => {
              const open = selectedZone === i;
              return (
                <div key={zone.id} className={`rounded-lg border text-xs ${open ? "border-emerald-500" : "border-neutral-200"}`}>
                  <button
                    type="button"
                    onClick={() => setSelectedZone(open ? null : i)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  >
                    <span className="font-medium text-neutral-800">{zone.label}</span>
                    <span className="truncate text-neutral-500">{zone.defaultText || "(vide)"}</span>
                  </button>
                  {open && (
                    <div className="space-y-2 border-t border-neutral-200 p-3">
                      <label className="block">
                        <span className="text-neutral-600">Question au client</span>
                        <input
                          value={zone.label}
                          onChange={(e) => updateZone(i, { label: e.target.value })}
                          placeholder="Ex. : Nom de l'élève"
                          className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
                        />
                      </label>
                      <label className="block">
                        <span className="text-neutral-600">Texte de départ</span>
                        {zone.multiline ? (
                          <textarea
                            value={zone.defaultText}
                            onChange={(e) => updateZone(i, { defaultText: e.target.value })}
                            rows={2}
                            className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
                          />
                        ) : (
                          <input
                            value={zone.defaultText}
                            onChange={(e) => updateZone(i, { defaultText: e.target.value })}
                            className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
                          />
                        )}
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-neutral-600">Police</span>
                          <select
                            value={zone.fontId}
                            onChange={(e) => updateZone(i, { fontId: e.target.value })}
                            className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
                          >
                            <FontSelectOptions />
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-neutral-600">Taille max. (mm)</span>
                          <input
                            type="number"
                            step="any"
                            min={1}
                            value={zone.fontSizeMm}
                            onChange={(e) => updateZone(i, { fontSizeMm: Math.max(1, Number(e.target.value) || 1) })}
                            className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="color"
                          value={zone.color}
                          onChange={(e) => updateZone(i, { color: e.target.value })}
                          className="h-7 w-10 cursor-pointer rounded border border-neutral-300"
                          aria-label="Couleur"
                        />
                        <div className="flex overflow-hidden rounded-lg border border-neutral-300">
                          {THEME_TEXT_ALIGNS.map((a) => (
                            <button
                              key={a.value}
                              type="button"
                              onClick={() => updateZone(i, { align: a.value })}
                              className={`px-2 py-1 ${zone.align === a.value ? "bg-emerald-600 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50"}`}
                            >
                              {a.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-neutral-700">
                        {(
                          [
                            ["bold", "Gras"],
                            ["italic", "Italique"],
                            ["uppercase", "Majuscules"],
                            ["multiline", "Plusieurs lignes"],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key} className="flex items-center gap-1">
                            <input type="checkbox" checked={zone[key]} onChange={(e) => updateZone(i, { [key]: e.target.checked })} />
                            {label}
                          </label>
                        ))}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-1.5 text-neutral-600">
                          Caractères max.
                          <input
                            type="number"
                            min={0}
                            value={zone.maxChars}
                            onChange={(e) => updateZone(i, { maxChars: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                            className="w-16 rounded border border-neutral-300 px-2 py-1"
                          />
                          <span className="text-neutral-400">(0 = sans limite)</span>
                        </label>
                        <button type="button" onClick={() => removeZone(i)} className="text-red-600 hover:underline">
                          Retirer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {textZones.length > 0 && (
            <p className="mt-2 text-xs text-neutral-500">
              La taille est un maximum : un texte trop long rapetisse pour tenir dans sa zone.
            </p>
          )}
        </div>

        <input
        ref={maskInput}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          applyMaskFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-pico-maroon px-4 py-2 text-sm font-medium text-white hover:bg-pico-maroon-dark disabled:opacity-60"
          >
            {loading && <SpinnerIcon className="h-4 w-4" />}
            {isEditing ? "Enregistrer" : "Créer le thème"}
          </button>
        </div>
      </div>

      {/* Aperçu de travail : toute la place restante, à la hauteur de l'écran. */}
      <div className="lg:sticky lg:top-0 lg:self-start">
        {drawing && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <span>
              Clique sur l&apos;aperçu pour poser chaque sommet ({drawing.points.length} posé
              {drawing.points.length > 1 ? "s" : ""}). Pour fermer : clique sur le premier point, double-clique ou
              Entrée. Retour arrière : enlever le dernier. Échap : annuler.
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => finishDrawing(drawing.points)}
                disabled={drawing.points.length < MIN_POLYGON_SIDES}
                className="rounded-md bg-blue-600 px-2.5 py-1 font-medium text-white disabled:opacity-40"
              >
                Terminer
              </button>
              <button
                type="button"
                onClick={() => setDrawing(null)}
                className="rounded-md border border-blue-200 bg-white px-2.5 py-1"
              >
                Annuler
              </button>
            </span>
          </div>
        )}
        {!template ? (
          <p className="text-xs text-neutral-500">Choisis un modèle pour placer les emplacements.</p>
        ) : (
          <div
            ref={previewBoxRef}
            className="relative mx-auto touch-none select-none overflow-hidden rounded-lg border border-neutral-200 bg-[repeating-conic-gradient(#e5e5e5_0%_25%,#ffffff_0%_50%)] bg-[length:16px_16px]"
            style={{
              aspectRatio: String(pageAspectRatio),
              // Aussi grand que possible sans dépasser la hauteur de la fenêtre.
              width: `min(100%, calc((96vh - 10rem) * ${pageAspectRatio}))`,
            }}
          >
            {backgroundUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={backgroundUrl}
                alt=""
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full object-fill"
              />
            )}
            {/* Graphisme SOUS les emplacements, ici seulement : on voit et on attrape
                les cases pendant le travail. Le rendu, lui, pose toujours le
                graphisme par-dessus les photos (voir lib/pdf/theme.ts). */}
            {overlayUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={overlayUrl}
                alt=""
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full object-fill"
              />
            )}
            {slots.map((slot, i) => (
              <div
                key={i}
                onPointerDown={(e) => beginDrag(e, i, "move")}
                onPointerMove={handleDragMove}
                onPointerUp={endDrag}
                onPointerLeave={endDrag}
                className={`absolute flex cursor-move items-center justify-center text-xs font-medium text-blue-700 ${
                  slotShape(slot) === "rect" ? "border-2 border-dashed border-blue-500 bg-blue-500/20" : ""
                }`}
                style={{
                  left: `${(slot.positionX - slot.widthRatio / 2) * 100}%`,
                  top: `${(slot.positionY - slot.heightRatio / 2) * 100}%`,
                  width: `${slot.widthRatio * 100}%`,
                  height: `${slot.heightRatio * 100}%`,
                }}
              >
                {/* Cercle ou polygone : la forme remplie (là où ira la photo)
                    et son contour ; le rectangle pointillé fin rappelle la
                    zone qu'on glisse et redimensionne. */}
                {slotShape(slot) !== "rect" && (
                  <>
                    <div className="absolute inset-0 border border-dashed border-blue-400/60" />
                    <div className="absolute inset-0 bg-blue-500/25" style={{ clipPath: slotClipPath(slot), ...slotMaskStyle(slot) }} />
                    {slotShape(slot) !== "svg" && <SlotOutline slot={slot} />}
                  </>
                )}
                <span className="relative">Photo {i + 1}</span>
              </div>
            ))}
            {/* Boutons (dupliquer/retirer) et poignée de redimensionnement de
                chaque emplacement : une passe SÉPARÉE, rendue après (donc
                au-dessus de) TOUS les emplacements ci-dessus — sinon un
                emplacement ajouté plus tard (peint par-dessus dans l'ordre
                naturel du DOM) peut recouvrir les contrôles d'un emplacement
                antérieur qu'il chevauche, les rendant incliquables (vécu :
                dupliquer/supprimer ne répondaient plus une fois deux
                emplacements superposés, comme juste après une duplication).
                `pointer-events-none` sur le conteneur (sauf les contrôles
                eux-mêmes, `pointer-events-auto`) : sinon CE conteneur-ci
                bloquerait à son tour le glisser des emplacements en dessous
                sur toute sa zone, pas seulement ses boutons. */}
            {slots.map((slot, i) => (
              <div
                key={`controls-${i}`}
                className="pointer-events-none absolute"
                style={{
                  left: `${(slot.positionX - slot.widthRatio / 2) * 100}%`,
                  top: `${(slot.positionY - slot.heightRatio / 2) * 100}%`,
                  width: `${slot.widthRatio * 100}%`,
                  height: `${slot.heightRatio * 100}%`,
                }}
              >
                <div className="pointer-events-auto absolute right-1 top-1 flex gap-1">
                  {slots.length < MAX_THEME_SLOTS && (
                    <button
                      type="button"
                      // `onPointerDown` doit aussi être arrêté ici, pas
                      // seulement `onClick` : l'emplacement (dessous) écoute
                      // `onPointerDown` pour démarrer le glisser (beginDrag),
                      // qui se déclenche AVANT le `click` (pointerdown →
                      // pointerup → click) — sans ce stopPropagation, cliquer
                      // ce bouton démarrerait quand même un glisser, qui
                      // capture le pointeur et empêche le clic d'aboutir.
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicateSlot(i);
                      }}
                      title="Dupliquer cet emplacement"
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-neutral-600 hover:bg-white"
                    >
                      <CopyIcon className="h-3 w-3" />
                    </button>
                  )}
                  {slots.length > 1 && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSlot(i);
                      }}
                      title="Retirer cet emplacement"
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-[10px] text-neutral-600 hover:bg-white"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {slotShape(slot) === "polygon" &&
                  slot.points!.map((p, pi) => (
                    <div
                      key={pi}
                      onPointerDown={(e) => beginDrag(e, i, "vertex", pi)}
                      onPointerMove={handleDragMove}
                      onPointerUp={endDrag}
                      title="Glisser pour déplacer ce sommet"
                      className="pointer-events-auto absolute h-3 w-3 cursor-crosshair rounded-full border-2 border-white bg-blue-600 shadow"
                      style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(-50%, -50%)" }}
                    />
                  ))}
                <div
                  onPointerDown={(e) => beginDrag(e, i, "resize")}
                  onPointerMove={handleDragMove}
                  onPointerUp={endDrag}
                  className="pointer-events-auto absolute bottom-0 right-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-sm border border-white bg-blue-600"
                  style={{ right: 0, bottom: 0, transform: "translate(50%, 50%)" }}
                />
              </div>
            ))}
            {/* Zones de texte : le texte de départ tel qu'il sera rendu, et un
                cadre vert à glisser (poignée de coin pour la taille). */}
            {template && (
              <ThemeTextOverlay
                zones={textZones}
                pageWidthMm={template.width_mm + template.bleed_mm * 2}
                boxWidth={boxSize.width}
                boxHeight={boxSize.height}
              />
            )}
            {textZones.map((zone, i) => (
              <div
                key={zone.id}
                onPointerDown={(e) => beginZoneDrag(e, i, "move")}
                onPointerMove={handleZoneDragMove}
                onPointerUp={endZoneDrag}
                className={`absolute cursor-move border-2 border-dashed ${
                  selectedZone === i ? "border-emerald-600 bg-emerald-500/10" : "border-emerald-500/70"
                }`}
                style={{
                  left: `${(zone.positionX - zone.widthRatio / 2) * 100}%`,
                  top: `${(zone.positionY - zone.heightRatio / 2) * 100}%`,
                  width: `${zone.widthRatio * 100}%`,
                  height: `${zone.heightRatio * 100}%`,
                }}
              >
                <span className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded bg-emerald-600 px-1.5 text-[10px] font-medium text-white">
                  {zone.label}
                </span>
                <div
                  onPointerDown={(e) => beginZoneDrag(e, i, "resize")}
                  onPointerMove={handleZoneDragMove}
                  onPointerUp={endZoneDrag}
                  className="absolute h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-emerald-600"
                  style={{ right: 0, bottom: 0, transform: "translate(50%, 50%)" }}
                />
              </div>
            ))}
            {/* Tracé en cours : une couche au-dessus de tout, qui reçoit les
                clics (les emplacements dessous ne bougent pas pendant ce
                temps). */}
            {drawing && (
              <div
                className="absolute inset-0 z-10 cursor-crosshair"
                onClick={handleDrawClick}
                onPointerMove={(e) => {
                  const hover = pagePoint(e);
                  setDrawing((d) => (d ? { ...d, hover } : d));
                }}
                onPointerLeave={() => setDrawing((d) => (d ? { ...d, hover: null } : d))}
              >
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {drawing.points.length >= 2 && (
                    <polygon
                      points={polygonPointsAttr(drawing.points, 100, 100)}
                      fill="rgb(59 130 246 / 0.2)"
                      stroke="none"
                    />
                  )}
                  <polyline
                    points={polygonPointsAttr(
                      drawing.hover ? [...drawing.points, drawing.hover] : drawing.points,
                      100,
                      100,
                    )}
                    fill="none"
                    stroke="rgb(37 99 235)"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                {drawing.points.map((p, pi) => (
                  <span
                    key={pi}
                    className={`pointer-events-none absolute rounded-full border-2 border-white shadow ${
                      pi === 0 && drawing.points.length >= MIN_POLYGON_SIDES ? "h-4 w-4 bg-green-600" : "h-3 w-3 bg-blue-600"
                    }`}
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(-50%, -50%)" }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          Glisse chaque case pour la positionner, la poignée du coin pour la redimensionner. Pour un polygone,
          glisse ses sommets (points ronds), ou trace-le directement avec « Tracer ».
        </p>
      </div>
    </form>
  );
}

// Contour d'un emplacement en cercle ou en polygone, à la taille de son
// rectangle (viewBox 0-100, étiré : la forme suit l'emplacement).
function SlotOutline({ slot }: { slot: ThemeSlot }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      fill="none"
      stroke="rgb(59 130 246)"
      strokeWidth={2}
      strokeDasharray="5 4"
      vectorEffect="non-scaling-stroke"
    >
      {slotShape(slot) === "polygon" ? (
        <polygon points={polygonPointsAttr(slot.points!, 100, 100)} vectorEffect="non-scaling-stroke" />
      ) : (
        <ellipse cx={50} cy={50} rx={50} ry={50} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
