"use client";

import { useEffect, useRef, useState } from "react";
import type { Template, ThemePart, ThemeScope, ThemeSlot, ThemeSlotShape, ThemeTextZone } from "@/lib/types";
import { themePartChoices, themeParts } from "@/lib/themeParts";
import ThemeTextOverlay from "@/components/ThemeTextOverlay";
import { MAX_THEME_TEXT_ZONES, THEME_TEXT_ALIGNS, THEME_TEXT_VERTICAL_ALIGNS, newThemeTextZone } from "@/lib/themeText";
import type { ThemeWithOverlayUrl } from "@/components/ThemesTable";
import { CopyIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { snapAxis, type UserGuide } from "@/lib/variableData/snap";
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
  normalizeRotation,
  slotShape,
} from "@/lib/themeShapes";
import { templateOptionLabel } from "@/lib/templateLabel";
import FontPicker from "@/components/FontPicker";
import ColorPickerButton from "@/components/ColorPickerButton";
import { FontSizeInput, FontUnitToggle, LengthInput, LengthUnitToggle, formatLength, unitLabel, useLengthUnit } from "@/components/UnitInputs";
import { allowsPanels, foldLines, panelThemeFormat, panelThemePlacement, parseFold, parsePanelKey } from "@/lib/folds";
import { checkThemeFile, fillToCover, themePagePx, type ThemePage } from "@/lib/themeFit";
import { formatInMm, formatSizeInMm } from "@/lib/pdf/units";

const MIN_RATIO = 0.05;
// Distance (px à l'écran) sous laquelle un cadre s'aimante à un repère.
const SNAP_PX = 6;

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
// Une partie du thème en cours d'édition (voir lib/themeParts.ts) : ce qui
// est enregistré, plus les fichiers choisis et les retraits pas encore envoyés.
interface PartDraft {
  slots: ThemeSlot[];
  textZones: ThemeTextZone[];
  guides: UserGuide[];
  overlayFile: File | null;
  overlayPreview: string | null;
  backgroundFile: File | null;
  backgroundPreview: string | null;
  removeBackground: boolean;
  // Thème d'avant à l'image étirée, corrigé sans nouveau fichier (voir fixStretch).
  fixedStretch: boolean;
  // Partie retirée du thème (enregistrée avant, à supprimer).
  removed: boolean;
}

const EMPTY_DRAFT: PartDraft = {
  slots: [],
  textZones: [],
  guides: [],
  overlayFile: null,
  overlayPreview: null,
  backgroundFile: null,
  backgroundPreview: null,
  removeBackground: false,
  fixedStretch: false,
  removed: false,
};

function draftFromPart(p: ThemePart): PartDraft {
  return { ...EMPTY_DRAFT, slots: p.slots, textZones: p.text_zones ?? [], guides: p.guides ?? [] };
}

