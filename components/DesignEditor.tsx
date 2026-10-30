"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_MOSAIC_SIDE } from "@/lib/design/mosaicGrid";
import Modal from "@/components/Modal";
import ToolTopBar from "@/components/ToolTopBar";
import DesignHelpContent from "@/components/DesignHelpContent";
import Link from "next/link";
import ImageSourcePicker, {
  type ImageSourceValue,
} from "@/components/ImageSourcePicker";
import ThemePartFiller, { emptyFill, renderThemePart, type CardTheme, type ThemePartFill } from "@/components/ThemePartFiller";
import { partSide, themePartChoices, themeParts } from "@/lib/themeParts";
import type { VisualWithUrl } from "@/components/VisualsGrid";
import type { ThemeWithOverlayUrl } from "@/components/ThemesTable";
import type { Category, Template, ThemeSlotAdjust, IllustrationWithUrl } from "@/lib/types";
import { isLandscape } from "@/lib/pdf/orientation";
import { formatIn, mmToPx } from "@/lib/pdf/units";
import { allowsPanels, allowsSheet, panelCells, parseFold } from "@/lib/folds";
import {
  BoldIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  ExpandIcon,
  HelpCircleIcon,
  ImageIcon,
  ItalicIcon,
  LayoutGridIcon,
  PaintbrushVerticalIcon,
  RectangleHorizontalIcon,
  RectangleVerticalIcon,
  RefreshCcwIcon,
  RotateCwIcon,
  TrashIcon,
  PanelLeftRightDashedIcon,
  SquareSplitHorizontalIcon,
} from "@/components/icons";
import Switch from "@/components/ui/Switch";
import { rangeFillStyle } from "@/components/ui/rangeFill";
import FileVisualCard from "@/components/ui/FileVisualCard";
import LayersPanel from "@/components/LayersPanel";
import ColorPickerButton from "@/components/ColorPickerButton";
import { FontSizeInput, useFontUnit } from "@/components/UnitInputs";
import {
  layersFullyCoverCanvas,
  maxTextSizeMmForTemplate,
  nextLayerId,
  type DesignLayer,
  type TextLayer,
} from "@/lib/design/layers";
import type { PdfPagePlan } from "@/lib/pdf/pdfPages";
import FontPicker from "@/components/FontPicker";
import { templateSizeLabel } from "@/lib/templateLabel";

// En dessous de ce zoom (voir ImageSourcePicker : 1 = cadrage "cover", pile
// à la limite), une marge blanche apparaît autour du visuel — il ne couvre
// plus toute la zone d'impression (fond perdu compris).
const COVERAGE_ZOOM_THRESHOLD = 0.999;

// Thèmes affichés d'un coup dans le sélecteur (4 rangées de 2) : au-delà, le
// panneau gauche s'allonge au point de pousser le reste des réglages hors de
// l'écran. Les suivants se rejoignent par les flèches.
const THEMES_PER_PAGE = 8;

// Cinq dispositions prédéfinies, plus une grille libre (« Personnalisé »).
// Masonry (cases de tailles différentes) reportée à plus tard.
const GRID_PRESETS: { cols: number; rows: number }[] = [
  { cols: 1, rows: 2 },
  { cols: 1, rows: 3 },
  { cols: 2, rows: 1 },
  { cols: 3, rows: 1 },
  { cols: 2, rows: 2 },
];

// Une case cadrable (emplacement de thème ou case de mosaïque) couvre-t-elle
// tout son rectangle ? Une case vide compte comme couverte (blanc voulu).
function slotCovers(value: ImageSourceValue, index: number): boolean {
  const mosaic = value.sourceMode === "mosaic";
  const file = mosaic ? value.mosaicFiles?.[index] : value.themeSlotFiles?.[index];
  if (!file) return true;
  const adjust = mosaic ? value.mosaicCellAdjust?.[index] : value.themeSlotAdjust?.[index];
  return (adjust?.scale ?? 1) >= COVERAGE_ZOOM_THRESHOLD;
}

function coversPrintArea(value: ImageSourceValue): boolean {
  if (value.sourceMode === "theme") {
    return (value.themeSlotFiles ?? []).every((_, i) =>
      slotCovers(value, i),
    );
  }
  if (value.sourceMode === "mosaic") {
    return (value.mosaicFiles ?? []).every((_, i) => slotCovers(value, i));
  }
  if (value.sourceMode !== "upload") return true;
  return (value.scale ?? 1) >= COVERAGE_ZOOM_THRESHOLD;
}

