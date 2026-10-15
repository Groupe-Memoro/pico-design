"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { LogoShape, Template, ThemeSlot, ThemeSlotAdjust, VisualMode } from "@/lib/types";
import type { LogoShadowSettings } from "@/lib/logoShadowSettings";
import type { VisualWithUrl } from "@/components/VisualsGrid";
import VisualPicker from "@/components/VisualPicker";
import FileDropZone from "@/components/FileDropZone";
import { mmToIn, inToMm } from "@/lib/pdf/units";
import { slotClipPath, slotMaskStyle, slotShape, slotSvgShape } from "@/lib/themeShapes";
import { stageLargeFiles } from "@/lib/design/stageUpload";
import { filePreviewUrl } from "@/lib/design/filePreview";
import FabricLayerCanvas from "@/components/FabricLayerCanvas";
import { SpinnerIcon, UploadIcon } from "@/components/icons";
import { fontOptionById } from "@/lib/design/fonts";
import { maxTextSizeMmForTemplate, type DesignLayer, type ImageLayer } from "@/lib/design/layers";

// "mosaic" : mosaïque de plusieurs photos distinctes uploadées (étape « Type
// de design » de Design Shopify) — à ne pas confondre avec le "tile" de
// VisualMode, qui répète UN SEUL visuel de la banque en motif.
// "theme" : un Thème (visuel préfait attribué au modèle, voir lib/pdf/theme.ts)
// — 1 à 3 photos du client, recadrées dans des emplacements prédéterminés,
// avec le graphisme du thème par-dessus.
export type SourceMode = "upload" | VisualMode | "mosaic" | "theme";

// Curseur "zoom" pour la taille de répétition (mosaïque) : un ratio 1-100
// (pas une unité physique) sur échelle logarithmique en interne, pour que
// glisser le curseur produise un effet de zoom régulier plutôt qu'un pas
// linéaire peu utilisable sur une aussi grande plage de tailles réelles
// (0,1 à 24 po).
const TILE_ZOOM_MIN_IN = 0.1;
const TILE_ZOOM_MAX_IN = 24;
const TILE_ZOOM_MIN_RATIO = 1;
const TILE_ZOOM_MAX_RATIO = 100;

function tileSizeInToZoom(sizeIn: number): number {
  const clamped = Math.min(TILE_ZOOM_MAX_IN, Math.max(TILE_ZOOM_MIN_IN, sizeIn));
  const t = Math.log(clamped / TILE_ZOOM_MIN_IN) / Math.log(TILE_ZOOM_MAX_IN / TILE_ZOOM_MIN_IN);
  return TILE_ZOOM_MIN_RATIO + t * (TILE_ZOOM_MAX_RATIO - TILE_ZOOM_MIN_RATIO);
}

function zoomToTileSizeIn(zoom: number): number {
  const t = (zoom - TILE_ZOOM_MIN_RATIO) / (TILE_ZOOM_MAX_RATIO - TILE_ZOOM_MIN_RATIO);
  return TILE_ZOOM_MIN_IN * Math.pow(TILE_ZOOM_MAX_IN / TILE_ZOOM_MIN_IN, t);
}

// Zoom proposé par défaut pour une nouvelle mosaïque (l'échelle ci-dessus
// n'est pas linéaire : 60 correspond à un motif d'environ 2,6 po).
export const DEFAULT_TILE_ZOOM = 60;
export const DEFAULT_TILE_SIZE_MM = inToMm(zoomToTileSizeIn(DEFAULT_TILE_ZOOM));

export function isPdfFile(file: File | null): boolean {
  return Boolean(file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name)));
}

export const SOURCE_MODES: { value: SourceMode; label: string }[] = [
  { value: "upload", label: "Uploader une image" },
  { value: "full", label: "Visuel — plein format" },
  { value: "tile", label: "Visuel — mosaïque" },
  { value: "mosaic", label: "Mosaïque de photos" },
];

export interface ImageSourceValue {
  sourceMode: SourceMode;
  file: File | null;
  visualId: string;
  tileSizeMm: number;
  positionX: number;
  positionY: number;
  // Zoom relatif au cadrage "cover" minimal (1 = ce minimum, sans marge) —
  // voir coverCropToBuffer. >1 resserre le cadrage, <1 laisse une marge
  // blanche autour de l'image. Optionnel : seule l'étape « Aperçu » de
  // Design Shopify l'expose (allowZoom).
  scale?: number;
  // Rotation du visuel lui-même, en degrés (0/90/180/270) — distinct de
  // `rotated` (Portrait/Paysage du modèle) : ici c'est l'image qui tourne
  // dans son cadre, pas le cadre qui change de forme. Voir coverCropToBuffer.
  // Optionnel : seule l'étape « Aperçu » de Design Shopify l'expose (allowZoom).
  rotation?: number;
  // Mosaïque (sourceMode "mosaic") : une case par photo, dans l'ordre de la
  // grille (ligne par ligne) — voir `mosaicGrid` sur ImageSourcePicker pour
  // ses dimensions (cols/rows), partagées entre recto et verso. `null` =
  // case vide (laisse un blanc à cet endroit, voir composeMosaicImage).
  mosaicFiles?: (File | null)[];
  // Cadrage (position/zoom) de la photo de chaque case, dans le même ordre
  // que `mosaicFiles` — même mécanique que `themeSlotAdjust` pour un thème.
  mosaicCellAdjust?: ThemeSlotAdjust[];
  // Thème (sourceMode "theme") : une photo par emplacement, dans le même
  // ordre que `theme.slots` — voir `themeSlots`/`themeOverlayUrl` sur
  // ImageSourcePicker. `null` = emplacement vide (voir composeThemeImage).
  // Assignée par glisser depuis `themePhotoBank` (voir plus bas), jamais
  // uploadée directement : le même fichier peut donc se retrouver dans
  // plusieurs emplacements à la fois (même référence, pas une copie).
  themeSlotFiles?: (File | null)[];
  // Ajustement (position/zoom) du client dans chaque emplacement — même
  // sémantique que positionX/positionY/scale pour un fond simple, mais un
  // jeu de valeurs par emplacement (voir composeThemeImage). Case manquante
  // = cadrage "cover" par défaut pour cet emplacement.
  themeSlotAdjust?: ThemeSlotAdjust[];
  // Banque de photos (sourceMode "theme") : les photos ajoutées par le
  // client, indépendamment des emplacements — glissées ensuite dans
  // `themeSlotFiles` (voir ThemeBankThumbnail/ThemeSlotDropTarget). Retirer
  // une photo d'ici la retire aussi de tout emplacement qui l'utilisait.
  themePhotoBank?: File[];
}