export default function ThemeForm({
  theme,
  templates,
  currentOverlayUrl: currentOverlayUrlProp,
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
  const [lengthUnit] = useLengthUnit();
  const [templateId, setTemplateId] = useState(theme?.template_id ?? templates[0]?.id ?? "");
  const [name, setName] = useState(theme?.name ?? "");
  const baseTemplate = templates.find((t) => t.id === templateId) ?? null;
  // Par planche ou par volet (voir la migration 0086) : par volet seulement
  // pour un modèle plié qui se compose par volet.
  const [scope, setScope] = useState<ThemeScope>(theme?.scope ?? "sheet");
  const panelFold = baseTemplate && allowsPanels(parseFold(baseTemplate.fold)) ? parseFold(baseTemplate.fold) : null;
  const effectiveScope: ThemeScope = panelFold ? scope : "sheet";

  // Parties du thème (voir lib/themeParts.ts) : recto et/ou verso par planche,
  // ou n'importe quels volets par volet. Chacune a son graphisme, son fond, ses
  // emplacements, ses textes et ses repères ; l'onglet ouvert est la partie
  // éditée, et tout l'éditeur ci-dessous travaille sur elle.
  const savedParts = theme ? themeParts(theme) : [];
  const partChoices = baseTemplate ? themePartChoices(baseTemplate, effectiveScope) : [{ key: "front", label: "Recto" }];
  const [drafts, setDrafts] = useState<Record<string, PartDraft>>(() =>
    Object.fromEntries(savedParts.map((p) => [p.key, draftFromPart(p)]))
  );
  const [activeKeyState, setActiveKey] = useState(() => savedParts[0]?.key ?? "front");
  const activeKey = partChoices.some((c) => c.key === activeKeyState) ? activeKeyState : partChoices[0].key;
  const activeLabel = partChoices.find((c) => c.key === activeKey)?.label ?? "";
  const savedPart = savedParts.find((p) => p.key === activeKey) ?? null;
  const draft = drafts[activeKey] ?? EMPTY_DRAFT;
  function draftSetter<K extends keyof PartDraft>(k: K) {
    return (u: React.SetStateAction<PartDraft[K]>) =>
      setDrafts((all) => {
        const d = all[activeKey] ?? EMPTY_DRAFT;
        const v = typeof u === "function" ? (u as (prev: PartDraft[K]) => PartDraft[K])(d[k]) : u;
        return { ...all, [activeKey]: { ...d, [k]: v } };
      });
  }
  // Une partie fait partie du thème si elle a un graphisme (nouveau ou enregistré).
  const partIncluded = (key: string) => {
    const d = drafts[key];
    return !d?.removed && Boolean(d?.overlayFile || savedParts.some((p) => p.key === key));
  };

  const panelAt = effectiveScope === "panel" ? parsePanelKey(activeKey) : null;
  // Format de la partie : la page entière, ou le volet (fond perdu des 4 côtés).
  const panelFormat = panelFold && baseTemplate && panelAt ? panelThemeFormat(baseTemplate, activeKey) : null;
  const template: Template | null =
    panelFormat ? { ...panelFormat, fold_marks_vertical_mm: [], fold_marks_horizontal_mm: [] } : baseTemplate;
  // Volet : côtés qui tombent sur un pli, où le fond perdu est retiré au rendu.
  const placement = panelAt && baseTemplate ? panelThemePlacement(baseTemplate, panelAt.side, panelAt.index) : null;
  const panelFoldSafety =
    panelFold && placement
      ? { direction: panelFold.direction, safetyMm: panelFold.safetyMm, start: placement.cutStart, end: placement.cutEnd, label: activeLabel }
      : null;
  const pageAspectRatio = template ? (template.width_mm + template.bleed_mm * 2) / (template.height_mm + template.bleed_mm * 2) : 1;
  const slots = draft.slots;
  const setSlots = draftSetter("slots");
  // Page du modèle en mm, fond perdu compris : les repères s'y mesurent.
  const pageW = template ? template.width_mm + template.bleed_mm * 2 : 1;
  const pageH = template ? template.height_mm + template.bleed_mm * 2 : 1;
  // Repères (voir lib/variableData/snap.ts) : lignes posées par l'utilisateur,
  // en mm ; avec le magnétisme, les cadres s'y collent, comme à la coupe, à
  // la marge de sécurité, aux plis, au centre et aux autres cadres.
  const userGuides = draft.guides;
  const setUserGuides = draftSetter("guides");
  const [snapOn, setSnapOn] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  // Ligne où un cadre s'aimante pendant le glisser (ratios de la page).
  const [snapLines, setSnapLines] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });
  const guideDragRef = useRef<string | null>(null);
  // Zones de texte libres (voir lib/themeText.ts) : le client y écrit ce
  // qu'il veut ; la zone ouverte dans le panneau est encadrée sur l'aperçu.
  const textZones = draft.textZones;
  const setTextZones = draftSetter("textZones");
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  const overlayFile = draft.overlayFile;
  const setOverlayFile = draftSetter("overlayFile");
  const overlayPreview = draft.overlayPreview;
  const setOverlayPreview = draftSetter("overlayPreview");
  // Image de fond facultative (sous les photos) : un nouveau fichier, ou le
  // retrait de celle enregistrée.
  const backgroundFile = draft.backgroundFile;
  const setBackgroundFile = draftSetter("backgroundFile");
  const backgroundPreview = draft.backgroundPreview;
  const setBackgroundPreview = draftSetter("backgroundPreview");
  const removeBackground = draft.removeBackground;
  const setRemoveBackground = draftSetter("removeBackground");
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

  // Fichiers enregistrés de la partie ouverte.
  const currentOverlayUrl =
    theme?.partUrls?.[activeKey]?.overlayUrl ?? (savedPart && savedPart.key === savedParts[0]?.key ? currentOverlayUrlProp ?? null : null);
  const overlayUrl = overlayPreview ?? currentOverlayUrl ?? null;

  // Thème d'avant au graphisme étiré : passe au recadrage sans déformation en
  // gardant le fichier, et recale emplacements, zones de texte et repères sur
  // les mêmes parties du graphisme. Rien n'est enregistré avant « Enregistrer ».
  function fixStretch(fileW: number, fileH: number) {
    if (!template) return;
    const m = fillToCover(fileW, fileH, template);
    setSlots((list) => list.map((f) => m.frame(f)));
    setTextZones((list) => list.map((f) => m.frame(f)));
    setUserGuides((list) => list.map((g) => ({ ...g, pos: m.guide(g.axis, g.pos) })));
    setFixedStretch(true);
  }
  // Cadrage du graphisme et du fond (voir 0085_theme_fit.sql) : un nouveau
  // thème ou un nouveau graphisme est recadré sans déformation ; un thème
  // d'avant reste étiré tant que son graphisme n'est pas remplacé.
  const fixedStretch = draft.fixedStretch;
  const setFixedStretch = draftSetter("fixedStretch");
  const fit = !savedPart || overlayFile || fixedStretch ? "cover" : (savedPart.overlay_fit ?? "fill");
  const fitClass = fit === "cover" ? "object-cover" : "object-fill";
  // Au verso, les plis d'un pli roulé tombent ailleurs (volets inversés).
  const folds = template ? foldLines(template, activeKey === "back" ? "back" : "front") : null;

  function handleBackgroundChange(f: File | null) {
    setBackgroundFile(f);
    if (f) setRemoveBackground(false);
    setBackgroundPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  const currentBackgroundUrl = removeBackground
    ? null
    : (theme?.partUrls?.[activeKey]?.backgroundUrl ?? (savedPart && savedPart.key === savedParts[0]?.key ? theme?.backgroundUrl ?? null : null));
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
    mode: "move" | "resize" | "vertex" | "rotate";
    // Sommet déplacé (mode "vertex", polygone seulement).
    pointIndex?: number;
    startX: number;
    startY: number;
    startSlot: ThemeSlot;
  } | null>(null);

  // Mouvement du pointeur (px) ramené dans le repère d'un cadre tourné de
  // `rotationDeg`, en fractions de la page.
  function localDelta(dxPx: number, dyPx: number, rotationDeg: number): [number, number] {
    const a = (rotationDeg * Math.PI) / 180;
    const lx = dxPx * Math.cos(a) + dyPx * Math.sin(a);
    const ly = -dxPx * Math.sin(a) + dyPx * Math.cos(a);
    return [lx / boxSize.width, ly / boxSize.height];
  }

  // Angle (degrés) du pointeur autour du centre d'un cadre, poignée en haut =
  // 0°. Au degré près ; par 15° avec Maj ; aimanté à 0, ±90 et 180.
  function pointerAngle(e: React.PointerEvent, centerX: number, centerY: number): number | null {
    const rect = previewBoxRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const cx = rect.left + centerX * rect.width;
    const cy = rect.top + centerY * rect.height;
    let angle = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
    angle = ((((angle + 180) % 360) + 360) % 360) - 180;
    if (e.shiftKey) return Math.round(angle / 15) * 15;
    for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(angle - snap) < 3) return snap === -180 ? 180 : snap;
    return Math.round(angle);
  }

  // Lignes où un cadre peut s'aimanter, en ratios de la page : bords et
  // centre, coupe, marge de sécurité, plis, repères, et les bords et centres
  // des autres cadres non tournés.
  function snapTargets(except: { slot?: number; zone?: number }): { v: number[]; h: number[] } {
    const v = [0, 0.5, 1, ...userGuides.filter((g) => g.axis === "v").map((g) => g.pos / pageW)];
    const h = [0, 0.5, 1, ...userGuides.filter((g) => g.axis === "h").map((g) => g.pos / pageH)];
    if (template) {
      const b = template.bleed_mm;
      v.push(b / pageW, 1 - b / pageW, (b + template.safety_margin_x_mm) / pageW, 1 - (b + template.safety_margin_x_mm) / pageW);
      h.push(b / pageH, 1 - b / pageH, (b + template.safety_margin_y_mm) / pageH, 1 - (b + template.safety_margin_y_mm) / pageH);
      for (const f of template.fold_marks_vertical_mm ?? []) v.push((b + f) / pageW);
      for (const f of template.fold_marks_horizontal_mm ?? []) h.push((b + f) / pageH);
      if (panelFoldSafety) {
        // Bords du volet qui peuvent tomber sur un pli, et leur zone de sécurité.
        const sm = panelFoldSafety.safetyMm;
        const axis = panelFoldSafety.direction === "vertical" ? v : h;
        const len = panelFoldSafety.direction === "vertical" ? pageW : pageH;
        if (panelFoldSafety.start) axis.push((b + sm) / len);
        if (panelFoldSafety.end) axis.push(1 - (b + sm) / len);
      }
      for (const f of folds?.positionsMm ?? []) {
        // Le pli et le bord de sa zone de sécurité, de chaque côté.
        const at = [f - folds!.safetyMm, f, f + folds!.safetyMm];
        if (folds!.direction === "vertical") v.push(...at.map((x) => (b + x) / pageW));
        else h.push(...at.map((y) => (b + y) / pageH));
      }
    }
    const frames = [
      ...slots.filter((_, i) => i !== except.slot),
      ...textZones.filter((_, i) => i !== except.zone),
    ].filter((f) => !f.rotationDeg);
    for (const f of frames) {
      v.push(f.positionX - f.widthRatio / 2, f.positionX, f.positionX + f.widthRatio / 2);
      h.push(f.positionY - f.heightRatio / 2, f.positionY, f.positionY + f.heightRatio / 2);
    }
    return { v, h };
  }

  // Centre d'un cadre qu'on déplace, collé à la ligne la plus proche (bords
  // et centre pour un cadre droit, le centre seul s'il est tourné).
  function snapCenter(
    frame: { positionX: number; positionY: number; widthRatio: number; heightRatio: number; rotationDeg?: number },
    except: { slot?: number; zone?: number },
    noSnap: boolean
  ): { positionX: number; positionY: number } {
    const { positionX: x, positionY: y } = frame;
    if (!snapOn || noSnap || boxSize.width === 0) {
      setSnapLines({ v: null, h: null });
      return { positionX: x, positionY: y };
    }
    const t = snapTargets(except);
    const halfW = frame.rotationDeg ? 0 : frame.widthRatio / 2;
    const halfH = frame.rotationDeg ? 0 : frame.heightRatio / 2;
    const sx = snapAxis([x - halfW, x, x + halfW], t.v, SNAP_PX / boxSize.width);
    const sy = snapAxis([y - halfH, y, y + halfH], t.h, SNAP_PX / boxSize.height);
    setSnapLines({ v: sx?.line ?? null, h: sy?.line ?? null });
    return { positionX: x + (sx?.delta ?? 0), positionY: y + (sy?.delta ?? 0) };
  }

  const roundMm = (v: number) => Math.round(v * 10) / 10;
  function addGuide(axis: "v" | "h") {
    const guide: UserGuide = { id: `guide-${Date.now().toString(36)}`, axis, pos: roundMm(axis === "v" ? pageW / 2 : pageH / 2) };
    setUserGuides((all) => [...all, guide]);
  }
  function updateGuide(id: string, pos: number) {
    setUserGuides((all) =>
      all.map((g) => (g.id === id ? { ...g, pos: roundMm(Math.min(g.axis === "v" ? pageW : pageH, Math.max(0, pos))) } : g))
    );
  }
  function removeGuide(id: string) {
    setUserGuides((all) => all.filter((g) => g.id !== id));
  }
  // Glisser un repère sur l'aperçu.
  function beginGuideDrag(e: React.PointerEvent<HTMLDivElement>, id: string) {
    e.stopPropagation();
    guideDragRef.current = id;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function handleGuideDragMove(e: React.PointerEvent<HTMLDivElement>) {
    const id = guideDragRef.current;
    const rect = previewBoxRef.current?.getBoundingClientRect();
    const guide = userGuides.find((g) => g.id === id);
    if (!guide || !rect || rect.width === 0) return;
    updateGuide(
      guide.id,
      guide.axis === "v" ? ((e.clientX - rect.left) / rect.width) * pageW : ((e.clientY - rect.top) / rect.height) * pageH
    );
  }

  function updateSlot(index: number, patch: Partial<ThemeSlot>) {
    setSlots((prev) => prev.map((s, i) => (i === index ? clampSlot({ ...s, ...patch }) : s)));
  }

  function beginDrag(e: React.PointerEvent<HTMLDivElement>, index: number, mode: "move" | "resize" | "vertex" | "rotate", pointIndex?: number) {
    e.stopPropagation();
    dragRef.current = { index, mode, pointIndex, startX: e.clientX, startY: e.clientY, startSlot: slots[index] };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleDragMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || boxSize.width === 0 || boxSize.height === 0) return;
    if (d.mode === "rotate") {
      const angle = pointerAngle(e, d.startSlot.positionX, d.startSlot.positionY);
      if (angle !== null) updateSlot(d.index, { rotationDeg: angle });
      return;
    }
    // Emplacement tourné : redimensionner et déplacer un sommet se font dans
    // son propre repère (le mouvement du pointeur y est ramené).
    const [dx, dy] =
      d.mode === "move"
        ? [(e.clientX - d.startX) / boxSize.width, (e.clientY - d.startY) / boxSize.height]
        : localDelta(e.clientX - d.startX, e.clientY - d.startY, d.startSlot.rotationDeg ?? 0);
    if (d.mode === "vertex") {
      // Sommet en ratios du rectangle de l'emplacement, borné à celui-ci.
      const points = d.startSlot.points ?? [];
      const start = points[d.pointIndex ?? 0];
      if (!start) return;
      const x = Math.min(1, Math.max(0, start.x + dx / d.startSlot.widthRatio));
      const y = Math.min(1, Math.max(0, start.y + dy / d.startSlot.heightRatio));
      updateSlot(d.index, { points: points.map((p, i) => (i === d.pointIndex ? { x, y } : p)) });
    } else if (d.mode === "move") {
      // Alt : déplacer sans magnétisme.
      updateSlot(
        d.index,
        snapCenter(
          { ...d.startSlot, positionX: d.startSlot.positionX + dx, positionY: d.startSlot.positionY + dy },
          { slot: d.index },
          e.altKey
        )
      );
    } else {
      updateSlot(d.index, {
        widthRatio: d.startSlot.widthRatio + dx * 2,
        heightRatio: d.startSlot.heightRatio + dy * 2,
      });
    }
  }

  function endDrag() {
    dragRef.current = null;
    setSnapLines({ v: null, h: null });
  }

  // Zones de texte : même glisser que les emplacements (déplacer, poignée de
  // coin pour la taille), bornées à la page.
  const zoneDragRef = useRef<{ index: number; mode: "move" | "resize" | "rotate"; startX: number; startY: number; start: ThemeTextZone } | null>(null);

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

  function beginZoneDrag(e: React.PointerEvent<HTMLDivElement>, index: number, mode: "move" | "resize" | "rotate") {
    e.stopPropagation();
    setSelectedZone(index);
    zoneDragRef.current = { index, mode, startX: e.clientX, startY: e.clientY, start: textZones[index] };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleZoneDragMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = zoneDragRef.current;
    if (!d || boxSize.width === 0 || boxSize.height === 0) return;
    if (d.mode === "rotate") {
      const angle = pointerAngle(e, d.start.positionX, d.start.positionY);
      if (angle !== null) updateZone(d.index, { rotationDeg: angle });
      return;
    }
    const rawX = e.clientX - d.startX;
    const rawY = e.clientY - d.startY;
    if (d.mode === "move") {
      updateZone(
        d.index,
        snapCenter(
          { ...d.start, positionX: d.start.positionX + rawX / boxSize.width, positionY: d.start.positionY + rawY / boxSize.height },
          { zone: d.index },
          e.altKey
        )
      );
      return;
    }
    // Coin bas-droit : le coin opposé reste en place, dans le repère de la
    // zone (tournée ou non) — le centre avance de la moitié du mouvement.
    const [lx, ly] = localDelta(rawX, rawY, d.start.rotationDeg ?? 0);
    const a = ((d.start.rotationDeg ?? 0) * Math.PI) / 180;
    const halfX = (lx * boxSize.width) / 2;
    const halfY = (ly * boxSize.height) / 2;
    updateZone(d.index, {
      widthRatio: d.start.widthRatio + lx,
      heightRatio: d.start.heightRatio + ly,
      positionX: d.start.positionX + (halfX * Math.cos(a) - halfY * Math.sin(a)) / boxSize.width,
      positionY: d.start.positionY + (halfX * Math.sin(a) + halfY * Math.cos(a)) / boxSize.height,
    });
  }

  function endZoneDrag() {
    zoneDragRef.current = null;
    setSnapLines({ v: null, h: null });
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
    // Parties envoyées : celles qui ont un graphisme, dans l'ordre des onglets.
    const included = partChoices.filter((c) => partIncluded(c.key));
    const incomplete = partChoices.find((c) => {
      const d = drafts[c.key];
      return d && !d.removed && !partIncluded(c.key) && (d.slots.length > 0 || d.textZones.length > 0);
    });
    if (incomplete) {
      setError(`Ajoute un graphisme pour « ${incomplete.label} », ou retire cette partie.`);
      return;
    }
    if (included.length === 0) {
      setError("Choisis un graphisme pour au moins une partie.");
      return;
    }
    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("templateId", templateId);
    formData.append("scope", effectiveScope);
    formData.append("name", name);
    formData.append(
      "parts",
      JSON.stringify(
        included.map((c) => {
          const d = drafts[c.key] ?? EMPTY_DRAFT;
          return {
            key: c.key,
            slots: d.slots,
            textZones: d.textZones,
            guides: d.guides,
            fixFit: d.fixedStretch && !d.overlayFile,
            removeBackground: d.removeBackground && !d.backgroundFile,
          };
        })
      )
    );
    for (const c of included) {
      const d = drafts[c.key];
      if (d?.overlayFile) formData.append(`overlay@${c.key}`, d.overlayFile);
      if (d?.backgroundFile) formData.append(`background@${c.key}`, d.backgroundFile);
    }

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
            className="mt-1 w-full input"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Modèle</label>
          <select
            required
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="mt-1 w-full input"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {templateOptionLabel(t)}
              </option>
            ))}
          </select>
        </div>

        {panelFold && baseTemplate && (
          <div>
            <label className="block text-sm font-medium">Type de thème</label>
            <div className="mt-1 flex overflow-hidden rounded-lg border border-neutral-300 text-sm">
              {(
                [
                  ["sheet", "Par planche"],
                  ["panel", "Par volet"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setScope(value);
                    setSelectedZone(null);
                    setDrawing(null);
                  }}
                  aria-pressed={effectiveScope === value}
                  className={`flex-1 px-3 py-1.5 ${effectiveScope === value ? "bg-pico-maroon text-white" : "bg-surface text-neutral-700 hover:bg-neutral-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              {effectiveScope === "panel"
                ? "Un graphisme par volet, sur les volets de ton choix (ex. la couverture et l'intérieur gauche)."
                : "Un graphisme par face, au recto et/ou au verso, sur toute la feuille ouverte."}
            </p>
          </div>
        )}

        {partChoices.length > 1 && (
          <div>
            <label className="block text-sm font-medium">{effectiveScope === "panel" ? "Volets" : "Faces"}</label>
            <p className="text-xs text-neutral-500">
              Remplis les {effectiveScope === "panel" ? "volets" : "faces"} de ton choix ; les autres restent libres pour le client.
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {partChoices.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => {
                    setActiveKey(c.key);
                    setSelectedZone(null);
                    setDrawing(null);
                  }}
                  aria-pressed={activeKey === c.key}
                  className={`rounded-lg border px-2.5 py-1 text-xs ${
                    activeKey === c.key
                      ? "border-pico-maroon bg-pico-maroon text-white"
                      : "border-neutral-300 bg-surface text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  {partIncluded(c.key) ? "✓ " : ""}
                  {c.label}
                </button>
              ))}
            </div>
            {partIncluded(activeKey) && (
              <button
                type="button"
                onClick={() => {
                  if (!confirm(`Retirer « ${activeLabel} » du thème ?`)) return;
                  setDrafts((all) => ({ ...all, [activeKey]: { ...EMPTY_DRAFT, removed: savedParts.some((p) => p.key === activeKey) } }));
                  setSelectedZone(null);
                  setDrawing(null);
                }}
                className="mt-1 text-xs text-danger hover:underline"
              >
                Retirer « {activeLabel} » du thème
              </button>
            )}
          </div>
        )}

        {template && <ThemePageInfo template={template} panelFold={panelFoldSafety} />}

        <div>
          <label className="block text-sm font-medium">
            Graphisme{partChoices.length > 1 ? ` — ${activeLabel}` : ""} (PNG avec transparence)
            {currentOverlayUrl ? " — laisser vide pour garder l'actuel" : ""}
          </label>
          <div className="mt-1">
            <FileDropZone
              file={overlayFile}
              onFileChange={handleOverlayChange}
              accept="image/png,image/svg+xml"
              previewUrl={overlayPreview ?? currentOverlayUrl ?? null}
            />
          </div>
          {template && overlayUrl && (
            <ThemeFileNote url={overlayUrl} template={template} fit={fit} onFixStretch={fixStretch} fixed={fixedStretch} />
          )}
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
          {template && backgroundUrl && <ThemeFileNote url={backgroundUrl} template={template} fit={fit} />}
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-500">
              Posée sous les photos, aux mêmes dimensions que le graphisme : visible là où il n&apos;y a pas de photo.
            </p>
            {currentBackgroundUrl && !backgroundFile && (
              <button
                type="button"
                onClick={() => setRemoveBackground(true)}
                className="shrink-0 text-xs text-danger hover:underline"
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
                            : "bg-surface text-neutral-700 hover:bg-neutral-50"
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
                  <label className="flex items-center gap-1 text-neutral-600" title="Rotation en degrés (poignée ronde au-dessus de l'emplacement)">
                    ↻
                    <input
                      type="number"
                      step="any"
                      value={slot.rotationDeg ?? 0}
                      onChange={(e) => updateSlot(i, { rotationDeg: normalizeRotation(e.target.value) })}
                      className="w-16 rounded border border-neutral-300 px-2 py-1"
                    />
                    °
                  </label>
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
                          <FontPicker
                            value={zone.fontId}
                            onChange={(fontId) => updateZone(i, { fontId })}
                            className="mt-1 w-full rounded border border-neutral-300 bg-surface px-2 py-1"
                          />
                        </label>
                        <div>
                          <span className="flex items-center justify-between gap-1 text-neutral-600">
                            Taille max. <FontUnitToggle />
                          </span>
                          <FontSizeInput
                            valueMm={zone.fontSizeMm}
                            minMm={1}
                            onChange={(fontSizeMm) => updateZone(i, { fontSizeMm })}
                            ariaLabel="Taille max. du texte"
                            className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
                          />
                        </div>
                      </div>
                      <label className="flex items-center gap-1.5 text-neutral-600">
                        Rotation
                        <input
                          type="number"
                          step="any"
                          value={zone.rotationDeg ?? 0}
                          onChange={(e) => updateZone(i, { rotationDeg: normalizeRotation(e.target.value) })}
                          className="w-16 rounded border border-neutral-300 px-2 py-1"
                        />
                        °
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <ColorPickerButton value={zone.color} onChange={(color) => updateZone(i, { color })} label="Couleur" />
                        <div className="flex overflow-hidden rounded-lg border border-neutral-300" title="Alignement vertical dans la zone">
                          {THEME_TEXT_VERTICAL_ALIGNS.map((a) => (
                            <button
                              key={a.value}
                              type="button"
                              onClick={() => updateZone(i, { verticalAlign: a.value })}
                              className={`px-2 py-1 ${(zone.verticalAlign ?? "middle") === a.value ? "bg-emerald-600 text-white" : "bg-surface text-neutral-700 hover:bg-neutral-50"}`}
                            >
                              {a.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex overflow-hidden rounded-lg border border-neutral-300">
                          {THEME_TEXT_ALIGNS.map((a) => (
                            <button
                              key={a.value}
                              type="button"
                              onClick={() => updateZone(i, { align: a.value })}
                              className={`px-2 py-1 ${zone.align === a.value ? "bg-emerald-600 text-white" : "bg-surface text-neutral-700 hover:bg-neutral-50"}`}
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
                        <button type="button" onClick={() => removeZone(i)} className="text-danger hover:underline">
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
      {template && (
        <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Repères</span>
            <span className="flex items-center gap-3 text-xs text-neutral-600">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
                Afficher
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} />
                Magnétisme
              </label>
              <LengthUnitToggle />
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => addGuide("v")}
              className="flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
            >
              + Vertical
            </button>
            <button
              type="button"
              onClick={() => addGuide("h")}
              className="flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
            >
              + Horizontal
            </button>
          </div>
          {userGuides.length > 0 && (
            <ul className="space-y-1">
              {userGuides.map((g) => (
                <li key={g.id} className="flex items-center gap-2 text-xs text-neutral-600">
                  <span className="w-20">{g.axis === "v" ? "Vertical, X" : "Horizontal, Y"}</span>
                  <LengthInput
                    valueMm={g.pos}
                    onChange={(mm) => updateGuide(g.id, mm)}
                    className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm"
                  />
                  <span>{unitLabel(lengthUnit)}</span>
                  <button
                    type="button"
                    onClick={() => removeGuide(g.id)}
                    aria-label="Retirer le repère"
                    className="ml-auto rounded-lg p-1 text-neutral-400 hover:bg-danger-subtle hover:text-danger"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-neutral-500">
            Glisse un repère sur l&apos;aperçu pour le placer (mesuré depuis le coin haut-gauche, fond perdu compris).
            Avec le magnétisme, les cases et les zones de texte s&apos;aimantent aux repères, au centre, à la coupe
            (rouge), à la marge de sécurité (vert), aux plis (bleu) et entre elles ; Alt pour déplacer sans aimant.
            Les repères ne sont jamais imprimés.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 btn-primary disabled:opacity-60"
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
                className="rounded-md border border-blue-200 bg-surface px-2.5 py-1"
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
                className={`pointer-events-none absolute inset-0 h-full w-full ${fitClass}`}
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
                className={`pointer-events-none absolute inset-0 h-full w-full ${fitClass}`}
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
                  transform: slot.rotationDeg ? `rotate(${slot.rotationDeg}deg)` : undefined,
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
                  transform: slot.rotationDeg ? `rotate(${slot.rotationDeg}deg)` : undefined,
                }}
              >
                <RotateHandle
                  onPointerDown={(e) => beginDrag(e, i, "rotate")}
                  onPointerMove={handleDragMove}
                  onPointerUp={endDrag}
                  color="bg-blue-600"
                />
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
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-50/90 text-neutral-600 hover:bg-surface"
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
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-50/90 text-[10px] text-neutral-600 hover:bg-surface"
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
                  transform: zone.rotationDeg ? `rotate(${zone.rotationDeg}deg)` : undefined,
                }}
              >
                <RotateHandle
                  onPointerDown={(e) => beginZoneDrag(e, i, "rotate")}
                  onPointerMove={handleZoneDragMove}
                  onPointerUp={endZoneDrag}
                  color="bg-emerald-600"
                />
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
            {/* Repères du modèle (coupe, marge de sécurité, plis) et ligne
                d'aimantation : visibles ici seulement, jamais imprimés. */}
            {template && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${pageW} ${pageH}`}
                preserveAspectRatio="none"
              >
                {showGuides && (() => {
                  const b = template.bleed_mm;
                  const sx = b + template.safety_margin_x_mm;
                  const sy = b + template.safety_margin_y_mm;
                  return (
                    <>
                      {b > 0 && (
                        <rect x={b} y={b} width={pageW - 2 * b} height={pageH - 2 * b} fill="none" stroke="#f43f5e" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                      )}
                      {(template.safety_margin_x_mm > 0 || template.safety_margin_y_mm > 0) && (
                        <rect x={sx} y={sy} width={pageW - 2 * sx} height={pageH - 2 * sy} fill="none" stroke="#16a34a" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
                      )}
                      {(template.fold_marks_vertical_mm ?? []).map((f) => (
                        <line key={`fv-${f}`} x1={b + f} x2={b + f} y1={0} y2={pageH} stroke="#2563eb" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
                      ))}
                      {(template.fold_marks_horizontal_mm ?? []).map((f) => (
                        <line key={`fh-${f}`} x1={0} x2={pageW} y1={b + f} y2={b + f} stroke="#2563eb" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
                      ))}
                      {/* Thème par volet : zone de sécurité du pli sur les deux
                          côtés qui peuvent y tomber, et le fond perdu retiré. */}
                      {panelFoldSafety &&
                        (() => {
                          const sm = panelFoldSafety.safetyMm;
                          const vertical = panelFoldSafety.direction === "vertical";
                          const len = vertical ? pageW : pageH;
                          // Côté pli : le fond perdu (retiré au rendu) hachuré
                          // en gris, la ligne du pli, et la zone de sécurité.
                          const edges = [
                            panelFoldSafety.start ? { cut: 0, fold: b, safe: b } : null,
                            panelFoldSafety.end ? { cut: len - b, fold: len - b, safe: len - b - sm } : null,
                          ].filter((e): e is { cut: number; fold: number; safe: number } => e !== null);
                          return edges.map((e) =>
                            vertical ? (
                              <g key={`pfs-${e.cut}`}>
                                <rect x={e.cut} y={0} width={b} height={pageH} fill="#6b7280" fillOpacity={0.35} />
                                <rect x={e.safe} y={0} width={sm} height={pageH} fill="#2563eb" fillOpacity={0.12} />
                                <line x1={e.fold} x2={e.fold} y1={0} y2={pageH} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="6 3" vectorEffect="non-scaling-stroke" />
                              </g>
                            ) : (
                              <g key={`pfs-${e.cut}`}>
                                <rect x={0} y={e.cut} width={pageW} height={b} fill="#6b7280" fillOpacity={0.35} />
                                <rect x={0} y={e.safe} width={pageW} height={sm} fill="#2563eb" fillOpacity={0.12} />
                                <line x1={0} x2={pageW} y1={e.fold} y2={e.fold} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="6 3" vectorEffect="non-scaling-stroke" />
                              </g>
                            )
                          );
                        })()}
                      {/* Plis du modèle : la ligne, et la zone de sécurité de
                          chaque côté (à garder libre de texte et de visages). */}
                      {folds?.positionsMm.map((f) =>
                        folds.direction === "vertical" ? (
                          <g key={`pv-${f}`}>
                            <rect x={b + f - folds.safetyMm} y={0} width={2 * folds.safetyMm} height={pageH} fill="#2563eb" fillOpacity={0.12} />
                            <line x1={b + f} x2={b + f} y1={0} y2={pageH} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="6 3" vectorEffect="non-scaling-stroke" />
                          </g>
                        ) : (
                          <g key={`ph-${f}`}>
                            <rect x={0} y={b + f - folds.safetyMm} width={pageW} height={2 * folds.safetyMm} fill="#2563eb" fillOpacity={0.12} />
                            <line x1={0} x2={pageW} y1={b + f} y2={b + f} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="6 3" vectorEffect="non-scaling-stroke" />
                          </g>
                        )
                      )}
                    </>
                  );
                })()}
                {snapLines.v !== null && (
                  <line x1={snapLines.v * pageW} x2={snapLines.v * pageW} y1={0} y2={pageH} stroke="#d946ef" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                )}
                {snapLines.h !== null && (
                  <line x1={0} x2={pageW} y1={snapLines.h * pageH} y2={snapLines.h * pageH} stroke="#d946ef" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                )}
              </svg>
            )}
            {/* Repères posés : une ligne fine, et une bande invisible plus
                large pour les saisir et les glisser. */}
            {showGuides &&
              userGuides.map((g) => {
                const at = `${(g.pos / (g.axis === "v" ? pageW : pageH)) * 100}%`;
                return (
                  <div
                    key={g.id}
                    onPointerDown={(e) => beginGuideDrag(e, g.id)}
                    onPointerMove={handleGuideDragMove}
                    onPointerUp={() => (guideDragRef.current = null)}
                    title={`${g.axis === "v" ? "X" : "Y"} = ${formatLength(g.pos, lengthUnit)}`}
                    className={`absolute flex justify-center ${
                      g.axis === "v" ? "inset-y-0 w-2 -translate-x-1/2 cursor-ew-resize" : "inset-x-0 h-2 -translate-y-1/2 cursor-ns-resize flex-col"
                    }`}
                    style={g.axis === "v" ? { left: at } : { top: at }}
                  >
                    <div className={g.axis === "v" ? "h-full w-px bg-cyan-500" : "h-px w-full bg-cyan-500"} />
                  </div>
                );
              })}
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
                      pi === 0 && drawing.points.length >= MIN_POLYGON_SIDES ? "h-4 w-4 bg-success" : "h-3 w-3 bg-blue-600"
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

// Poignée de rotation : un rond au-dessus du milieu du cadre, relié par un
// trait ; glisser pour tourner (Maj : par 15°).
function RotateHandle({
  onPointerDown,
  onPointerMove,
  onPointerUp,
  color,
}: {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  color: string;
}) {
  return (
    <>
      <span className={`pointer-events-none absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 -translate-y-full ${color}`} />
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Glisser pour tourner (Maj : par 15°)"
        className={`pointer-events-auto absolute left-1/2 top-0 h-3.5 w-3.5 cursor-grab rounded-full border-2 border-white shadow ${color}`}
        style={{ transform: "translate(-50%, calc(-100% - 14px))" }}
      />
    </>
  );
}

// Format attendu des fichiers du thème : la page entière, fond perdu compris,
// et les plis du modèle.
function ThemePageInfo({
  template,
  panelFold = null,
}: {
  template: Template;
  // Thème par volet : le pli tombe sur l'un des bords, selon le volet.
  panelFold?: { direction: "vertical" | "horizontal"; safetyMm: number; start: boolean; end: boolean; label: string | null } | null;
}) {
  const px = themePagePx(template);
  const folds = foldLines(template);
  const pageW = template.width_mm + 2 * template.bleed_mm;
  const pageH = template.height_mm + 2 * template.bleed_mm;
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
      <p>
        <span className="font-medium text-text">Fichiers attendus : </span>
        {formatSizeInMm(pageW, pageH)}
        {template.bleed_mm > 0 ? `, fond perdu de ${formatInMm(template.bleed_mm)} compris de chaque côté` : ", sans fond perdu"}
        {" "}· {px.width} × {px.height} px à {template.dpi} dpi.
      </p>
      {panelFold && (() => {
        const v = panelFold.direction === "vertical";
        const sides = [panelFold.start ? (v ? "gauche" : "du haut") : null, panelFold.end ? (v ? "droit" : "du bas") : null].filter(Boolean);
        return (
          <p className="mt-1">
            {panelFold.label ? `Volet ${panelFold.label}. ` : "Format d'un volet, pour n'importe lequel. "}
            {panelFold.label
              ? `Le pli est sur le bord ${sides.join(" et le bord ")} (ligne bleue)`
              : `Le pli tombe sur le bord ${v ? "gauche ou droit" : "du haut ou du bas"} selon le volet`}
            {" "}: de ce côté, le fond perdu (gris) est retiré au rendu ; garder {formatInMm(panelFold.safetyMm)} libres le long
            du pli (bande bleue).
          </p>
        );
      })()}
      {folds && folds.positionsMm.length > 0 && (
        <p className="mt-1">
          {folds.positionsMm.length > 1 ? "Plis" : "Pli"} à{" "}
          {folds.positionsMm.map((f) => formatInMm(f + template.bleed_mm)).join(", ")} du bord
          {folds.direction === "vertical" ? " gauche" : " du haut"} du fichier ; garder{" "}
          {formatInMm(folds.safetyMm)} libres de chaque côté (bande bleue).
        </p>
      )}
    </div>
  );
}

// Dimensions naturelles d'une image (adresse locale ou signée).
function useImageSize(url: string): { width: number; height: number } | null {
  const [size, setSize] = useState<{ url: string; width: number; height: number } | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setSize({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.src = url;
    return () => {
      img.onload = null;
    };
  }, [url]);
  return size && size.url === url && size.width > 0 ? size : null;
}

// Ce que deviendra le fichier sur la page : bon format, recadré, ou étiré
// (thèmes d'avant la migration 0085, tant que le graphisme n'est pas remplacé).
function ThemeFileNote({
  url,
  template,
  fit,
  onFixStretch,
  fixed = false,
}: {
  url: string;
  template: ThemePage;
  fit: "fill" | "cover";
  // Graphisme seulement : corriger l'étirement sans renvoyer le fichier.
  onFixStretch?: (fileW: number, fileH: number) => void;
  fixed?: boolean;
}) {
  const size = useImageSize(url);
  if (!size) return null;
  const check = checkThemeFile(size.width, size.height, template);
  const lowRes = check.dpi < template.dpi * 0.66;
  const res = ` ${size.width} × ${size.height} px, ≈ ${check.dpi} dpi à l'impression.`;
  if (check.kind === "ok") {
    return (
      <p className={`mt-1 text-xs ${lowRes ? "text-warning-strong" : "text-success"}`}>
        ✓ Bonnes proportions.{res}
        {lowRes ? " Résolution faible pour l'impression." : ""}
      </p>
    );
  }
  const pageW = template.width_mm + 2 * template.bleed_mm;
  const pageH = template.height_mm + 2 * template.bleed_mm;
  if (fit === "fill") {
    const stretch = Math.round(Math.abs((size.width / size.height) / (pageW / pageH) - 1) * 100);
    return (
      <div className="mt-1 space-y-1 text-xs text-warning-strong">
        <p>⚠ Ce fichier est étiré pour remplir la page (déformé d&apos;environ {stretch} %).</p>
        {onFixStretch && (
          <button
            type="button"
            onClick={() => onFixStretch(size.width, size.height)}
            className="rounded-lg border border-neutral-300 bg-surface px-2.5 py-1 font-medium text-text hover:bg-neutral-50"
          >
            Corriger sans déformation
          </button>
        )}
      </div>
    );
  }
  const fixedNote = fixed ? " Déformation corrigée : vérifiez les emplacements sur l'aperçu, puis enregistrez." : "";
  const cut = [
    check.cropXMm > 0.05 ? `${formatInMm(check.cropXMm)} à gauche et à droite` : null,
    check.cropYMm > 0.05 ? `${formatInMm(check.cropYMm)} en haut et en bas` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <p className="mt-1 text-xs text-warning-strong">
      ⚠{" "}
      {check.kind === "no-bleed"
        ? "Ce fichier semble fait sans fond perdu : il est agrandi pour le couvrir, et le bord du dessin tombe dans la coupe"
        : "Proportions différentes de la page : le fichier est recadré au centre, sans déformation"}
      {cut ? ` (coupé : ${cut})` : ""}.{res}
      {fixedNote}
    </p>
  );
}