function SidebarButton({
  icon: Icon,
  label,
  onClick,
  active = false,
}: {
  icon?: (props: { className?: string }) => JSX.Element;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        active
          ? "border-primary bg-primary text-text-on-brand"
          : "border-border text-text-muted hover:bg-surface-muted hover:text-text"
      }`}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      {label}
    </button>
  );
}

/**
 * État d'un côté dans la pilule Recto/Verso : vert quand il est prêt à être
 * commandé, rouge tant qu'il manque quelque chose — même notion que le
 * bouton « Vérifier et commander », qui reste désactivé tant que les deux
 * côtés ne sont pas verts.
 *
 * Anneau blanc de 1 px : il détache la pastille du fond quelle que soit la
 * couleur derrière — le côté actif est peint en --primary, désormais réglable
 * dans le module Paramètres, donc on ne peut plus supposer un bourgogne
 * foncé. En box-shadow plutôt qu'en `border`, qui rognerait la pastille au
 * lieu de l'entourer.
 *
 * Couleur posée en style inline plutôt qu'en classe Tailwind : une classe
 * ajoutée à `theme.extend.colors` n'existe qu'après régénération du CSS, et
 * un serveur de dev déjà lancé garde sa config résolue en mémoire — la
 * pastille restait alors transparente. Le repli littéral de `var()` garantit
 * la couleur même avec un CSS périmé, tout en laissant le token (donc le
 * thème sombre) décider quand il est bien chargé.
 */
function SideDot({ ready }: { ready: boolean }) {
  return (
    <span
      role="img"
      aria-label={ready ? "prêt" : "à compléter"}
      className="h-2 w-2 shrink-0 rounded-full"
      style={{
        backgroundColor: ready
          ? "var(--status-ready, #1d9b4a)"
          : "var(--status-todo, #ff4346)",
        boxShadow: "0 0 0 1px #ffffff",
      }}
    />
  );
}

/**
 * Valeur en pourcentage à la fois lisible et saisissable : les curseurs vont
 * vite mais ne permettent pas de viser une valeur précise (ni de reprendre
 * exactement le même réglage d'un côté à l'autre). Champ texte plutôt que
 * `type="number"` pour éviter les flèches natives dans une interface déjà
 * dense.
 *
 * La frappe est conservée telle quelle tant que le champ a le focus (un
 * champ vidé pour être retapé ne doit pas se remettre à 100), puis bornée et
 * validée à la sortie ou sur Entrée.
 */
function PercentField({
  value,
  min,
  max,
  onChange,
  label,
  className = "",
}: {
  value: number; // ratio : 1 = 100 %
  min: number; // en %
  max: number; // en %
  onChange: (ratio: number) => void;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit(raw: string) {
    setDraft(null);
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return; // saisie inutilisable : on garde la valeur en place
    onChange(Math.min(max, Math.max(min, n)) / 100);
  }

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      <input
        type="text"
        inputMode="numeric"
        value={draft ?? String(Math.round(value * 100))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(null);
        }}
        aria-label={label}
        className="w-8 rounded border border-transparent bg-transparent px-0.5 text-right tabular-nums hover:border-border focus:border-border focus:outline-none"
      />
      %
    </span>
  );
}

function SidebarGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-semibold uppercase text-text-subtle">
        {title}
      </p>
      {children}
    </div>
  );
}

// Pastille de la légende sous le canevas — un trait de la même couleur que
// le repère qu'elle désigne (voir lib/pdf/preview.ts pour les couleurs
// exactes des traits eux-mêmes) + son libellé.
function LegendPill({
  color,
  dashed,
  label,
}: {
  color: string;
  dashed?: boolean;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-text-muted">
      <span
        className="h-0 w-4 border-t-[1.5px]"
        style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

/**
 * Écran unique de l'Outil Shopify (après le choix du modèle, voir
 * TemplateGallery/DesignTool) — inspiré du Figma « Éditeur v2 » : barre du
 * haut (modèle + Recto/Verso + Vérifier et commander), panneau gauche
 * (Visuel — avec le choix du type de design directement dedans, plus Plan de
 * travail), canevas central, panneau droit (Calques + Propriétés + état de
 * préparation). Remplace les anciennes étapes séparées DesignTypePicker,
 * DesignPreview et l'écran Résumé (DesignSummary → DesignReviewOverlay,
 * ouvert par-dessus cet écran plutôt que d'y remplacer le contenu — voir
 * DesignTool).
 *
 * Le type de design (Image/Mosaïque/Thème) n'a de sens QUE pour le recto —
 * le verso, lui, suit automatiquement (mosaïque aussi côté verso, ou upload
 * simple sinon ; un thème ne s'applique jamais au verso, voir DesignTool) :
 * le sélecteur de type n'apparaît donc que quand le recto est affiché.
 *
 * Déviations assumées par rapport au Figma (voir le plan) : pas de bouton
 * Annuler/Refaire ni Enregistrer (aucun historique/brouillon aujourd'hui),
 * pas d'alignement de texte (retiré ailleurs dans le projet comme sans effet
 * visible tant que le bloc reste centré — lib/pdf/textLayer.ts), pas de prix
 * dans le résumé (aucune donnée de prix nulle part), barre de texte
 * flottante simplifiée (Gras/Dupliquer/Supprimer, ancrée au-dessus du
 * canevas plutôt que suivant le calque au pixel près — ImageSourcePicker
 * n'expose pas la position écran d'un calque en dehors de lui-même).
 */
export default function DesignEditor({
  category,
  template,
  rawTemplate,
  rotated,
  onRotatedChange,
  visuals,
  themesForTemplate,
  cardTheme = null,
  setCardTheme,
  illustrations,
  front,
  back,
  onChangeFront,
  onChangeBack,
  frontLayers,
  backLayers,
  onChangeFrontLayers,
  onChangeBackLayers,
  backFromPdf,
  pdfWarning,
  frontReady,
  backReady,
  designType,
  mosaicGrid,
  selectedTheme,
  onChangeDesignType,
  onChangeModel,
  grant,
  brandScope = "tool",
  shopHome = null,
  onReview,
}: {
  category: Category;
  template: Template;
  rawTemplate: Template;
  rotated: boolean;
  onRotatedChange: (rotated: boolean) => void;
  visuals: VisualWithUrl[];
  themesForTemplate: ThemeWithOverlayUrl[];
  // Thème en parties choisi (carte pliée, ou thème avec un verso — voir
  // lib/themeParts.ts) et ce que le client a mis dans chaque partie.
  cardTheme?: CardTheme | null;
  setCardTheme: React.Dispatch<React.SetStateAction<CardTheme | null>>;
  illustrations: IllustrationWithUrl[];
  front: ImageSourceValue;
  back: ImageSourceValue;
  onChangeFront: (patch: Partial<ImageSourceValue>) => void;
  onChangeBack: (patch: Partial<ImageSourceValue>) => void;
  frontLayers: DesignLayer[];
  backLayers: DesignLayer[];
  onChangeFrontLayers: (layers: DesignLayer[]) => void;
  onChangeBackLayers: (layers: DesignLayer[]) => void;
  backFromPdf: { file: File; page: number } | null;
  pdfWarning: PdfPagePlan["warning"];
  frontReady: boolean;
  backReady: boolean;
  designType: "single" | "mosaic" | "theme" | "panels";
  mosaicGrid: { cols: number; rows: number };
  selectedTheme: ThemeWithOverlayUrl | null;
  onChangeDesignType: (
    type: "single" | "mosaic" | "theme" | "panels",
    extra?: {
      grid?: { cols: number; rows: number };
      theme?: ThemeWithOverlayUrl;
    },
  ) => void;
  // Absent en mode public : il n'y a pas d'autre modèle à proposer.
  onChangeModel?: () => void;
  // Laissez-passer joint aux appels d'API quand il n'y a pas de session.
  grant?: string;
  // Jeu de réglages dont vient le logo (voir DesignTool).
  brandScope?: string;
  // Accueil de la boutique d'origine (client Shopify) : le logo y ramène.
  // Absent, le logo mène au tableau de bord.
  shopHome?: string | null;
  onReview: () => void;
}) {
  const [activeSide, setActiveSide] = useState<"front" | "back">("front");
  // Produit plié (modèle déjà orienté) : décide des modes offerts (feuille
  // entière et/ou par volet, voir FoldConfig.designMode).
  const fold = parseFold(template.fold);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedThemeSlot, setSelectedThemeSlot] = useState<number | null>(
    null,
  );
  // Mosaïque en grille libre (bouton « Personnalisé ») : ouvert d'office si
  // la grille courante n'est aucune des dispositions prédéfinies.
  const [customGrid, setCustomGrid] = useState(
    () =>
      !GRID_PRESETS.some(
        (p) => p.cols === mosaicGrid.cols && p.rows === mosaicGrid.rows,
      ),
  );
  const [confirmingCoverage, setConfirmingCoverage] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  // Fenêtre « Aide ? » (barre du haut) : le mode d'emploi de l'outil.
  const [helpOpen, setHelpOpen] = useState(false);
  const [themePage, setThemePage] = useState(0);
  // « Afficher les guides d'impression » (nouveau, voir le plan) — masque/
  // affiche uniquement les repères sur le canevas d'édition, jamais le PDF
  // final (ImageSourcePicker le fait déjà pour son propre usage admin, on
  // ne fait que brancher un bouton dessus ici — voir sa prop `showGuides`).
  const [showGuides, setShowGuides] = useState(true);
  // Zoom de VUE du canevas (distinct du zoom de l'image/des calques) —
  // purement un confort d'affichage. `transform: scale` a été essayé
  // d'abord, mais ne change pas la taille occupée dans la mise en page
  // (seulement le rendu visuel) : agrandir le canevas le faisait déborder
  // par-dessus la légende/les boutons juste en dessous au lieu de les
  // repousser. Tenter de réserver l'espace manuellement (mesurer la taille
  // via ResizeObserver puis l'imposer au conteneur englobant) bouclait à
  // l'infini, le canevas d'ImageSourcePicker se redimensionnant lui-même
  // selon l'espace disponible — plus on lui en réservait, plus il grossissait,
  // plus on lui en réservait... `zoom` (propriété CSS, pas standard mais
  // supportée par tous les navigateurs courants dont Firefox depuis la
  // version 126) change, elle, la taille réellement occupée dans la mise en
  // page — la ligne suivante est repoussée naturellement, sans mesure ni
  // boucle.
  const [viewZoom, setViewZoom] = useState(1);
  // Place libre de la zone centrale, mesurée en continu : l'aperçu de la page
  // s'y inscrit au plus grand (voir `fitBox` d'ImageSourcePicker), et suit
  // l'ouverture de la barre de texte, le redimensionnement de la fenêtre…
  const stageRef = useRef<HTMLDivElement>(null);
  // Sur mobile, la scène prend la hauteur du produit à pleine largeur (au plus
  // 65 % de l'écran) : une hauteur fixe laissait un grand vide autour d'un
  // produit large et bas (tasse, dépliant). 32 px : la marge de la colonne ;
  // les noms des volets prennent une rangée au-dessus (plis verticaux) ou une
  // colonne à gauche (plis horizontaux).
  const stageRatio =
    (template.height_mm + 2 * template.bleed_mm) / Math.max(1, template.width_mm + 2 * template.bleed_mm);
  const mobileStageHeight = `min(65vh, calc((100vw - ${32 + (fold?.direction === "horizontal" ? 52 : 0)}px) * ${stageRatio.toFixed(4)} + ${
    fold?.direction === "vertical" ? 40 : 16
  }px))`;
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const side = template.two_sided ? activeSide : "front";
  const themePageCount = Math.max(
    1,
    Math.ceil(themesForTemplate.length / THEMES_PER_PAGE),
  );

  const frontCovers =
    coversPrintArea(front) || layersFullyCoverCanvas(frontLayers);
  const backCovers =
    coversPrintArea(back) || layersFullyCoverCanvas(backLayers);
  const activeCovers = side === "front" ? frontCovers : backCovers;
  const activeValue = side === "front" ? front : back;
  const activeOnChange = side === "front" ? onChangeFront : onChangeBack;
  const activeLayers = side === "front" ? frontLayers : backLayers;
  const activeOnChangeLayers =
    side === "front" ? onChangeFrontLayers : onChangeBackLayers;
  const maxFontSizeMm = maxTextSizeMmForTemplate(template);
  const [fontUnit, setFontUnit] = useFontUnit();
  // Valeurs les plus récentes, pour les rendus asynchrones des parties du thème.
  const latest = useRef({ front, back, cardTheme });
  latest.current = { front, back, cardTheme };
  // Pose l'image rendue d'une partie du thème à sa place : la face entière
  // (« front », « back ») ou la case de son volet (« back:0 »). Ignorée si le
  // client a changé de thème, ou cette partie, pendant le rendu.
  function placeThemePart(themeId: string, key: string, fill: ThemePartFill, file: File) {
    const cur = latest.current;
    const stored = cur.cardTheme?.fills[key];
    if (cur.cardTheme?.theme.id !== themeId || (stored && stored !== fill)) return;
    setCardTheme((ct) => (ct && ct.theme.id === themeId ? { ...ct, fills: { ...ct.fills, [key]: { ...fill, renderedFile: file } } } : ct));
    const back = key === "back" || key.startsWith("back:");
    const onChange = back ? onChangeBack : onChangeFront;
    const value = back ? cur.back : cur.front;
    const panelIndex = key.includes(":") ? Number(key.split(":")[1]) : null;
    if (panelIndex === null) {
      onChange({ file, positionX: 0.5, positionY: 0.5, scale: undefined, rotation: 0 });
      return;
    }
    const count = Math.max(panelIndex + 1, value.mosaicFiles?.length ?? 0);
    const files = Array.from({ length: count }, (_, j) => value.mosaicFiles?.[j] ?? null);
    files[panelIndex] = file;
    // Le volet rendu remplit exactement sa case : cadrage centré.
    const adjust = Array.from({ length: count }, (_, j) => value.mosaicCellAdjust?.[j] ?? { positionX: 0.5, positionY: 0.5, scale: 1 });
    adjust[panelIndex] = { positionX: 0.5, positionY: 0.5, scale: 1 };
    onChange({ mosaicFiles: files, mosaicCellAdjust: adjust });
  }
  const anyUncovered = !frontCovers || (template.two_sided && !backCovers);
  const uncoveredLabel = !template.two_sided
    ? "Ton visuel ne couvre"
    : !frontCovers && !backCovers
      ? "Le recto et le verso ne couvrent"
      : !frontCovers
        ? "Le recto ne couvre"
        : "Le verso ne couvre";
  const effectiveIsLandscape = isLandscape(
    template.width_mm,
    template.height_mm,
  );
  const selectedLayer =
    activeLayers.find((l) => l.id === selectedLayerId) ?? null;
  // Page complète (fond perdu compris) à la résolution d'impression — la
  // même cible que le rendu final côté serveur (coverCropToBuffer) — sert
  // de référence à FileVisualCard pour son indicateur de qualité.
  const targetWidthPx = mmToPx(
    template.width_mm + 2 * template.bleed_mm,
    template.dpi,
  );
  const targetHeightPx = mmToPx(
    template.height_mm + 2 * template.bleed_mm,
    template.dpi,
  );

  // Nouvelle grille ou nouveau type de design : la case sélectionnée peut ne
  // plus exister (une 2×2 passée en 3×1), on repart sans sélection.
  useEffect(() => {
    setSelectedThemeSlot(null);
  }, [designType, mosaicGrid.cols, mosaicGrid.rows]);

  function switchSide(next: "front" | "back") {
    setActiveSide(next);
    setSelectedLayerId(null);
    setSelectedThemeSlot(null);
  }

  function handleReviewClick() {
    if (anyUncovered && !confirmingCoverage) {
      setConfirmingCoverage(true);
      return;
    }
    setConfirmingCoverage(false);
    onReview();
  }

  function rotateVisual() {
    activeOnChange({
      rotation: ((activeValue.rotation ?? 0) + 90) % 360,
      scale: undefined,
    });
  }
  function fillSpace() {
    activeOnChange({ scale: 1 });
  }
  function recenter() {
    activeOnChange({ positionX: 0.5, positionY: 0.5, scale: undefined });
  }

  const themeSlotCount = selectedTheme?.slots.length ?? 0;
  const DEFAULT_THEME_ADJUST: ThemeSlotAdjust = {
    positionX: 0.5,
    positionY: 0.5,
    scale: 1,
  };
  // Cases cadrables du côté affiché : les emplacements du thème (recto
  // seulement) ou les cases de la mosaïque (recto comme verso). Même zoom,
  // mêmes boutons pour les deux ; seul le champ du réglage change.
  const isMosaicSide = activeValue.sourceMode === "mosaic";
  const slotCount = isMosaicSide
    ? mosaicGrid.cols * mosaicGrid.rows
    : activeValue.sourceMode === "theme"
      ? themeSlotCount
      : 0;
  const slotAdjustField = isMosaicSide ? "mosaicCellAdjust" : "themeSlotAdjust";
  function themeAdjust(index: number): ThemeSlotAdjust {
    return activeValue[slotAdjustField]?.[index] ?? DEFAULT_THEME_ADJUST;
  }
  function updateThemeAdjust(index: number, patch: Partial<ThemeSlotAdjust>) {
    const next = Array.from(
      { length: slotCount },
      (_, i) => activeValue[slotAdjustField]?.[i] ?? DEFAULT_THEME_ADJUST,
    );
    next[index] = { ...next[index], ...patch };
    activeOnChange({ [slotAdjustField]: next });
  }

  // Barre de texte flottante (police/taille/gras/italique/couleur puis
  // Dupliquer/Supprimer) — opère directement sur le calque texte sélectionné
  // du côté actif. `updateTextLayer` est le même principe que `updateLayer`
  // dans LayersPanel (panneau droit, qui garde en plus l'espacement, la
  // bordure, l'opacité et le mode de fusion — cette barre flottante ne
  // reprend que les réglages les plus utilisés, en accès rapide sur le
  // canevas).
  function updateTextLayer(patch: Partial<TextLayer>) {
    if (selectedLayer?.type !== "text") return;
    activeOnChangeLayers(
      activeLayers.map((l) =>
        l.id === selectedLayer.id && l.type === "text" ? { ...l, ...patch } : l,
      ),
    );
  }
  function toggleBold() {
    if (selectedLayer?.type !== "text") return;
    updateTextLayer({ bold: !selectedLayer.bold });
  }
  function toggleItalic() {
    if (selectedLayer?.type !== "text") return;
    updateTextLayer({ italic: !selectedLayer.italic });
  }
  function duplicateSelectedLayer() {
    if (!selectedLayer) return;
    const clone: DesignLayer = {
      ...selectedLayer,
      id: nextLayerId(),
      positionX: Math.min(0.95, selectedLayer.positionX + 0.04),
      positionY: Math.min(0.95, selectedLayer.positionY + 0.04),
    };
    activeOnChangeLayers([...activeLayers, clone]);
    setSelectedLayerId(clone.id);
  }
  function deleteSelectedLayer() {
    if (!selectedLayer) return;
    activeOnChangeLayers(activeLayers.filter((l) => l.id !== selectedLayer.id));
    setSelectedLayerId(null);
  }

  return (
    // Grand écran : exactement la hauteur de la fenêtre, pour que la zone
    // centrale ait une hauteur définie à remplir ; les panneaux latéraux
    // défilent chacun de leur côté.
    <div className="flex min-h-dvh flex-col bg-background lg:h-dvh">
      {helpOpen && (
        <Modal title="Aide — créer ton design, pas à pas" onClose={() => setHelpOpen(false)} wide>
          <DesignHelpContent />
        </Modal>
      )}
      {/* Barre du haut, commune aux modules de l'Outil Shopify */}
      <ToolTopBar
        brandScope={brandScope}
        shopHome={shopHome}
        title={template.name}
        subtitle={`${templateSizeLabel(template, true)} po${template.two_sided ? " · Recto verso" : " · Recto"}`}
        onChangeModel={onChangeModel}
        center={
          template.two_sided && (
          <div className="hidden shrink-0 rounded-full border border-border bg-background p-0.5 text-sm sm:flex">
            <button
              type="button"
              onClick={() => switchSide("front")}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 ${
                side === "front"
                  ? "bg-primary text-text-on-brand"
                  : "text-text-muted hover:bg-surface-muted"
              }`}
            >
              Recto
              <SideDot ready={frontReady} />
            </button>
            <button
              type="button"
              onClick={() => switchSide("back")}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 ${
                side === "back"
                  ? "bg-primary text-text-on-brand"
                  : "text-text-muted hover:bg-surface-muted"
              }`}
            >
              Verso
              <SideDot ready={backReady} />
            </button>
          </div>
          )
        }
        actions={
          <>
          {/* Aide, à côté du bouton principal. Fond : #4F0A1F à 6 %, en
              rgba() littéral — les couleurs du projet sont des variables CSS
              complètes, le modificateur d'opacité de Tailwind
              (bg-primary/[0.06]) produirait du CSS invalide, donc invisible. */}
          {/* L'aide s'ouvre par-dessus l'éditeur : le design en cours reste là,
              rien n'est quitté. */}
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="Aide"
            className="flex items-center gap-1.5 rounded-full bg-[rgba(79,10,31,0.06)] px-3 py-1.5 text-sm font-medium text-primary hover:bg-[rgba(79,10,31,0.12)]"
          >
            <HelpCircleIcon className="h-4 w-4 shrink-0" />
            <span className="hidden whitespace-nowrap md:inline">Aide</span>
          </button>
          {confirmingCoverage && anyUncovered ? (
            <>
              <span className="hidden max-w-xs text-xs text-text-subtle sm:inline">
                ⚠ {uncoveredLabel} pas toute la zone d&apos;impression.
              </span>
              <button
                type="button"
                onClick={() => setConfirmingCoverage(false)}
                className="rounded-lg border border-border px-3 py-2 text-sm text-text-muted hover:bg-surface-muted"
              >
                Ajuster
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingCoverage(false);
                  onReview();
                }}
                className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-text-on-brand hover:bg-primary-hover"
              >
                Continuer quand même
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleReviewClick}
              disabled={!frontReady || !backReady}
              className="whitespace-nowrap rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-text-on-brand hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {/* Sur téléphone, le libellé court laisse lire le nom du produit. */}
              <span className="sm:hidden">Vérifier</span>
              <span className="hidden sm:inline">Vérifier et commander</span>
            </button>
          )}
          </>
        }
      />

      {/* Recto/Verso, version mobile (la pilule du haut est masquée sous sm) */}
      {template.two_sided && (
        <div className="flex justify-center border-b border-border bg-surface py-2 sm:hidden">
          <div className="flex rounded-full border border-border p-0.5 text-sm">
            <button
              type="button"
              onClick={() => switchSide("front")}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 ${
                side === "front"
                  ? "bg-primary text-text-on-brand"
                  : "text-text-muted"
              }`}
            >
              Recto
              <SideDot ready={frontReady} />
            </button>
            <button
              type="button"
              onClick={() => switchSide("back")}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 ${
                side === "back"
                  ? "bg-primary text-text-on-brand"
                  : "text-text-muted"
              }`}
            >
              Verso
              <SideDot ready={backReady} />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
        {/* Panneau gauche */}
        <div className="flex shrink-0 flex-col gap-6 overflow-y-auto border-b border-border bg-surface p-5 lg:w-[300px] lg:border-b-0 lg:border-r">
          <SidebarGroup title="Visuel">
            {side === "front" && (
              // Une seule pilule (contrôle segmenté) avec les trois choix
              // dedans — texte/icônes resserrés (text-xs, icônes 14px) pour
              // que les trois tiennent sur une ligne même avec "Mosaïque",
              // le plus long des trois.
              <div className="flex rounded-full border border-border bg-background p-0.5 text-xs">
                {allowsPanels(fold) && (
                  <button
                    type="button"
                    onClick={() => {
                      setThemePickerOpen(false);
                      onChangeDesignType("panels");
                    }}
                    className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-full px-1.5 py-2 font-medium ${
                      designType === "panels" && !cardTheme
                        ? "bg-primary text-text-on-brand shadow-sm"
                        : "text-text-muted hover:text-text"
                    }`}
                  >
                    <SquareSplitHorizontalIcon className="h-3.5 w-3.5 shrink-0" /> Par volet
                  </button>
                )}
                {allowsSheet(fold) && (
                <button
                  type="button"
                  onClick={() => {
                    setThemePickerOpen(false);
                    onChangeDesignType("single");
                  }}
                  className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-full px-1.5 py-2 font-medium ${
                    designType === "single" && !cardTheme
                      ? "bg-primary text-text-on-brand shadow-sm"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  {fold ? (
                    <>
                      <PanelLeftRightDashedIcon className="h-3.5 w-3.5 shrink-0" /> Par planche
                    </>
                  ) : (
                    <>
                      <ImageIcon className="h-3.5 w-3.5 shrink-0" /> Image
                    </>
                  )}
                </button>
                )}
                {allowsSheet(fold) && !fold && (
                <button
                  type="button"
                  onClick={() => {
                    setThemePickerOpen(false);
                    onChangeDesignType("mosaic", { grid: mosaicGrid });
                  }}
                  className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-full px-1.5 py-2 font-medium ${
                    designType === "mosaic"
                      ? "bg-primary text-text-on-brand shadow-sm"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  <LayoutGridIcon className="h-3.5 w-3.5 shrink-0" /> Mosaïque
                </button>
                )}
                {themesForTemplate.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      // Bascule vraiment sur "theme" tout de suite (comme
                      // Image/Mosaïque) — aucun thème précis choisi encore
                      // (`extra` omis, voir handleSelectDesignType), mais
                      // Image/Mosaïque se désélectionnent bien dès le clic,
                      // pas seulement une fois un thème choisi dans la
                      // liste. Avant ce correctif, `designType` restait sur
                      // l'ancien mode tant qu'aucun thème n'était choisi :
                      // Thème ET l'ancien choix (Image/Mosaïque) pouvaient
                      // alors s'afficher actifs en même temps.
                      onChangeDesignType("theme");
                      setThemePage(0);
                      setThemePickerOpen(true);
                    }}
                    className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-full px-1.5 py-2 font-medium ${
                      designType === "theme" || cardTheme
                        ? "bg-primary text-text-on-brand shadow-sm"
                        : "text-text-muted hover:text-text"
                    }`}
                  >
                    <PaintbrushVerticalIcon className="h-3.5 w-3.5 shrink-0" />{" "}
                    Thème
                  </button>
                )}
              </div>
            )}

            {/* Mosaïque : disposition (toujours modifiable) + grille de cases. */}
            {side === "front" && designType === "mosaic" && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {GRID_PRESETS.map(({ cols, rows }) => (
                    <button
                      key={`${cols}x${rows}`}
                      type="button"
                      onClick={() => {
                        setCustomGrid(false);
                        onChangeDesignType("mosaic", { grid: { cols, rows } });
                      }}
                      className={`rounded-lg border px-2.5 py-1 text-xs ${
                        !customGrid &&
                        mosaicGrid.cols === cols &&
                        mosaicGrid.rows === rows
                          ? "border-primary bg-primary text-text-on-brand"
                          : "border-border text-text-muted hover:bg-surface-muted"
                      }`}
                    >
                      {cols}×{rows}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCustomGrid(true)}
                    className={`rounded-lg border px-2.5 py-1 text-xs ${
                      customGrid
                        ? "border-primary bg-primary text-text-on-brand"
                        : "border-border text-text-muted hover:bg-surface-muted"
                    }`}
                  >
                    Personnalisé
                  </button>
                </div>
                {/* Grille libre, jusqu'à MAX_MOSAIC_SIDE de chaque côté (le
                    serveur impose le même plafond, voir lib/design/mosaicGrid.ts). */}
                {customGrid && (
                  <div className="grid grid-cols-2 gap-2">
                    {(["cols", "rows"] as const).map((dim) => (
                      <label key={dim} className="flex flex-col gap-1 text-xs text-text-muted">
                        {dim === "cols" ? "Colonnes" : "Rangées"}
                        <select
                          value={mosaicGrid[dim]}
                          onChange={(e) =>
                            onChangeDesignType("mosaic", {
                              grid: { ...mosaicGrid, [dim]: Number(e.target.value) },
                            })
                          }
                          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text"
                        >
                          {Array.from({ length: MAX_MOSAIC_SIDE }, (_, i) => i + 1).map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Thème : liste des thèmes du modèle — seulement quand le
                sélecteur est ouvert (bouton « Thème » cliqué, ou « Changer
                de thème » plus bas), jamais affichée par défaut sous Image/
                Mosaïque. */}
            {side === "front" &&
              themePickerOpen &&
              themesForTemplate.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    {themesForTemplate
                      .slice(
                        themePage * THEMES_PER_PAGE,
                        (themePage + 1) * THEMES_PER_PAGE,
                      )
                      .map((theme) => (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() => {
                            onChangeDesignType("theme", { theme });
                            setThemePickerOpen(false);
                          }}
                          className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 text-center ${
                            selectedTheme?.id === theme.id || cardTheme?.theme.id === theme.id
                              ? "border-primary"
                              : "border-border hover:border-border-strong"
                          }`}
                        >
                          <div className="flex h-14 w-14 items-center justify-center rounded-md border border-border bg-surface-muted p-1.5">
                            {theme.overlayUrl ? (
                              // Fond (s'il y en a un) sous le graphisme, comme
                              // sur la page imprimée.
                              <span className="relative flex">
                                {theme.backgroundUrl && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={theme.backgroundUrl}
                                    alt=""
                                    className="absolute inset-0 h-full w-full"
                                  />
                                )}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={theme.overlayUrl}
                                  alt=""
                                  className="relative max-h-[2.75rem] max-w-[2.75rem] object-contain"
                                />
                              </span>
                            ) : (
                              <PaintbrushVerticalIcon className="h-6 w-6 text-text-subtle" />
                            )}
                          </div>
                          <span className="line-clamp-2 text-[11px] font-medium text-text">
                            {theme.name}
                          </span>
                        </button>
                      ))}
                  </div>
                  {themePageCount > 1 && (
                    <div className="flex items-center justify-center gap-3 text-xs text-text-muted">
                      <button
                        type="button"
                        onClick={() => setThemePage((p) => Math.max(0, p - 1))}
                        disabled={themePage === 0}
                        aria-label="Thèmes précédents"
                        className="rounded-full border border-border p-1 hover:text-text disabled:opacity-30"
                      >
                        <ChevronLeftIcon className="h-4 w-4" />
                      </button>
                      <span>
                        {themePage + 1} / {themePageCount}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setThemePage((p) =>
                            Math.min(themePageCount - 1, p + 1),
                          )
                        }
                        disabled={themePage >= themePageCount - 1}
                        aria-label="Thèmes suivants"
                        className="rounded-full border border-border p-1 hover:text-text disabled:opacity-30"
                      >
                        <ChevronRightIcon className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            {side === "front" &&
              designType === "theme" &&
              !themePickerOpen &&
              themesForTemplate.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setThemePage(0);
                    setThemePickerOpen(true);
                  }}
                  className="self-start text-xs font-medium text-primary underline"
                >
                  Changer de thème
                </button>
              )}

            {/* Thème en parties (carte pliée, ou thème avec un verso — voir
                lib/themeParts.ts) : les parties de la face affichée, à
                remplir ; chacune est rendue puis posée à sa place (la face,
                ou la case de son volet). */}
            {cardTheme && !themePickerOpen && (() => {
              const theme = cardTheme.theme;
              const labels = themePartChoices(template, theme.scope ?? "sheet");
              const parts = themeParts(theme).filter((p) => partSide(p.key) === side);
              return (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-text">Thème : {theme.name}</span>
                    {side === "front" && (
                      <button
                        type="button"
                        onClick={() => {
                          setThemePage(0);
                          setThemePickerOpen(true);
                        }}
                        className="font-medium text-primary underline"
                      >
                        Changer
                      </button>
                    )}
                  </div>
                  {parts.length === 0 ? (
                    <p className="text-xs text-text-muted">
                      Le thème ne couvre pas {side === "front" ? "le recto" : "le verso"} : ajoute une photo ou un fichier.
                    </p>
                  ) : (
                    parts.map((part) => {
                      const fill = cardTheme.fills[part.key] ?? emptyFill(part);
                      const panelIndex = part.key.includes(":") ? Number(part.key.split(":")[1]) : null;
                      const sideValue = side === "front" ? front : back;
                      const target = panelIndex === null ? sideValue.file : sideValue.mosaicFiles?.[panelIndex] ?? null;
                      return (
                        <ThemePartFiller
                          key={`${theme.id}-${part.key}`}
                          label={labels.find((c) => c.key === part.key)?.label ?? part.key}
                          part={part}
                          fill={fill}
                          // À rendre : réglages changés, ou place vide. Un
                          // fichier mis là par le client n'est pas écrasé.
                          needsRender={!fill.renderedFile || target === null}
                          onFillChange={(next) =>
                            setCardTheme((ct) =>
                              ct && ct.theme.id === theme.id ? { ...ct, fills: { ...ct.fills, [part.key]: next } } : ct
                            )
                          }
                          render={(f) =>
                            renderThemePart({ templateId: template.id, grant, rotated, themeId: theme.id, partKey: part.key, fill: f })
                          }
                          onRendered={(f, file) => placeThemePart(theme.id, part.key, f, file)}
                        />
                      );
                    })
                  )}
                </div>
              );
            })()}

            {/* Fichier : carte dédiée (voir FileVisualCard) pour un fond
                unique — reprend le Figma (vignette + nom + qualité +
                Remplacer). Mosaïque/Thème gardent le rendu d'
                ImageSourcePicker (banque, cases...), trop différent pour la
                même carte. Masqué tant que le sélecteur de thème est ouvert
                (évite de montrer en même temps l'ancien mode et la liste des
                thèmes). */}
            {side === "front" &&
            themePickerOpen ? null : activeValue.sourceMode === "upload" ? (
              <FileVisualCard
                file={activeValue.file}
                pairedPdfLabel={
                  side === "back" && !back.file && backFromPdf
                    ? `Page ${backFromPdf.page} du PDF (recto)`
                    : null
                }
                targetWidthPx={targetWidthPx}
                targetHeightPx={targetHeightPx}
                scale={activeValue.scale ?? 1}
                onFileChange={(f) =>
                  activeOnChange({
                    file: f,
                    positionX: 0.5,
                    positionY: 0.5,
                    scale: undefined,
                    rotation: 0,
                  })
                }
              />
            ) : (
              <ImageSourcePicker
                key={`${side}-file`}
                side={side}
                template={template}
                grant={grant}
                rotated={rotated}
                visuals={visuals}
                value={activeValue}
                onChange={activeOnChange}
                logo={null}
                pairedPdf={side === "back" ? backFromPdf : undefined}
                showGuides={false}
                sourceModes={[activeValue.sourceMode]}
                showPreview={false}
                mosaicGrid={mosaicGrid}
                panelCells={designType === "panels" ? panelCells(template, side) : null}
                themeId={side === "front" ? (selectedTheme?.id ?? null) : null}
              />
            )}

            {pdfWarning &&
              side === "front" &&
              front.sourceMode === "upload" && (
                <p className="rounded-lg border border-warning bg-warning-subtle p-3 text-xs text-text">
                  ⚠ {pdfWarning}
                </p>
              )}

            {activeValue.sourceMode === "upload" && !themePickerOpen && (
              <>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-text">Zoom</span>
                    <PercentField
                      value={activeValue.scale ?? 1}
                      min={10}
                      max={300}
                      onChange={(scale) => activeOnChange({ scale })}
                      label="Zoom du visuel, en pourcentage"
                      className="text-text-subtle"
                    />
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={3}
                    step={0.02}
                    value={activeValue.scale ?? 1}
                    onChange={(e) =>
                      activeOnChange({ scale: parseFloat(e.target.value) })
                    }
                    className="pico-range w-full"
                    style={rangeFillStyle(activeValue.scale ?? 1, 0.1, 3)}
                    aria-label="Zoom (recadrage)"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={rotateVisual}
                    className="flex flex-col items-center gap-1.5 rounded-lg border border-border py-2.5 text-[11px] text-text-muted hover:bg-surface-muted hover:text-text"
                  >
                    <RotateCwIcon className="h-[18px] w-[18px]" />
                    Pivoter
                  </button>
                  <button
                    type="button"
                    onClick={fillSpace}
                    className="flex flex-col items-center gap-1.5 rounded-lg border border-border py-2.5 text-[11px] text-text-muted hover:bg-surface-muted hover:text-text"
                  >
                    <ExpandIcon className="h-[18px] w-[18px]" />
                    Remplir
                  </button>
                  <button
                    type="button"
                    onClick={recenter}
                    className="flex flex-col items-center gap-1.5 rounded-lg border border-border py-2.5 text-[11px] text-text-muted hover:bg-surface-muted hover:text-text"
                  >
                    <RefreshCcwIcon className="h-[18px] w-[18px]" />
                    Réinitialiser
                  </button>
                </div>
              </>
            )}

            {slotCount > 0 && (
              <>
                <div
                  className={isMosaicSide ? "grid gap-1" : "flex gap-1"}
                  // La mosaïque reprend la disposition de sa grille.
                  style={
                    isMosaicSide
                      ? { gridTemplateColumns: `repeat(${mosaicGrid.cols}, minmax(0, 1fr))` }
                      : undefined
                  }
                >
                  {Array.from({ length: slotCount }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedThemeSlot(i)}
                      className={`relative flex-1 rounded-lg border px-1.5 py-1.5 text-xs ${
                        selectedThemeSlot === i
                          ? "border-primary bg-primary text-text-on-brand"
                          : "border-border text-text-muted hover:bg-surface-muted hover:text-text"
                      }`}
                    >
                      {/* Mosaïque : le numéro seul, pour tenir à 6 cases par rangée. */}
                      {isMosaicSide ? i + 1 : `Photo ${i + 1}`}
                      {!slotCovers(activeValue, i) && (
                        <span
                          className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
                            selectedThemeSlot === i
                              ? "bg-text-on-brand"
                              : "bg-warning"
                          }`}
                        />
                      )}
                    </button>
                  ))}
                </div>
                {selectedThemeSlot !== null ? (
                  <>
                    {!slotCovers(activeValue, selectedThemeSlot) && (
                      <p className="rounded-lg border border-warning bg-warning-subtle p-2 text-xs text-text">
                        ⚠ Cette photo ne couvre pas toute{" "}
                        {isMosaicSide ? "sa case" : "l\u2019emplacement"}.
                      </p>
                    )}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-text">Zoom</span>
                        <PercentField
                          value={themeAdjust(selectedThemeSlot).scale}
                          min={10}
                          max={300}
                          onChange={(scale) =>
                            updateThemeAdjust(selectedThemeSlot, { scale })
                          }
                          label="Zoom de la photo, en pourcentage"
                          className="text-text-subtle"
                        />
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={3}
                        step={0.02}
                        value={themeAdjust(selectedThemeSlot).scale}
                        onChange={(e) =>
                          updateThemeAdjust(selectedThemeSlot, {
                            scale: parseFloat(e.target.value),
                          })
                        }
                        className="pico-range w-full"
                        style={rangeFillStyle(
                          themeAdjust(selectedThemeSlot).scale,
                          0.1,
                          3,
                        )}
                        aria-label="Zoom de la photo sélectionnée"
                      />
                    </div>
                    <SidebarButton
                      icon={ExpandIcon}
                      label="Maximiser l'espace"
                      onClick={() =>
                        updateThemeAdjust(selectedThemeSlot, { scale: 1 })
                      }
                    />
                    <SidebarButton
                      icon={RefreshCcwIcon}
                      label="Réinitialiser cette photo"
                      onClick={() =>
                        updateThemeAdjust(selectedThemeSlot, {
                          positionX: 0.5,
                          positionY: 0.5,
                          scale: 1,
                        })
                      }
                    />
                  </>
                ) : (
                  <p className="text-xs text-text-subtle">
                    Choisis une photo (ci-dessus ou dans l&apos;aperçu) pour la
                    déplacer/zoomer.
                  </p>
                )}
              </>
            )}
          </SidebarGroup>

          {/* Zones de texte du thème : le client écrit ce qu'il veut, la
              police et la couleur sont celles du thème. */}
          {side === "front" &&
            activeValue.sourceMode === "theme" &&
            (selectedTheme?.text_zones?.length ?? 0) > 0 && (
              <SidebarGroup title="Textes">
                {selectedTheme!.text_zones!.map((zone, i) => {
                  const value = activeValue.themeTexts?.[i] ?? zone.defaultText;
                  const setText = (text: string) => {
                    const next = selectedTheme!.text_zones!.map((_, j) => activeValue.themeTexts?.[j] ?? null);
                    next[i] = text;
                    activeOnChange({ themeTexts: next });
                  };
                  const max = zone.maxChars > 0 ? zone.maxChars : undefined;
                  return (
                    <label key={zone.id} className="block text-sm">
                      <span className="flex items-baseline justify-between gap-2 text-text">
                        {zone.label}
                        {max && (
                          <span className="text-xs text-text-subtle">
                            {value.length}/{max}
                          </span>
                        )}
                      </span>
                      {zone.multiline ? (
                        <textarea
                          value={value}
                          maxLength={max}
                          rows={3}
                          onChange={(e) => setText(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                        />
                      ) : (
                        <input
                          value={value}
                          maxLength={max}
                          onChange={(e) => setText(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                        />
                      )}
                    </label>
                  );
                })}
              </SidebarGroup>
            )}

          {/* Seule l'orientation reste ici (les guides sont sous la page) :
              sans elle, le groupe n'aurait plus que son titre. */}
          {rawTemplate.allow_orientation_change && (
          <SidebarGroup title="Plan de travail">
            {(
              // Même style de pilule que Recto/Verso (barre du haut) :
              // conteneur rounded-full/border/bg-background, actif =
              // bg-primary + texte blanc (pas de fond blanc/ombre/texte
              // bourgogne comme avant).
              <div className="flex rounded-full border border-border bg-background p-0.5 text-sm">
                <button
                  type="button"
                  onClick={() =>
                    onRotatedChange(
                      isLandscape(rawTemplate.width_mm, rawTemplate.height_mm),
                    )
                  }
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 ${
                    !effectiveIsLandscape
                      ? "bg-primary text-text-on-brand"
                      : "text-text-muted hover:bg-surface-muted"
                  }`}
                >
                  <RectangleVerticalIcon className="h-4 w-3 shrink-0" />
                  Portrait
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onRotatedChange(
                      !isLandscape(rawTemplate.width_mm, rawTemplate.height_mm),
                    )
                  }
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 ${
                    effectiveIsLandscape
                      ? "bg-primary text-text-on-brand"
                      : "text-text-muted hover:bg-surface-muted"
                  }`}
                >
                  <RectangleHorizontalIcon className="h-3 w-4 shrink-0" />
                  Paysage
                </button>
              </div>
            )}
          </SidebarGroup>
          )}
        </div>

        {/* Zone de travail centrale */}
        <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto p-4">
          {selectedLayer?.type === "text" && (
            <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-surface p-1.5 shadow">
              <FontPicker
                value={selectedLayer.fontId}
                onChange={(fontId) => updateTextLayer({ fontId })}
                className="w-44 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
              />
              <FontSizeInput
                valueMm={selectedLayer.fontSizeMm}
                minMm={3}
                maxMm={maxFontSizeMm}
                onChange={(fontSizeMm) => updateTextLayer({ fontSizeMm })}
                ariaLabel={`Taille du texte (${fontUnit})`}
                className="w-16 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => setFontUnit(fontUnit === "pt" ? "mm" : "pt")}
                title="Changer l'unité de la taille (pt ou mm)"
                className="rounded-lg px-1.5 py-1.5 text-xs text-text-muted hover:bg-surface-muted"
              >
                {fontUnit}
              </button>
              <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
              <button
                type="button"
                onClick={toggleBold}
                aria-pressed={selectedLayer.bold}
                className={`rounded-lg p-2 ${selectedLayer.bold ? "bg-primary text-text-on-brand" : "text-text-muted hover:bg-surface-muted"}`}
              >
                <BoldIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={toggleItalic}
                aria-pressed={selectedLayer.italic}
                className={`rounded-lg p-2 ${selectedLayer.italic ? "bg-primary text-text-on-brand" : "text-text-muted hover:bg-surface-muted"}`}
              >
                <ItalicIcon className="h-4 w-4" />
              </button>
              <ColorPickerButton
                value={selectedLayer.color}
                onChange={(hex) => updateTextLayer({ color: hex })}
                label="Couleur du texte"
              />
              <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
              <button
                type="button"
                onClick={duplicateSelectedLayer}
                aria-label="Dupliquer le calque"
                className="rounded-lg p-2 text-text-muted hover:bg-surface-muted"
              >
                <CopyIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={deleteSelectedLayer}
                aria-label="Supprimer le calque"
                className="rounded-lg p-2 text-text-muted hover:text-danger"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          )}

          {!activeCovers && (
            <p className="w-full max-w-xl rounded-lg border border-warning bg-warning-subtle p-3 text-center text-sm text-text">
              ⚠ Ton visuel ne couvre pas toute la zone d&apos;impression — il y
              aura une bordure blanche autour.
            </p>
          )}

          {/* Scène : toute la place restante (sur mobile, une hauteur fixe,
              faute de hauteur à partager). Au-delà de 100 % d'échelle, la
              page la dépasse et la scène défile. */}
          <div
            ref={stageRef}
            className="flex h-[var(--stage-h)] min-h-0 w-full items-center justify-center overflow-auto lg:h-auto lg:flex-1"
            style={{ "--stage-h": mobileStageHeight } as React.CSSProperties}
          >
            <div style={{ zoom: viewZoom }}>
              <ImageSourcePicker
                // Toute la place libre de la scène : l'aperçu n'affiche plus
                // d'aide sous la page ici (les pastilles de légende suffisent).
                fitBox={stageSize ? { width: stageSize.width, height: stageSize.height } : null}
                key={side}
                side={side}
                template={template}
                grant={grant}
                rotated={rotated}
                visuals={visuals}
                value={activeValue}
                onChange={activeOnChange}
                logo={null}
                pairedPdf={side === "back" ? backFromPdf : undefined}
                previewSize="lg"
                allowZoom
                showGuides={showGuides}
                layers={activeLayers}
                onChangeLayers={activeOnChangeLayers}
                selectedLayerId={selectedLayerId}
                onSelectLayer={setSelectedLayerId}
                // Un mode de fusion ne se mélange pas au fond dans le canevas
                // Fabric : l'ancien aperçu le montre juste.
                layerEngine={activeLayers.some((l) => (l.blendMode ?? "normal") !== "normal") ? "dom" : "fabric"}
                sourceModes={[activeValue.sourceMode]}
                allowFileChange={false}
                mosaicGrid={mosaicGrid}
                panelCells={designType === "panels" ? panelCells(template, side) : null}
                themeId={side === "front" ? (selectedTheme?.id ?? null) : null}
                themeSlots={side === "front" ? (selectedTheme?.slots ?? []) : []}
                themeOverlayUrl={
                  side === "front" ? (selectedTheme?.overlayUrl ?? null) : null
                }
                themeTextZones={side === "front" ? (selectedTheme?.text_zones ?? []) : []}
                themeBackgroundUrl={
                  side === "front" ? (selectedTheme?.backgroundUrl ?? null) : null
                }
                themeFit={selectedTheme?.overlay_fit ?? "fill"}
                // Case sélectionnée : emplacement de thème (recto) ou case de
                // mosaïque (les deux côtés).
                selectedThemeSlot={
                  side === "front" || isMosaicSide ? selectedThemeSlot : null
                }
                onSelectThemeSlot={
                  side === "front" || isMosaicSide
                    ? setSelectedThemeSlot
                    : undefined
                }
              />
            </div>
          </div>

          {/* Une seule ligne sous la page : la légende (mêmes couleurs que les
              traits réellement dessinés, voir lib/pdf/preview.ts) et l'échelle
              d'affichage — pour laisser le plus de hauteur possible à la page. */}
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
            {/* Les guides s'allument et s'éteignent à côté de leur légende ;
                éteints, la légende n'a plus rien à décrire et disparaît. */}
            <div className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-3 pr-1.5 text-xs text-text">
              Guides d&apos;impression
              <Switch
                checked={showGuides}
                onChange={setShowGuides}
                label="Afficher les guides d'impression"
              />
            </div>
            {showGuides && (
              <>
                <LegendPill color="#ff00ff" label="Coupe" />
                <LegendPill color="#60a5fa" dashed label="Marge de protection" />
                <LegendPill
                  color="var(--text-subtle)"
                  dashed
                  label={`Fond perdu : ${formatIn(template.bleed_mm)} po`}
                />
                {(Boolean(parseFold(rawTemplate.fold)) ||
                  (rawTemplate.fold_marks_vertical_mm?.length ?? 0) > 0 ||
                  (rawTemplate.fold_marks_horizontal_mm?.length ?? 0) > 0) && (
                  <LegendPill color="#16a34a" dashed label="Plis" />
                )}
                {parseFold(rawTemplate.fold) && (
                  <LegendPill color="#ef4444" label="Zone du pli (éviter le texte)" />
                )}
              </>
            )}
            {/* Zoom de vue — échelle d'affichage du canevas, distincte du zoom
                de l'image (voir la barre latérale gauche). */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
              <button
                type="button"
                onClick={() =>
                  setViewZoom((z) =>
                    Math.max(0.5, Math.round((z - 0.1) * 10) / 10),
                  )
                }
                className="rounded-md px-2.5 py-1 text-text-muted hover:bg-surface-muted"
                aria-label="Réduire l'échelle d'affichage"
              >
                −
              </button>
              <PercentField
                value={viewZoom}
                min={50}
                max={150}
                onChange={setViewZoom}
                label="Échelle d'affichage, en pourcentage"
                className="w-12 justify-center text-xs font-semibold text-text"
              />
              <button
                type="button"
                onClick={() =>
                  setViewZoom((z) =>
                    Math.min(1.5, Math.round((z + 0.1) * 10) / 10),
                  )
                }
                className="rounded-md px-2.5 py-1 text-text-muted hover:bg-surface-muted"
                aria-label="Augmenter l'échelle d'affichage"
              >
                +
              </button>
              <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setViewZoom(1)}
                className="rounded-md px-2.5 py-1 text-xs text-text-muted hover:bg-surface-muted"
              >
                Ajuster à l&apos;écran
              </button>
            </div>
          </div>
        </div>

        {/* Panneau droit */}
        <div className="flex shrink-0 flex-col gap-4 overflow-y-auto border-t border-border bg-surface p-5 lg:w-[320px] lg:border-l lg:border-t-0">
          <LayersPanel
            layers={activeLayers}
            onChangeLayers={activeOnChangeLayers}
            selectedLayerId={selectedLayerId}
            onSelectLayer={setSelectedLayerId}
            maxFontSizeMm={maxFontSizeMm}
            illustrations={illustrations}
          />

          <div className="mt-auto space-y-2.5 rounded-xl bg-surface-muted p-3.5">
            <p className="text-sm font-medium text-text">
              {category.name} · {template.two_sided ? "recto verso" : "recto"}
            </p>
            <div className="flex items-center gap-2">
              <CheckIcon
                className={`h-3.5 w-3.5 shrink-0 ${frontReady && backReady ? "text-success" : "text-text-subtle"}`}
              />
              <p className="text-xs text-text-subtle">
                {template.two_sided
                  ? `Recto ${frontReady ? "prêt" : "à compléter"} · Verso ${backReady ? "prêt" : "à compléter"}`
                  : frontReady
                    ? "Recto prêt"
                    : "Recto à compléter"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