// Coins de redimensionnement. Le nom dit quel coin on saisit ; le coin
// DIAGONALEMENT opposé est celui qui reste fixe.
const CORNERS = [
  { id: "nw", sx: -1, sy: -1, className: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize" },
  { id: "ne", sx: 1, sy: -1, className: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize" },
  { id: "sw", sx: -1, sy: 1, className: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize" },
  { id: "se", sx: 1, sy: 1, className: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize" },
] as const;

type CornerId = (typeof CORNERS)[number]["id"];

// Poignées de rotation/redimensionnement du calque sélectionné — affichées
// par LayerHandles, imbriquées dans le même conteneur déjà positionné/
// tourné que le calque (voir son rendu plus bas) : leur position à l'écran
// suit donc automatiquement la rotation courante, sans calcul dédié. Seule
// la poignée de rotation, elle, a besoin de connaître le centre réel du
// calque à l'écran (`getBoundingClientRect`) pour convertir un mouvement de
// souris en angle.
//
// Redimensionnement : saisir un coin laisse le coin OPPOSÉ en place, comme
// dans tous les outils de mise en page. Ça oblige à recalculer la taille ET
// à déplacer le centre, puisqu'un calque est positionné par son centre
// (positionX/Y) — un redimensionnement purement radial, centré, est ce qui
// rendait le geste déroutant.
function LayerHandles({
  layer,
  layers,
  onChangeLayers,
  previewBoxRef,
  maxFontSizeMm,
}: {
  layer: DesignLayer;
  layers: DesignLayer[];
  onChangeLayers: (layers: DesignLayer[]) => void;
  previewBoxRef: React.RefObject<HTMLDivElement>;
  maxFontSizeMm: number;
}) {
  const dragRef = useRef<{
    mode: "rotate" | "resize";
    corner: CornerId;
    centerX: number;
    centerY: number;
    startAngleDeg: number;
    startRotationDeg: number;
    startDist: number;
    // Demi-dimensions du calque AVANT rotation (offsetWidth/Height, donc en
    // pixels de mise en page) : getBoundingClientRect renverrait la boîte
    // englobante du calque tourné, inutilisable pour ce calcul.
    halfW: number;
    halfH: number;
    startFontSizeMm: number;
    // Bordure et espacement du texte au début du geste : ils grandissent
    // avec la police, pour garder les proportions.
    startStrokeWidthMm: number;
    startLetterSpacingMm: number;
    startWidthRatio: number;
    startHeightRatio: number;
  } | null>(null);

  function centerPx() {
    const box = previewBoxRef.current;
    if (!box) return { x: 0, y: 0 };
    const rect = box.getBoundingClientRect();
    return { x: rect.left + layer.positionX * rect.width, y: rect.top + layer.positionY * rect.height };
  }

  function beginDrag(e: React.PointerEvent<HTMLDivElement>, mode: "rotate" | "resize", corner: CornerId = "se") {
    e.stopPropagation();
    const { x, y } = centerPx();
    // Le conteneur du calque : ses dimensions de mise en page servent de
    // référence, la rotation étant appliquée par-dessus en CSS.
    const host = e.currentTarget.parentElement as HTMLElement | null;
    const startAngleDeg = (Math.atan2(e.clientY - y, e.clientX - x) * 180) / Math.PI;
    const startDist = Math.max(1, Math.hypot(e.clientX - x, e.clientY - y));
    dragRef.current = {
      mode,
      corner,
      centerX: x,
      centerY: y,
      startAngleDeg,
      startRotationDeg: layer.rotationDeg ?? 0,
      startDist,
      halfW: Math.max(1, (host?.offsetWidth ?? 2) / 2),
      halfH: Math.max(1, (host?.offsetHeight ?? 2) / 2),
      startFontSizeMm: layer.type === "text" ? layer.fontSizeMm : 0,
      startStrokeWidthMm: layer.type === "text" ? layer.strokeWidthMm : 0,
      startLetterSpacingMm: layer.type === "text" ? layer.letterSpacingMm : 0,
      startWidthRatio: layer.type === "image" || layer.type === "shape" ? layer.widthRatio : 0,
      startHeightRatio: layer.type === "shape" ? layer.heightRatio : 0,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;

    if (d.mode === "rotate") {
      const angleDeg = (Math.atan2(e.clientY - d.centerY, e.clientX - d.centerX) * 180) / Math.PI;
      let next = d.startRotationDeg + (angleDeg - d.startAngleDeg);
      // Aimante les angles ronds (tous les 45°) à 4° près — pratique pour
      // remettre un texte bien horizontal/vertical sans viser au pixel près.
      const snapped = Math.round(next / 45) * 45;
      if (Math.abs(next - snapped) < 4) next = snapped;
      next = ((next % 360) + 360) % 360;
      onChangeLayers(layers.map((l) => (l.id === layer.id ? { ...l, rotationDeg: next } : l)));
      return;
    }

    const box = previewBoxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();

    // On raisonne dans le repère du calque, rotation annulée : sans ça, le
    // coin « opposé » d'un calque tourné ne serait pas celui qu'on voit.
    const theta = ((d.startRotationDeg % 360) * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const dx = e.clientX - d.centerX;
    const dy = e.clientY - d.centerY;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;

    const corner = CORNERS.find((c) => c.id === d.corner)!;
    // Coin fixe = l'opposé de celui qu'on tire.
    const fixedX = -corner.sx * d.halfW;
    const fixedY = -corner.sy * d.halfH;

    // Échelle demandée par le geste, puis bornée par les limites du calque.
    // On recalcule l'échelle effective APRÈS bornage, sinon le coin fixe
    // dériverait dès qu'on atteint une borne.
    const wantedHalfW = Math.max(1, Math.abs(localX - fixedX) / 2);
    const wantedHalfH = Math.max(1, Math.abs(localY - fixedY) / 2);

    let scaleX = wantedHalfW / d.halfW;
    let scaleY = wantedHalfH / d.halfH;
    let patch: Partial<DesignLayer> = {};

    if (layer.type === "shape") {
      const w = Math.min(1.5, Math.max(0.05, d.startWidthRatio * scaleX));
      const h = Math.min(1.5, Math.max(0.05, d.startHeightRatio * scaleY));
      scaleX = w / d.startWidthRatio;
      scaleY = h / d.startHeightRatio;
      patch = { widthRatio: w, heightRatio: h };
    } else if (layer.type === "image") {
      // Une image garde ses proportions : sa hauteur découle de sa largeur.
      const w = Math.min(1, Math.max(0.05, d.startWidthRatio * scaleX));
      scaleX = w / d.startWidthRatio;
      scaleY = scaleX;
      patch = { widthRatio: w };
    } else {
      // Texte : la boîte grandit avec le corps, donc une seule échelle.
      const size = Math.min(maxFontSizeMm, Math.max(3, d.startFontSizeMm * scaleX));
      scaleX = size / d.startFontSizeMm;
      scaleY = scaleX;
      patch = {
        fontSizeMm: size,
        strokeWidthMm: d.startStrokeWidthMm * scaleX,
        letterSpacingMm: d.startLetterSpacingMm * scaleX,
      };
    }

    // Nouveau centre : celui qui laisse le coin fixe exactement où il est.
    const newHalfW = d.halfW * scaleX;
    const newHalfH = d.halfH * scaleY;
    const centerLocalX = fixedX + corner.sx * newHalfW;
    const centerLocalY = fixedY + corner.sy * newHalfH;
    const centerWorldX = d.centerX + centerLocalX * cos - centerLocalY * sin;
    const centerWorldY = d.centerY + centerLocalX * sin + centerLocalY * cos;

    const positionX = Math.min(1.5, Math.max(-0.5, (centerWorldX - rect.left) / rect.width));
    const positionY = Math.min(1.5, Math.max(-0.5, (centerWorldY - rect.top) / rect.height));

    onChangeLayers(
      layers.map((l) => (l.id === layer.id ? ({ ...l, ...patch, positionX, positionY } as DesignLayer) : l))
    );
  }

  function endDrag() {
    dragRef.current = null;
  }

  return (
    <>
      <div
        onPointerDown={(e) => beginDrag(e, "rotate")}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        role="button"
        aria-label="Pivoter le calque"
        className="absolute left-1/2 top-0 h-4 w-4 -translate-x-1/2 -translate-y-7 cursor-alias touch-none rounded-full border-2 border-[var(--accent)] bg-white shadow"
      />
      {CORNERS.map((corner) => (
        <div
          key={corner.id}
          onPointerDown={(e) => beginDrag(e, "resize", corner.id)}
          onPointerMove={handleMove}
          onPointerUp={endDrag}
          role="button"
          aria-label={`Redimensionner le calque (coin ${corner.id})`}
          className={`absolute h-3 w-3 touch-none rounded-sm border-2 border-[var(--accent)] bg-white shadow ${corner.className}`}
        />
      ))}
    </>
  );
}

// Une case de la grille mosaïque (sourceMode "mosaic") : une miniature très
// compacte (carrée), pas le grand FileDropZone habituel — il y en a
// plusieurs à la fois, côte à côte, pas la place pour son texte d'aide.
function MosaicCellDropZone({
  file,
  onFileChange,
  label,
  acceptPdf = false,
  previewUrl,
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  // Nom du volet (composition par volet).
  label?: string;
  acceptPdf?: boolean;
  // Aperçu fourni par le parent (un PDF rendu par le serveur) ; absent =
  // l'image du fichier elle-même.
  previewUrl?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [ownPreview, setPreview] = useState<string | null>(null);
  const preview = previewUrl !== undefined ? previewUrl : ownPreview;

  useEffect(() => {
    if (previewUrl !== undefined || !file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, previewUrl]);

  return (
    <div className="flex flex-col gap-0.5">
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFileChange(e.dataTransfer.files?.[0] ?? null);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={`relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition-colors ${
        dragOver ? "border-primary bg-primary-subtle" : "border-border bg-surface hover:border-border-strong"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={acceptPdf ? "image/*,application/pdf" : "image/*"}
        onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        className="hidden"
      />
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" className="h-full w-full object-cover" />
      ) : (
        <UploadIcon className="h-5 w-5 text-text-subtle" />
      )}
      {file && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onFileChange(null);
            if (inputRef.current) inputRef.current.value = "";
          }}
          className="absolute right-0.5 top-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] leading-tight text-white hover:bg-black/80"
        >
          ✕
        </button>
      )}
    </div>
    {label && <span className="truncate text-center text-[10px] text-text-muted">{label}</span>}
    </div>
  );
}

// Une photo de la banque (sourceMode "theme") : une miniature glissable
// (drag-and-drop natif HTML5 — voir onDragStart) — le seul moyen d'assigner
// une photo à un emplacement (voir ThemeSlotDropTarget) : jamais uploadée
// directement dans un emplacement, précisément pour pouvoir glisser la même
// photo dans plusieurs emplacements sans avoir à l'ajouter plusieurs fois.
function ThemeBankThumbnail({
  file,
  bankIndex,
  onRemove,
}: {
  file: File;
  bankIndex: number;
  onRemove: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        // Index dans la banque (pas le fichier lui-même, non sérialisable) —
        // lu par ThemeSlotDropTarget et le rendu des emplacements dans le
        // grand aperçu (voir plus bas) pour retrouver `value.themePhotoBank[i]`.
        e.dataTransfer.setData("text/plain", String(bankIndex));
      }}
      title="Glisse cette photo dans un emplacement"
      className="relative aspect-square cursor-grab overflow-hidden rounded-lg border border-border bg-surface active:cursor-grabbing"
    >
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" draggable={false} className="h-full w-full object-cover" />
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute right-0.5 top-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] leading-tight text-white hover:bg-black/80"
      >
        ✕
      </button>
    </div>
  );
}

// Un emplacement (sourceMode "theme"), version compacte de la barre
// latérale : n'accepte qu'un dépôt depuis la banque (ThemeBankThumbnail),
// jamais un upload direct — voir le commentaire de `themeSlotFiles`.
function ThemeSlotDropTarget({
  index,
  file,
  onDropBankIndex,
  onClear,
}: {
  index: number;
  file: File | null;
  onDropBankIndex: (bankIndex: number) => void;
  onClear: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const bankIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
        if (Number.isFinite(bankIndex)) onDropBankIndex(bankIndex);
      }}
      className={`relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed text-center transition-colors ${
        dragOver ? "border-primary bg-primary-subtle" : "border-border bg-surface"
      }`}
    >
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <span className="px-1 text-[10px] leading-tight text-text-subtle">Glisse ici</span>
      )}
      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/50 px-1 text-[9px] leading-tight text-white">
        {index + 1}
      </span>
      {file && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="absolute right-0.5 top-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] leading-tight text-white hover:bg-black/80"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * Sélection de la source d'une image de produit (upload ou visuel de la
 * banque, plein format ou mosaïque) + aperçu avec repositionnement par
 * glisser-déposer. Réutilisé pour le recto et le verso (voir ProductForm) :
 * `side`/`logo` distinguent les deux (le verso n'a jamais de logo Pico).
 */
export default function ImageSourcePicker({
  side,
  template,
  // Laissez-passer du mode public : remplace la session pour /api/products/preview.
  grant,
  rotated,
  visuals,
  value,
  onChange,
  currentImageUrl,
  logo,
  previewUnavailableMessage,
  pairedPdf,
  previewSize = "sm",
  fitBox = null,
  showGuides = true,
  allowZoom = false,
  sourceModes = ["upload", "full", "tile"],
  allowFileChange = true,
  showPreview = true,
  layers = [],
  onChangeLayers,
  selectedLayerId = null,
  onSelectLayer,
  layerEngine = "dom",
  mosaicGrid = { cols: 2, rows: 2 },
  panelCells = null,
  themeId = null,
  themeSlots = [],
  themeOverlayUrl = null,
  themeBackgroundUrl = null,
  selectedThemeSlot = null,
  onSelectThemeSlot,
}: {
  side: "front" | "back";
  template: Template | null;
  // Laissez-passer du mode public (voir lib/publicDesign.ts).
  grant?: string;
  rotated: boolean;
  visuals: VisualWithUrl[];
  value: ImageSourceValue;
  onChange: (patch: Partial<ImageSourceValue>) => void;
  currentImageUrl?: string | null;
  logo: {
    shape: LogoShape;
    color: string;
    secondaryColor: string;
    // null = sans ombre portée
    shadow: LogoShadowSettings | null;
  } | null;
  previewUnavailableMessage?: string;
  // Verso tiré du PDF du recto (page `page`) tant qu'aucun fichier n'est choisi ici.
  pairedPdf?: { file: File; page: number } | null;
  // Largeur de l'aperçu : "sm" (défaut, formulaires admin étroits) ou "lg"
  // (étape 3 de Design Shopify — aperçu zoomé, même mécanique de glisser).
  previewSize?: "sm" | "lg";
  // Place réellement libre pour l'aperçu, en px (mesurée par l'éditeur) : la
  // page s'y inscrit au plus grand, ratio gardé. Absente : plafond de 60vh.
  fitBox?: { width: number; height: number } | null;
  // Ligne de coupe/marge de sécurité/gabarit : affichés par défaut (admin).
  // Design Shopify les masque à l'étape « Visuel » (false) — seule l'étape
  // « Aperçu » les montre.
  showGuides?: boolean;
  // Curseur de zoom (recadrage) — masqué par défaut ; seule l'étape « Aperçu »
  // de Design Shopify l'active.
  allowZoom?: boolean;
  // Sources proposées : les trois par défaut (admin). Design Shopify ne
  // propose que l'upload — pas la banque de visuels, réservée à l'admin.
  sourceModes?: SourceMode[];
  // Champ "Choisir un fichier" : affiché par défaut. L'étape « Aperçu » de
  // Design Shopify le masque (false) — le fichier est déjà choisi à
  // l'étape précédente, on ne fait qu'ajuster son cadrage ici.
  allowFileChange?: boolean;
  // Section "Aperçu" (positionnement/zoom/repères) : affichée par défaut.
  // L'étape « Visuel » de Design Shopify la masque (false) — le fichier s'y
  // choisit seulement, l'ajustement se fait à l'étape « Aperçu » suivante.
  showPreview?: boolean;
  // Calques additionnels (texte/image) de ce côté — voir lib/design/layers.ts
  // et le panneau qui les possède (LayersPanel, dans DesignPreview). Jamais
  // fournis par ProductForm (outil interne) : tableau vide par défaut.
  layers?: DesignLayer[];
  onChangeLayers?: (layers: DesignLayer[]) => void;
  // Seul le calque sélectionné (dans le panneau) se déplace au glisser sur
  // l'aperçu — sans sélection, glisser continue de repositionner le fond,
  // comme avant les calques.
  selectedLayerId?: string | null;
  // Sélection d'un calque en cliquant dessus dans l'aperçu (éditeur Fabric).
  onSelectLayer?: (id: string | null) => void;
  // Qui affiche et manipule les calques : l'aperçu actuel (« dom »), ou
  // Fabric.js (« fabric », voir FabricLayerCanvas). Les données et le rendu
  // imprimé sont les mêmes.
  layerEngine?: "dom" | "fabric";
  // Dimensions de la grille en mode mosaïque (sourceMode "mosaic") — choisies
  // une fois pour tout le design (voir DesignTypePicker), partagées entre
  // recto et verso : ignoré pour les autres modes.
  mosaicGrid?: { cols: number; rows: number };
  // Composition par volet d'un produit plié (sourceMode "mosaic") : les cases
  // sont les volets de ce côté (limites en fractions de la page, et leurs
  // noms), plutôt qu'une grille égale — voir panelCells (lib/folds.ts).
  panelCells?: { cols: number[]; rows: number[]; labels: string[] } | null;
  // Thème choisi (sourceMode "theme") — id envoyé au serveur pour la
  // génération finale (voir composeThemeImage) ; le nombre d'emplacements
  // vient de `value.themeSlotFiles.length` (déjà dimensionné par DesignTool).
  themeId?: string | null;
  // Géométrie (position/taille) de chaque emplacement, fixée par l'admin
  // (voir ThemeForm) — sert à positionner/clipper chaque photo à l'écran ;
  // le client ne peut que la déplacer/zoomer À L'INTÉRIEUR de ce rectangle
  // (voir `themeSlotAdjust` sur ImageSourceValue), jamais le déplacer lui-même.
  themeSlots?: ThemeSlot[];
  // Graphisme du thème (avec transparence) — affiché par-dessus les photos,
  // fixe, jamais déplaçable (comme frameOverlayUrl).
  themeOverlayUrl?: string | null;
  // Image de fond du thème (facultative) — sous les photos, fixe.
  themeBackgroundUrl?: string | null;
  // Emplacement actuellement sélectionné (glisser/zoomer l'affecte, lui et
  // pas les autres) — possédé par DesignPreview, comme selectedLayerId.
  selectedThemeSlot?: number | null;
  onSelectThemeSlot?: (index: number | null) => void;
}) {
  const { sourceMode, visualId, tileSizeMm, positionX, positionY } = value;
  const mosaicFiles = value.mosaicFiles ?? [];
  const themeSlotFiles = value.themeSlotFiles ?? [];
  const themeSlotAdjust = value.themeSlotAdjust ?? [];
  const themePhotoBank = value.themePhotoBank ?? [];
  const bankInputRef = useRef<HTMLInputElement>(null);
  const [bankDragOver, setBankDragOver] = useState(false);

  // Assigne la photo `bankIndex` de la banque à l'emplacement `slotIndex` —
  // c'est juste la MÊME référence de fichier posée dans le tableau, donc
  // rien n'empêche de la poser dans plusieurs emplacements à la fois.
  function assignBankFileToSlot(bankIndex: number, slotIndex: number) {
    const bankFile = themePhotoBank[bankIndex];
    if (!bankFile) return;
    const next = themeSlotFiles.slice();
    while (next.length <= slotIndex) next.push(null);
    next[slotIndex] = bankFile;
    onChange({ themeSlotFiles: next });
  }

  function clearThemeSlot(slotIndex: number) {
    const next = themeSlotFiles.slice();
    next[slotIndex] = null;
    onChange({ themeSlotFiles: next });
  }

  function addBankFiles(files: FileList | File[]) {
    onChange({ themePhotoBank: [...themePhotoBank, ...Array.from(files)] });
  }

  function removeBankFile(bankIndex: number) {
    const removed = themePhotoBank[bankIndex];
    const nextBank = themePhotoBank.filter((_, i) => i !== bankIndex);
    // Désassigne aussi cette photo des emplacements qui l'utilisaient
    // (même référence) — sinon un emplacement garderait une photo qu'on
    // vient pourtant de retirer de la banque.
    const nextSlots = themeSlotFiles.map((f) => (f === removed ? null : f));
    onChange({ themePhotoBank: nextBank, themeSlotFiles: nextSlots });
  }
  // Fichier réellement utilisé : celui choisi ici, sinon le PDF du recto.
  const file = value.file ?? (sourceMode === "upload" ? pairedPdf?.file ?? null : null);
  const pdfPage = value.file ? 1 : pairedPdf?.page ?? 1;
  const [preview, setPreview] = useState<string | null>(null);
  // Clé stable des réglages d'ombre, pour relancer l'aperçu quand ils changent.
  const shadowKey = JSON.stringify(logo?.shadow ?? null);

  // Le "cadre" (traits de coupe/sécurité, gabarit, logo) est un calque
  // transparent séparé du fond : il ne bouge jamais pendant le glisser.
  const [frameOverlayUrl, setFrameOverlayUrl] = useState<string | null>(null);
  const [frameLoading, setFrameLoading] = useState(false);
  const [frameError, setFrameError] = useState<string | null>(null);
  const frameTokenRef = useRef(0);

  // Le fond, lui, dépend du mode : en upload (image)/plein format, l'image
  // brute est affichée directement côté client (object-position instantané) ;
  // en mosaïque, ou pour un PDF uploadé (illisible tel quel par <img>), le
  // fond doit être rendu côté serveur (débouncé).
  const [renderedBackgroundUrl, setRenderedBackgroundUrl] = useState<string | null>(null);
  const [renderedBgLoading, setRenderedBgLoading] = useState(false);
  const [renderedBgError, setRenderedBgError] = useState<string | null>(null);
  const renderedBgTokenRef = useRef(0);

  const previewBoxRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [dragOffsetPx, setDragOffsetPx] = useState({ x: 0, y: 0 });

  // Taille réelle (px) de la boîte d'aperçu et de l'image affichée — pour
  // placer le fond par un calcul exact (position + zoom, y compris < 100 %)
  // plutôt que l'approximation object-position/transform d'origine, qui ne
  // suivait pas correctement le glisser une fois dézoomé.
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  const hasSource =
    sourceMode === "upload"
      ? Boolean(file || currentImageUrl)
      : sourceMode === "mosaic"
      ? mosaicFiles.some(Boolean)
      : sourceMode === "theme"
        ? // Contrairement à la mosaïque (rien à montrer sans au moins une
          // photo), un thème a toujours quelque chose à afficher dès qu'il
          // est choisi : son graphisme (cadre/décor) — les emplacements
          // vides restent simplement blancs dessous, voir composeThemeImage.
          Boolean(themeId)
        : Boolean(visualId);
  const canPosition = Boolean(template) && hasSource;
  // L'aperçu (et ses calques) s'affiche dès qu'un modèle est choisi, même
  // sans visuel de fond — un canvas blanc (voir plus bas), pour permettre un
  // montage fait seulement de calques (texte/image/forme). `canPosition`,
  // lui, reste réservé à ce qui n'a de sens qu'avec un fond réel (recentrer,
  // rendu du fond).
  const hasTemplate = Boolean(template);

  // Dépend de `hasTemplate`, pas `[]` : la boîte (previewBoxRef) n'existe
  // dans le DOM que quand `hasTemplate` est vrai (voir plus bas) — si ce
  // composant est monté AVANT qu'un modèle soit choisi, l'effet tournerait
  // une seule fois sur une ref encore nulle et ne se rebrancherait jamais —
  // boxSize resterait bloqué à {0,0}, et donc le zoom et le placement des
  // calques (qui en ont besoin) n'auraient plus aucun effet visible.
  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBoxSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasTemplate]);

  // Aperçu local du fichier uploadé (aperçu brut sous le champ + fond de
  // l'aperçu positionnable) — sauf pour un PDF, qu'une balise <img> ne peut
  // pas afficher : son aperçu est rendu côté serveur à la place (voir
  // l'effet ci-dessous).
  useEffect(() => {
    if (!file || isPdfFile(file)) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!template || !showGuides) {
      setFrameOverlayUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      setFrameError(null);
      return;
    }

    const token = ++frameTokenRef.current;
    const timeout = setTimeout(async () => {
      setFrameLoading(true);
      setFrameError(null);

      const formData = new FormData();
      formData.append("templateId", template.id);
      if (grant) formData.append("grant", grant);
      formData.append("mode", "frame");
      formData.append("side", side);
      formData.append("rotated", String(rotated));
      // Sans ce drapeau, le serveur suppose que le logo est affiché : décocher
      // « Afficher le logo » ne le retirait pas de l'aperçu.
      formData.append("showLogo", String(logo !== null));
      if (logo) {
        formData.append("logoShape", logo.shape);
        formData.append("logoColor", logo.color);
        formData.append("logoSecondaryColor", logo.secondaryColor);
        formData.append("logoShadow", String(logo.shadow !== null));
        if (logo.shadow) {
          formData.append("logoShadowBlur", String(logo.shadow.blur));
          formData.append("logoShadowDistance", String(logo.shadow.distance));
          formData.append("logoShadowAngle", String(logo.shadow.angle));
          formData.append("logoShadowOpacity", String(logo.shadow.opacity));
        }
      }

      let body: FormData;
      try {
        body = await stageLargeFiles(formData);
      } catch (err) {
        if (token !== frameTokenRef.current) return;
        setFrameError(err instanceof Error ? err.message : "Erreur lors de la génération du cadre.");
        setFrameLoading(false);
        return;
      }
      const res = await fetch("/api/products/preview", { method: "POST", body });
      if (token !== frameTokenRef.current) return;

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFrameError(data.error ?? "Erreur lors de la génération du cadre.");
        setFrameLoading(false);
        return;
      }
      const blob = await res.blob();
      setFrameOverlayUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
      setFrameLoading(false);
    }, 150);

    return () => clearTimeout(timeout);
  }, [template, side, rotated, logo?.shape, logo?.color, logo?.secondaryColor, shadowKey, showGuides]);

  useEffect(() => {
    return () => {
      if (frameOverlayUrl) URL.revokeObjectURL(frameOverlayUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isPdfUpload = sourceMode === "upload" && isPdfFile(file);
  const isMosaic = sourceMode === "mosaic";
  const isTheme = sourceMode === "theme";
  const mosaicCellAdjust = value.mosaicCellAdjust ?? [];
  // Cases cadrables de l'aperçu : les emplacements du thème, ou les cases de
  // la mosaïque, qui sont des emplacements comme les autres, simplement tirés
  // de la grille. Même affichage, même glisser, même zoom pour les deux ; le
  // serveur recadre ensuite de la même façon (composeThemeImage /
  // composeMosaicImage).
  const panelSlots: ThemeSlot[] | null =
    isMosaic && panelCells
      ? Array.from({ length: (panelCells.cols.length - 1) * (panelCells.rows.length - 1) }, (_, i) => {
          const c = i % (panelCells.cols.length - 1);
          const r = Math.floor(i / (panelCells.cols.length - 1));
          const [x0, x1] = [panelCells.cols[c], panelCells.cols[c + 1]];
          const [y0, y1] = [panelCells.rows[r], panelCells.rows[r + 1]];
          return { positionX: (x0 + x1) / 2, positionY: (y0 + y1) / 2, widthRatio: x1 - x0, heightRatio: y1 - y0 };
        })
      : null;
  const slots: ThemeSlot[] = isTheme
    ? themeSlots
    : panelSlots
    ? panelSlots
    : isMosaic
    ? Array.from({ length: mosaicGrid.cols * mosaicGrid.rows }, (_, i) => ({
        positionX: ((i % mosaicGrid.cols) + 0.5) / mosaicGrid.cols,
        positionY: (Math.floor(i / mosaicGrid.cols) + 0.5) / mosaicGrid.rows,
        widthRatio: 1 / mosaicGrid.cols,
        heightRatio: 1 / mosaicGrid.rows,
      }))
    : [];
  const slotFiles = isTheme ? themeSlotFiles : isMosaic ? mosaicFiles : [];
  const slotAdjust = isTheme ? themeSlotAdjust : mosaicCellAdjust;
  // Le champ d'ImageSourceValue qui garde le cadrage des cases affichées.
  const slotAdjustField = isTheme ? "themeSlotAdjust" : "mosaicCellAdjust";
  // Clé stable des fichiers de mosaïque/thème (par nom+taille, comme
  // imageLayerFilesKey plus bas) : `mosaicFiles`/`themeSlotFiles` sont de
  // nouveaux tableaux à chaque patch, une dépendance d'effet sur leur
  // référence relancerait le rendu serveur en continu sans rien avoir
  // réellement changé.
  const mosaicFilesKey = mosaicFiles.map((f) => (f ? `${f.name}:${f.size}` : "")).join("|");
  const themeSlotFilesKey = themeSlotFiles.map((f) => (f ? `${f.name}:${f.size}` : "")).join("|");
  const slotFilesKey = isTheme ? `theme:${themeSlotFilesKey}` : isMosaic ? `mosaic:${mosaicFilesKey}` : "";

  useEffect(() => {
    // Un thème n'a plus besoin de ce rendu serveur : chaque photo s'affiche
    // directement (comme le fond simple), positionnée/clippée dans son
    // emplacement côté client — voir le bloc de rendu dédié plus bas. Seul
    // le graphisme final (recto imprimé, mockup) repasse par le serveur
    // (composeThemeImage), avec l'ajustement du client (themeSlotAdjust).
    // La mosaïque, pareil : ses cases sont cadrées côté client.
    if (!((sourceMode === "tile" || isPdfUpload) && canPosition && template)) {
      setRenderedBackgroundUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      setRenderedBgError(null);
      return;
    }

    const token = ++renderedBgTokenRef.current;
    const timeout = setTimeout(async () => {
      setRenderedBgLoading(true);
      setRenderedBgError(null);

      const formData = new FormData();
      formData.append("templateId", template.id);
      if (grant) formData.append("grant", grant);
      if (isMosaic) {
        formData.append("mosaicCols", String(mosaicGrid.cols));
        formData.append("mosaicRows", String(mosaicGrid.rows));
        mosaicFiles.forEach((f, i) => {
          if (f) formData.append(`mosaicCell${i}`, f);
        });
      } else if (isPdfUpload && file) {
        formData.append("image", file);
        formData.append("pdfPage", String(pdfPage));
      } else {
        formData.append("visualId", visualId);
        formData.append("visualMode", "tile");
        formData.append("tileSizeMm", String(tileSizeMm));
      }
      formData.append("positionX", String(positionX));
      formData.append("positionY", String(positionY));
      formData.append("mode", "background");
      formData.append("rotated", String(rotated));

      // Photos lourdes déposées directement dans le stockage (voir
      // lib/design/stageUpload.ts) : une requête de plus de 4,5 Mo serait
      // refusée par Vercel.
      let body: FormData;
      try {
        body = await stageLargeFiles(formData);
      } catch (err) {
        if (token !== renderedBgTokenRef.current) return;
        setRenderedBgError(err instanceof Error ? err.message : "Erreur lors de la génération de l'aperçu.");
        setRenderedBgLoading(false);
        return;
      }
      const res = await fetch("/api/products/preview", { method: "POST", body });
      if (token !== renderedBgTokenRef.current) return;

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRenderedBgError(data.error ?? "Erreur lors de la génération de l'aperçu.");
        setRenderedBgLoading(false);
        return;
      }
      const blob = await res.blob();
      setRenderedBackgroundUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
      setRenderedBgLoading(false);
    }, 400);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sourceMode,
    isMosaic,
    mosaicFilesKey,
    mosaicGrid.cols,
    mosaicGrid.rows,
    isPdfUpload,
    file,
    pdfPage,
    canPosition,
    template,
    rotated,
    visualId,
    tileSizeMm,
    positionX,
    positionY,
  ]);

  useEffect(() => {
    return () => {
      if (renderedBackgroundUrl) URL.revokeObjectURL(renderedBackgroundUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setDragOffsetPx({ x: 0, y: 0 });
  }, [renderedBackgroundUrl]);

  function handleVisualChange(id: string) {
    onChange({ visualId: id, positionX: 0.5, positionY: 0.5, scale: undefined, rotation: 0 });
  }

  function recenter() {
    // `scale: undefined` (plutôt que 1) relance l'effet ci-dessous qui
    // recalcule le zoom "on voit tout le visuel" pour l'image courante,
    // quand le zoom est réglable (voir son commentaire) — pour l'admin
    // (zoom non réglable), c'est équivalent à 1, comme avant. Ne touche pas
    // à la rotation : un choix délibéré, contrairement au cadrage.
    onChange({ positionX: 0.5, positionY: 0.5, scale: undefined });
    setDragOffsetPx({ x: 0, y: 0 });
  }

  // Éditeur Fabric : vrai pendant un clic sur un calque (le canevas le
  // déplace lui-même) — l'aperçu ne doit alors pas déplacer le fond.
  const fabricHitRef = useRef(false);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (layerEngine === "fabric" && fabricHitRef.current) return;
    draggingRef.current = true;
    lastPointRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !lastPointRef.current || !previewBoxRef.current) return;
    const rect = previewBoxRef.current.getBoundingClientRect();
    const dxPx = e.clientX - lastPointRef.current.x;
    const dyPx = e.clientY - lastPointRef.current.y;
    lastPointRef.current = { x: e.clientX, y: e.clientY };
    const dx = dxPx / rect.width;
    const dy = dyPx / rect.height;

    // Un calque sélectionné capte le glisser à sa place (suit directement le
    // curseur) plutôt que le fond (qui, lui, recadre — glisser à droite
    // révèle la gauche de l'image, l'inverse d'un déplacement direct).
    const selectedLayer =
      onChangeLayers && layerEngine === "dom" ? layers.find((l) => l.id === selectedLayerId) : undefined;
    if (selectedLayer && onChangeLayers) {
      onChangeLayers(
        layers.map((l) =>
          l.id === selectedLayer.id
            ? { ...l, positionX: Math.min(1, Math.max(0, l.positionX + dx)), positionY: Math.min(1, Math.max(0, l.positionY + dy)) }
            : l
        )
      );
      return;
    }

    // Thème : l'emplacement sélectionné recadre SA photo (même sens que le
    // fond simple — glisser à droite révèle la gauche de la photo), mais
    // normalisé par la taille de SON rectangle, pas toute la page (une
    // photo dans un petit emplacement doit suivre le curseur à la même
    // vitesse "relative" qu'une grande, pas à la même vitesse en pixels).
    // Sans emplacement sélectionné, rien à glisser en mode thème — pas de
    // fond à recadrer (voir composeThemeImage, toujours du blanc).
    if (isTheme || isMosaic) {
      if (selectedThemeSlot !== null && slots[selectedThemeSlot]) {
        const slot = slots[selectedThemeSlot];
        const slotWidthPx = slot.widthRatio * rect.width;
        const slotHeightPx = slot.heightRatio * rect.height;
        const slotDx = dxPx / slotWidthPx;
        const slotDy = dyPx / slotHeightPx;
        const current = slotAdjust[selectedThemeSlot] ?? { positionX: 0.5, positionY: 0.5, scale: 1 };
        const next = slotAdjust.slice();
        while (next.length <= selectedThemeSlot) next.push({ positionX: 0.5, positionY: 0.5, scale: 1 });
        next[selectedThemeSlot] = {
          ...current,
          positionX: Math.min(1, Math.max(0, current.positionX - slotDx)),
          positionY: Math.min(1, Math.max(0, current.positionY - slotDy)),
        };
        onChange({ [slotAdjustField]: next });
      }
      return;
    }

    setDragOffsetPx((o) => ({ x: o.x + dxPx, y: o.y + dyPx }));
    onChange({
      positionX: Math.min(1, Math.max(0, positionX - dx)),
      positionY: Math.min(1, Math.max(0, positionY - dy)),
    });
  }

  function handlePointerUp() {
    draggingRef.current = false;
    lastPointRef.current = null;
  }

  // Aperçu (URL objet) de chaque calque image — recalculé seulement quand
  // l'ensemble des fichiers change (clé dérivée), pas à chaque rendu, pour
  // ne pas fuiter des URL objet en continu pendant qu'on glisse un calque.
  const [layerImageUrls, setLayerImageUrls] = useState<Record<string, string>>({});
  const imageLayerFilesKey = layers
    .filter((l): l is ImageLayer => l.type === "image")
    .map((l) => `${l.id}:${l.file?.name ?? ""}:${l.file?.size ?? 0}`)
    .join("|");
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const l of layers) {
      if (l.type === "image" && l.file) next[l.id] = URL.createObjectURL(l.file);
    }
    setLayerImageUrls(next);
    return () => {
      Object.values(next).forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageLayerFilesKey]);

  // Aperçu (URL objet) de chaque photo de thème — même principe que
  // layerImageUrls ci-dessus, recalculé seulement quand l'ensemble des
  // fichiers change (themeSlotFilesKey, déjà dérivé plus haut).
  const [themeSlotPreviewUrls, setThemeSlotPreviewUrls] = useState<(string | null)[]>([]);
  useEffect(() => {
    // Un PDF (fichier fini déposé dans un volet) s'affiche par sa première
    // page, rendue par le serveur (voir filePreviewUrl) ; une image, telle quelle.
    let cancelled = false;
    const created: string[] = [];
    Promise.all(
      slotFiles.map((f) => (f && template ? filePreviewUrl(f, { templateId: template.id, grant }) : Promise.resolve(null)))
    ).then((urls) => {
      urls.forEach((u, i) => {
        const f = slotFiles[i];
        if (u && f && !isPdfFile(f)) created.push(u);
      });
      if (cancelled) created.forEach((u) => URL.revokeObjectURL(u));
      else setThemeSlotPreviewUrls(urls);
    });
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotFilesKey]);

  // Taille naturelle de chaque photo de thème (indispensable au calcul de
  // cadrage "cover" par emplacement, voir themeSlotGeometry) — remise à zéro
  // à chaque changement de fichiers (une nouvelle photo n'a pas encore de
  // taille connue tant que son <img> n'a pas fini de charger, voir onLoad).
  const [themeSlotNaturalSizes, setThemeSlotNaturalSizes] = useState<Record<number, { width: number; height: number }>>(
    {}
  );
  useEffect(() => {
    setThemeSlotNaturalSizes({});
  }, [slotFilesKey]);

  // Géométrie (position/taille en px, dans la boîte d'aperçu) de chaque
  // emplacement — même formule que backgroundGeometry, mais sa "boîte" est
  // le rectangle de l'emplacement (voir ThemeSlot), pas toute la page.
  function themeSlotGeometry(index: number) {
    const slot = slots[index];
    const natural = themeSlotNaturalSizes[index];
    if (!slot || !natural || boxSize.width === 0 || boxSize.height === 0) return null;
    const slotWidthPx = slot.widthRatio * boxSize.width;
    const slotHeightPx = slot.heightRatio * boxSize.height;
    const slotLeftPx = slot.positionX * boxSize.width - slotWidthPx / 2;
    const slotTopPx = slot.positionY * boxSize.height - slotHeightPx / 2;
    const adjust = slotAdjust[index] ?? { positionX: 0.5, positionY: 0.5, scale: 1 };
    const coverScale = Math.max(slotWidthPx / natural.width, slotHeightPx / natural.height);
    const scale = coverScale * Math.max(0.1, adjust.scale);
    const boundingWidth = natural.width * scale;
    const boundingHeight = natural.height * scale;
    const boundingLeft = (slotWidthPx - boundingWidth) * adjust.positionX;
    const boundingTop = (slotHeightPx - boundingHeight) * adjust.positionY;
    return {
      slotLeftPx,
      slotTopPx,
      slotWidthPx,
      slotHeightPx,
      imgWidth: boundingWidth,
      imgHeight: boundingHeight,
      imgLeft: boundingLeft,
      imgTop: boundingTop,
    };
  }

  const pageAspectRatio = template
    ? (template.width_mm + template.bleed_mm * 2) / (template.height_mm + template.bleed_mm * 2)
    : 1;
  // Pixels d'aperçu par mm de page (fond perdu compris) — convertit la
  // taille de police d'un calque texte (en mm, comme le reste du modèle) en
  // pixels d'écran pour cette boîte précise.
  const pxPerMm = template && boxSize.width > 0 ? boxSize.width / (template.width_mm + template.bleed_mm * 2) : 0;
  const maxFontSizeMm = maxTextSizeMmForTemplate(template);
  const selectedVisual = visuals.find((v) => v.id === visualId) ?? null;
  const rawBackgroundUrl =
    sourceMode === "upload"
      ? preview ?? currentImageUrl ?? null
      : sourceMode === "full"
      ? selectedVisual?.fileUrl ?? null
      : null;
  const backgroundUrl =
    sourceMode === "tile" || isPdfUpload ? renderedBackgroundUrl ?? rawBackgroundUrl : rawBackgroundUrl;
  const previewLoading = frameLoading || ((sourceMode === "tile" || isPdfUpload) && renderedBgLoading);
  const previewError = frameError ?? (sourceMode === "tile" || isPdfUpload ? renderedBgError : null);

  // Nouvelle image : la taille naturelle connue ne vaut plus rien tant que
  // la nouvelle n'a pas fini de charger (onLoad, plus bas).
  useEffect(() => {
    setNaturalSize(null);
  }, [backgroundUrl]);

  // Pas de zoom par défaut calculé : `scale` indéfini retombe sur 1 (cadrage
  // "cover", voir `value.scale ?? 1` plus bas et dans backgroundGeometry) —
  // le visuel couvre toute la zone d'impression par défaut, comme
  // "Maximiser l'espace" (voir DesignPreview), pour ne pas déclencher son
  // alerte de bordure blanche sans que le client ait rien touché. Un ancien
  // comportement calculait ici le zoom "on voit tout le visuel en entier"
  // (letterboxé) par défaut ; abandonné, remplacé par ce choix inverse.

  // Géométrie exacte du fond (hors mosaïque) : reproduit très précisément le
  // calcul serveur (coverCropToBuffer — cover-fit × zoom, puis positionné
  // selon positionX/Y), plutôt que l'ancienne approximation CSS
  // object-position + transform:scale, qui ne suivait plus correctement le
  // point focal une fois zoomée en dessous de 100 % (dézoomée).
  //
  // Rotation (voir `rotation` sur ImageSourceValue) : l'élément <img> tourne
  // sur lui-même (`transform: rotate(...)`), sans changer ses propres
  // largeur/hauteur — son centre doit donc coïncider avec celui de la boîte
  // "effective" (post-rotation) calculée normalement, pas avec celle-ci
  // elle-même. À 90°/270°, cette boîte effective a largeur/hauteur
  // échangées par rapport à l'image telle que chargée (`naturalSize`) ; à
  // 0°/180°, rien à échanger, et la formule retombe exactement sur celle
  // d'avant la rotation.
  const backgroundGeometry =
    naturalSize && boxSize.width > 0 && boxSize.height > 0
      ? (() => {
          const zoom = value.scale ?? 1;
          const rotation = value.rotation ?? 0;
          const swapped = rotation % 180 === 90;
          const effW = swapped ? naturalSize.height : naturalSize.width;
          const effH = swapped ? naturalSize.width : naturalSize.height;
          const coverScale = Math.max(boxSize.width / effW, boxSize.height / effH);
          const scale = coverScale * Math.max(0.1, zoom);
          const boundingWidth = effW * scale;
          const boundingHeight = effH * scale;
          const boundingLeft = (boxSize.width - boundingWidth) * positionX;
          const boundingTop = (boxSize.height - boundingHeight) * positionY;
          const width = naturalSize.width * scale;
          const height = naturalSize.height * scale;
          return {
            width,
            height,
            left: boundingLeft + boundingWidth / 2 - width / 2,
            top: boundingTop + boundingHeight / 2 - height / 2,
            rotation,
          };
        })()
      : null;

  const availableSourceModes = SOURCE_MODES.filter((m) => sourceModes.includes(m.value));

  return (
    <div className="space-y-4">
      {/* Un seul mode possible (Design Shopify : upload seulement) : pas de
          bascule à afficher, rien à choisir. */}
      {availableSourceModes.length > 1 && (
        <div>
          <label className="mb-1 block text-sm font-medium">Source de l&apos;image</label>
          <div className="flex rounded-lg border border-neutral-300 p-0.5 text-sm">
            {availableSourceModes.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => onChange({ sourceMode: m.value, positionX: 0.5, positionY: 0.5 })}
                className={`flex-1 rounded-md px-2 py-1.5 ${
                  sourceMode === m.value
                    ? "bg-pico-black text-white"
                    : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {sourceMode === "upload" ? (
        allowFileChange && (
          <div>
            <label className="block text-sm font-medium">
              Image arrière-plan {currentImageUrl ? "(laisser vide pour garder l'actuelle)" : ""}
            </label>
            <div className="mt-1">
              <FileDropZone
                file={file}
                onFileChange={(f) => onChange({ file: f, positionX: 0.5, positionY: 0.5, scale: undefined, rotation: 0 })}
                accept="image/*,application/pdf"
                // Pour un PDF, `backgroundUrl` est déjà le rendu serveur de sa
                // page (voir renderedBackgroundUrl plus haut — calculé que
                // showPreview soit affiché ou non) : un vrai aperçu visuel
                // plutôt que rien tant que le rendu n'est pas prêt.
                previewUrl={isPdfUpload ? backgroundUrl : preview ?? currentImageUrl ?? null}
                helpText={
                  isPdfUpload
                    ? `📄 PDF${pdfPage > 1 ? ` (page ${pdfPage}, recto)` : ""} — sera converti en image`
                    : undefined
                }
              />
            </div>
          </div>
        )
      ) : isMosaic ? (
        allowFileChange && (
          <div>
            <label className="block text-sm font-medium">
              {panelCells ? "Un fichier par volet" : `Photos (${mosaicGrid.cols}×${mosaicGrid.rows})`}
            </label>
            {panelCells && (
              <p className="mt-0.5 text-xs text-text-subtle">Photo ou fichier fini (image ou PDF), cadré dans son volet.</p>
            )}
            <div
              className="mt-1 grid gap-1.5"
              style={{ gridTemplateColumns: `repeat(${panelCells ? Math.min(4, mosaicGrid.cols * mosaicGrid.rows) : mosaicGrid.cols}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: mosaicGrid.cols * mosaicGrid.rows }, (_, i) => (
                <MosaicCellDropZone
                  key={i}
                  label={panelCells?.labels[i]}
                  acceptPdf={Boolean(panelCells)}
                  previewUrl={panelCells ? themeSlotPreviewUrls[i] ?? null : undefined}
                  file={mosaicFiles[i] ?? null}
                  onFileChange={(f) => {
                    const next = mosaicFiles.slice(0, mosaicGrid.cols * mosaicGrid.rows);
                    while (next.length < mosaicGrid.cols * mosaicGrid.rows) next.push(null);
                    next[i] = f;
                    onChange({ mosaicFiles: next });
                  }}
                />
              ))}
            </div>
          </div>
        )
      ) : isTheme ? (
        allowFileChange && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium">Banque de photos</label>
              <input
                ref={bankInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) addBankFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              {/* Vraie zone de glisser-déposer (comme FileDropZone) — dépose
                  des fichiers depuis le bureau, contrairement aux cases
                  ci-dessous et aux emplacements, qui reçoivent une photo
                  DÉJÀ dans la banque (glisser-déposer interne, voir
                  ThemeBankThumbnail/ThemeSlotDropTarget). Toujours visible
                  (pas seulement quand la banque est vide) : on peut ajouter
                  des photos à tout moment. */}
              <div
                onClick={() => bankInputRef.current?.click()}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes("Files")) return;
                  e.preventDefault();
                  setBankDragOver(true);
                }}
                onDragLeave={() => setBankDragOver(false)}
                onDrop={(e) => {
                  if (e.dataTransfer.files.length === 0) return;
                  e.preventDefault();
                  setBankDragOver(false);
                  addBankFiles(e.dataTransfer.files);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    bankInputRef.current?.click();
                  }
                }}
                className={`mt-1 flex cursor-pointer items-center justify-center gap-2.5 rounded-xl border-2 border-dashed px-4 py-4 text-center transition-colors ${
                  bankDragOver ? "border-primary bg-primary-subtle" : "border-border-strong bg-surface hover:border-text-subtle"
                }`}
              >
                <UploadIcon className="h-4 w-4 shrink-0 text-text-subtle" />
                <span className="text-sm font-medium text-text-subtle">Glisse des photos ici, ou clique pour en ajouter</span>
              </div>
              {themePhotoBank.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {themePhotoBank.map((f, i) => (
                    <ThemeBankThumbnail key={i} file={f} bankIndex={i} onRemove={() => removeBankFile(i)} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium">Emplacements ({themeSlotFiles.length})</label>
              <div className="mt-1 grid grid-cols-3 gap-1.5">
                {themeSlotFiles.map((f, i) => (
                  <ThemeSlotDropTarget
                    key={i}
                    index={i}
                    file={f}
                    onDropBankIndex={(bankIndex) => assignBankFileToSlot(bankIndex, i)}
                    onClear={() => clearThemeSlot(i)}
                  />
                ))}
              </div>
            </div>
            <p className="text-xs text-neutral-500">
              Glisse une photo de la banque dans un emplacement — la même photo peut servir à plusieurs
              emplacements.
            </p>
          </div>
        )
      ) : visuals.length === 0 ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Aucun visuel dans la banque. Ajoutes-en d&apos;abord dans{" "}
          <a href="/visuals" className="underline">
            Banque de visuels
          </a>
          .
        </p>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium">Visuel</label>
            <VisualPicker visuals={visuals} value={visualId} onChange={handleVisualChange} />
          </div>

          {sourceMode === "tile" && (
            <div>
              <label className="block text-sm font-medium">Taille de répétition (zoom)</label>
              <div className="mt-1 flex items-center gap-3">
                <span className="text-xs text-neutral-400" aria-hidden="true">
                  −
                </span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={0.1}
                  value={tileSizeInToZoom(mmToIn(tileSizeMm))}
                  onChange={(e) =>
                    onChange({ tileSizeMm: inToMm(zoomToTileSizeIn(parseFloat(e.target.value))) })
                  }
                  className="flex-1"
                  aria-label="Zoom sur le motif (taille de répétition)"
                />
                <span className="text-sm text-neutral-400" aria-hidden="true">
                  +
                </span>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="100"
                  value={Math.round(tileSizeInToZoom(mmToIn(tileSizeMm)))}
                  onChange={(e) =>
                    onChange({
                      tileSizeMm: inToMm(zoomToTileSizeIn(Math.min(100, Math.max(1, parseFloat(e.target.value) || 1)))),
                    })
                  }
                  className="w-16 shrink-0 rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {showPreview && (
      <div>
        {/* En-tête « Aperçu » : seulement dans l'admin. L'Outil Shopify
            (previewSize "lg") n'a que la page, qui prend toute la place. */}
        {previewSize !== "lg" && (
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            Aperçu
            {previewLoading && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-neutral-400">
                <SpinnerIcon className="h-3.5 w-3.5" /> génération...
              </span>
            )}
          </label>
          {/* Admin (ProductForm) : seul endroit où "Recentrer" vit encore
              ici — l'étape « Aperçu » de Design Shopify (allowZoom) a ses
              propres boutons (Zoom/Remplir l'espace/Pivoter/Recentrer),
              rendus par DesignPreview en barre latérale, pas ici. */}
          {canPosition && !allowZoom && (
            <button
              type="button"
              onClick={recenter}
              className="text-xs text-neutral-500 underline hover:text-pico-black"
            >
              Recentrer
            </button>
          )}
        </div>
        )}
        {previewError && <p className="mt-1 text-sm text-red-600">{previewError}</p>}
        {hasTemplate ? (
          // Cadre gris autour de la page : seulement dans l'admin. Dans l'Outil
          // Shopify, sa marge prendrait sur la place de la page (voir fitBox).
          <div className={previewSize === "lg" ? "" : "mt-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"}>
            <div
              ref={previewBoxRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              // Blanc (pas gris) : sert de "papier" au montage tant qu'aucun
              // visuel de fond n'est choisi — un choix délibéré, pas juste un
              // état de chargement transitoire (voir la demande : pouvoir
              // composer uniquement avec des calques).
              className={`relative mx-auto touch-none select-none overflow-hidden border border-neutral-200 bg-white cursor-grab active:cursor-grabbing ${
                previewSize === "lg" ? "" : "w-full max-w-xs"
              }`}
              style={
                previewSize === "lg" && fitBox && fitBox.width > 0 && fitBox.height > 0
                  ? // La plus grande page qui tienne dans la place libre : la
                    // contrainte la plus serrée entre sa largeur et sa hauteur.
                    {
                      aspectRatio: String(pageAspectRatio),
                      width: Math.floor(Math.min(fitBox.width, fitBox.height * pageAspectRatio)),
                    }
                  : previewSize === "lg"
                  ? // Bornée en largeur ET en hauteur en gardant le ratio de la
                    // page : `min()` choisit la contrainte la plus serrée entre
                    // 100 % du conteneur et l'équivalent largeur de 60 % de la
                    // hauteur de la fenêtre — sans ce second plafond, un très
                    // grand écran étirerait la page à une hauteur excessive.
                    { aspectRatio: String(pageAspectRatio), width: `min(100%, calc(60vh * ${pageAspectRatio}))` }
                  : { aspectRatio: String(pageAspectRatio) }
              }
            >
              {/* Fond : bouge pendant le glisser, le cadre (ci-dessous) reste fixe. */}
              {backgroundUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={backgroundUrl}
                  alt=""
                  draggable={false}
                  onLoad={(e) =>
                    setNaturalSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
                  }
                  className={
                    sourceMode === "tile" || isMosaic || !backgroundGeometry
                      ? "absolute inset-0 h-full w-full object-cover"
                      : "absolute max-w-none"
                  }
                  style={
                    sourceMode === "tile"
                      ? { transform: `translate(${dragOffsetPx.x}px, ${dragOffsetPx.y}px)` }
                      : isMosaic
                      ? // Déjà composée à la taille exacte de la page (voir
                        // composeMosaicImage) : pas de zoom/position/rotation
                        // à appliquer ici, contrairement au fond simple.
                        undefined
                      : backgroundGeometry
                      ? {
                          width: backgroundGeometry.width,
                          height: backgroundGeometry.height,
                          left: backgroundGeometry.left,
                          top: backgroundGeometry.top,
                          transform: backgroundGeometry.rotation ? `rotate(${backgroundGeometry.rotation}deg)` : undefined,
                        }
                      : // Repli le temps que l'image/la boîte ne sont pas encore
                        // mesurées (avant le premier onLoad) : approximatif, remplacé
                        // dès que backgroundGeometry est calculable.
                        { objectPosition: `${positionX * 100}% ${positionY * 100}%` }
                  }
                />
              )}
              {/* Thème : chaque photo, clippée à son emplacement (voir
                  ThemeSlot), déplaçable/zoomable individuellement — celui
                  sélectionné (cadre plein) capte le glisser (voir
                  handlePointerMove) ; le graphisme (avec transparence)
                  vient par-dessus toutes les photos, fixe. */}
              {isTheme && themeBackgroundUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={themeBackgroundUrl}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                />
              )}
              {(isTheme || isMosaic) &&
                boxSize.width > 0 &&
                slots.map((slot, i) => {
                  const geometry = themeSlotGeometry(i);
                  const url = themeSlotPreviewUrls[i];
                  const isSelected = selectedThemeSlot === i;
                  const slotWidthPx = slot.widthRatio * boxSize.width;
                  const slotHeightPx = slot.heightRatio * boxSize.height;
                  const slotLeftPx = slot.positionX * boxSize.width - slotWidthPx / 2;
                  const slotTopPx = slot.positionY * boxSize.height - slotHeightPx / 2;
                  // Emplacement en cercle ou en polygone (voir
                  // lib/themeShapes.ts) : la photo est découpée en clip-path,
                  // et le contour suit la forme (un SVG à côté : le clip-path
                  // couperait aussi un `outline`).
                  const shaped = slotShape(slot) !== "rect";
                  return (
                    <Fragment key={i}>
                    <div
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onSelectThemeSlot?.(i);
                        handlePointerDown(e);
                      }}
                      // Dépose directement dans le grand aperçu (en plus des
                      // petits emplacements de la barre latérale, voir
                      // ThemeSlotDropTarget) — même mécanique (drag-and-drop
                      // natif depuis ThemeBankThumbnail).
                      onDragOver={
                        isTheme
                          ? (e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "copy";
                            }
                          : undefined
                      }
                      onDrop={
                        isTheme
                          ? (e) => {
                              e.preventDefault();
                              const bankIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
                              if (Number.isFinite(bankIndex)) assignBankFileToSlot(bankIndex, i);
                            }
                          : undefined
                      }
                      className="absolute cursor-move overflow-hidden"
                      style={{
                        left: slotLeftPx,
                        top: slotTopPx,
                        width: slotWidthPx,
                        height: slotHeightPx,
                        outline: shaped ? undefined : isSelected ? "2px solid var(--accent)" : "1px dashed rgba(0,0,0,0.25)",
                        outlineOffset: -1,
                        clipPath: slotClipPath(slot),
                        // Masque SVG fourni par l'admin (forme « svg »).
                        ...slotMaskStyle(slot),
                      }}
                    >
                      {url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt=""
                          draggable={false}
                          onLoad={(e) => {
                            // `currentTarget` peut arriver `null` ici : deux
                            // photos uploadées coup sur coup changent `url`
                            // (nouvelle URL objet, voir l'effet plus haut)
                            // avant que le `onLoad` de la précédente n'ait eu
                            // le temps de se déclencher — un `load` tardif
                            // sur un élément déjà remplacé, sans conséquence
                            // à ignorer plutôt qu'à planter dessus.
                            const img = e.currentTarget;
                            if (!img) return;
                            setThemeSlotNaturalSizes((prev) => ({
                              ...prev,
                              [i]: { width: img.naturalWidth, height: img.naturalHeight },
                            }));
                          }}
                          className="absolute max-w-none"
                          style={
                            geometry
                              ? { width: geometry.imgWidth, height: geometry.imgHeight, left: geometry.imgLeft, top: geometry.imgTop }
                              : { width: "100%", height: "100%", objectFit: "cover" }
                          }
                        />
                      )}
                    </div>
                    {shaped && (
                      <svg
                        aria-hidden="true"
                        className="pointer-events-none absolute overflow-visible"
                        style={{ left: slotLeftPx, top: slotTopPx, width: slotWidthPx, height: slotHeightPx }}
                        viewBox={`0 0 ${slotWidthPx} ${slotHeightPx}`}
                        fill="none"
                        stroke={isSelected ? "var(--accent)" : "rgba(0,0,0,0.25)"}
                        strokeWidth={isSelected ? 2 : 1}
                        strokeDasharray={isSelected ? undefined : "4 3"}
                        dangerouslySetInnerHTML={{ __html: slotSvgShape(slot, slotWidthPx, slotHeightPx) }}
                      />
                    )}
                    </Fragment>
                  );
                })}
              {isTheme && themeOverlayUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={themeOverlayUrl}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                />
              )}
              {/* Calques (texte/image) : entre le fond et le cadre — visibles
                  par-dessus le visuel, mais les traits de coupe/sécurité
                  restent lisibles par-dessus eux (simple repère, jamais sur
                  le produit fini). Le calque sélectionné (pointillés) est
                  celui que le glisser déplace, voir handlePointerMove. */}
              {boxSize.width > 0 && layerEngine === "fabric" && onChangeLayers && (
                <FabricLayerCanvas
                  layers={layers}
                  selectedLayerId={selectedLayerId}
                  onChangeLayers={onChangeLayers}
                  onSelectLayer={onSelectLayer}
                  width={boxSize.width}
                  height={boxSize.height}
                  pxPerMm={pxPerMm}
                  imageUrls={layerImageUrls}
                  maxFontSizeMm={maxFontSizeMm}
                  hitRef={fabricHitRef}
                />
              )}
              {boxSize.width > 0 &&
                layerEngine === "dom" &&
                layers.map((designLayer) => {
                  const isSelected = selectedLayerId === designLayer.id;
                  const rotationDeg = designLayer.rotationDeg ?? 0;
                  // Conteneur externe : centré/tourné sur (positionX, positionY) —
                  // les poignées (à l'intérieur, voir LayerHandles) héritent de
                  // cette rotation automatiquement, sans calcul dédié pour leur
                  // affichage (seul leur *comportement* au glisser en a besoin,
                  // via getBoundingClientRect). Opacité et fondu vivent aussi ici
                  // (pas sur le contenu, un cran plus bas) : `mix-blend-mode` ne
                  // se fond pas correctement avec ce qu'il y a dessous quand il
                  // est porté par un élément dont le PARENT (pas lui-même) a un
                  // `transform` — vérifié empiriquement (Chrome). Les deux
                  // doivent être sur le même élément que la rotation.
                  if (designLayer.type === "text") {
                    const font = fontOptionById(designLayer.fontId);
                    const fontSizePx = designLayer.fontSizeMm * pxPerMm;
                    const strokeWidthPx = designLayer.strokeWidthMm ? designLayer.strokeWidthMm * pxPerMm : 0;
                    const letterSpacingPx = designLayer.letterSpacingMm ? designLayer.letterSpacingMm * pxPerMm : 0;
                    return (
                      <div
                        key={designLayer.id}
                        className="absolute"
                        style={{
                          left: designLayer.positionX * boxSize.width,
                          top: designLayer.positionY * boxSize.height,
                          transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
                          opacity: designLayer.opacity ?? 1,
                          mixBlendMode: (designLayer.blendMode ?? "normal") as React.CSSProperties["mixBlendMode"],
                        }}
                      >
                        <div
                          className="relative whitespace-pre"
                          style={{
                            fontFamily: font.family,
                            fontSize: fontSizePx,
                            lineHeight: 1.25,
                            fontWeight: designLayer.bold ? 700 : 400,
                            fontStyle: designLayer.italic ? "italic" : "normal",
                            color: designLayer.color,
                            textAlign: "center",
                            letterSpacing: letterSpacingPx ? `${letterSpacingPx}px` : undefined,
                            outline: isSelected ? "1px dashed var(--accent)" : undefined,
                            outlineOffset: 4,
                          }}
                        >
                          {/* Contour : une copie du texte posée DESSOUS, en
                              trait seul, puis le texte plein par-dessus (voir
                              textLayerSvg côté rendu, même principe).
                              -webkit-text-stroke seul dessine un trait centré
                              PAR-DESSUS le glyphe, qui ronge la lettre — très
                              visible sur les polices qui ne sont pas dessinées
                              pour être contournées. La copie est purement
                              décorative, d'où aria-hidden. */}
                          {strokeWidthPx > 0 && (
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute left-0 top-0 w-full whitespace-pre"
                              style={{
                                // Même largeur que le bloc, pour que
                                // l'alignement centré retombe ligne à ligne.
                                // Doublé : le trait est centré sur le
                                // contour, le texte plein par-dessus en
                                // masque la moitié intérieure — il ne reste
                                // donc que l'épaisseur réglée, à l'extérieur.
                                WebkitTextStrokeWidth: `${strokeWidthPx * 2}px`,
                                WebkitTextStrokeColor: designLayer.strokeColor,
                                color: "transparent",
                              }}
                            >
                              {designLayer.content}
                            </span>
                          )}
                          {/* Positionné lui aussi : en CSS, un élément
                              positionné se peint au-dessus du contenu qui ne
                              l'est pas — sans ça la copie en contour
                              repasserait PAR-DESSUS le texte plein et on
                              retomberait sur le défaut d'origine. */}
                          <span className="relative">{designLayer.content}</span>
                          {isSelected && onChangeLayers && (
                            <LayerHandles
                              layer={designLayer}
                              layers={layers}
                              onChangeLayers={onChangeLayers}
                              previewBoxRef={previewBoxRef}
                              maxFontSizeMm={maxFontSizeMm}
                            />
                          )}
                        </div>
                      </div>
                    );
                  }
                  if (designLayer.type === "image") {
                    const url = layerImageUrls[designLayer.id];
                    if (!url) return null;
                    const widthPx = designLayer.widthRatio * boxSize.width;
                    return (
                      <div
                        key={designLayer.id}
                        className="absolute"
                        style={{
                          left: designLayer.positionX * boxSize.width,
                          top: designLayer.positionY * boxSize.height,
                          transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
                          opacity: designLayer.opacity ?? 1,
                          mixBlendMode: (designLayer.blendMode ?? "normal") as React.CSSProperties["mixBlendMode"],
                        }}
                      >
                        <div className="relative" style={{ width: widthPx }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt=""
                            draggable={false}
                            className="block w-full max-w-none"
                            style={{
                              outline: isSelected ? "1px dashed var(--accent)" : undefined,
                              outlineOffset: 4,
                            }}
                          />
                          {isSelected && onChangeLayers && (
                            <LayerHandles
                              layer={designLayer}
                              layers={layers}
                              onChangeLayers={onChangeLayers}
                              previewBoxRef={previewBoxRef}
                              maxFontSizeMm={maxFontSizeMm}
                            />
                          )}
                        </div>
                      </div>
                    );
                  }
                  if (designLayer.type === "shape") {
                    const shapeWidthPx = designLayer.widthRatio * boxSize.width;
                    const shapeHeightPx = designLayer.heightRatio * boxSize.height;
                    const strokeWidthPx = designLayer.strokeWidthMm ? designLayer.strokeWidthMm * pxPerMm : 0;
                    return (
                      <div
                        key={designLayer.id}
                        className="absolute"
                        style={{
                          left: designLayer.positionX * boxSize.width,
                          top: designLayer.positionY * boxSize.height,
                          transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
                          opacity: designLayer.opacity ?? 1,
                          mixBlendMode: (designLayer.blendMode ?? "normal") as React.CSSProperties["mixBlendMode"],
                        }}
                      >
                        <div
                          className="relative box-border"
                          style={{
                            width: shapeWidthPx,
                            height: shapeHeightPx,
                            borderRadius: designLayer.shape === "ellipse" ? "50%" : 0,
                            backgroundColor: designLayer.fillEnabled ? designLayer.fillColor : "transparent",
                            border: strokeWidthPx ? `${strokeWidthPx}px solid ${designLayer.strokeColor}` : undefined,
                            outline: isSelected ? "1px dashed var(--accent)" : undefined,
                            outlineOffset: 4,
                          }}
                        >
                          {isSelected && onChangeLayers && (
                            <LayerHandles
                              layer={designLayer}
                              layers={layers}
                              onChangeLayers={onChangeLayers}
                              previewBoxRef={previewBoxRef}
                              maxFontSizeMm={maxFontSizeMm}
                            />
                          )}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })}
              {/* Cadre : traits de coupe/sécurité + gabarit + logo, fond transparent, jamais déplacé. */}
              {frameOverlayUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={frameOverlayUrl}
                  alt="Aperçu"
                  draggable={false}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                />
              )}
              {/* Sans en-tête (Outil Shopify), le rendu en cours se signale
                  dans le coin de la page. */}
              {previewSize === "lg" && previewLoading && (
                <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-xs text-neutral-500 shadow-sm">
                  <SpinnerIcon className="h-3.5 w-3.5" /> génération...
                </span>
              )}
            </div>
            <p className="mt-2 text-center text-xs text-neutral-500">
              {isMosaic || isTheme
                ? showGuides
                  ? "Ligne magenta = coupe (fond perdu) · pointillés bleus = marge de protection."
                  : isTheme
                  ? "Le graphisme du thème s'affiche par-dessus tes photos — ajoute/change-les dans la liste ci-contre."
                  : "Clique une case puis glisse sa photo pour la cadrer — ajoute/change les photos dans la liste ci-contre."
                : showGuides
                ? "Ligne magenta = coupe (fond perdu) · pointillés bleus = marge de protection · glisse l'image pour la repositionner."
                : "Glisse l'image pour la repositionner."}
            </p>
          </div>
        ) : (
          // N'arrive plus qu'ici sans modèle du tout — avec un modèle mais
          // sans visuel choisi, le canvas blanc ci-dessus s'affiche déjà
          // (voir hasTemplate).
          !previewError && (
            <p className="mt-1 text-xs text-neutral-500">
              {previewUnavailableMessage ?? "Choisis un modèle pour voir l'aperçu."}
            </p>
          )
        )}
      </div>
      )}
    </div>
  );
}
