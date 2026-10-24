"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CopyIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import FontPicker from "@/components/FontPicker";
import { fontOptionById } from "@/lib/design/fonts";
import { loadFont } from "@/lib/design/fontLoader";
import {
  BARCODE_TYPES,
  CARD_SIDE_LABELS,
  CARD_ZONE_LABELS,
  TWO_D_BARCODES,
  contentColumns,
  fillContent,
  fitCardFontMm,
  looseKey,
  newCardZone,
  zoneText,
  type BarcodeType,
  type CardSample,
  type CardSide,
  type CardZone,
  type CardZoneKind,
  type DataVocab,
  DATA_VOCAB,
  type ZoneRotation,
} from "@/lib/studentCards/types";
import type { CsvData } from "@/lib/studentCards/csv";
import { PhotoIndex } from "@/lib/studentCards/photos";
import { parseDataFile } from "@/lib/studentCards/dataFile";
import { measureInk } from "@/lib/design/inkMeasure";
import { alignBoxes, boundsOf, edgesX, edgesY, snapAxis, type AlignMode, type Box, type UserGuide } from "@/lib/variableData/snap";
import CardProduction from "@/components/studentCards/CardProduction";

const MIN_ZONE_MM = 1.5;
const MAX_ZOOM = 8;
const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6, 8];
const round = (v: number) => Math.round(v * 10) / 10;

type Drag =
  | { kind: "create"; startX: number; startY: number; x: number; y: number }
  // Déplacement d'une ou plusieurs zones : leurs positions au départ.
  | { kind: "move"; startX: number; startY: number; origins: Record<string, { x: number; y: number }> }
  | { kind: "resize"; id: string }
  | { kind: "guide"; id: string }
  | null;

// Seuil du magnétisme, en pixels à l'écran.
const SNAP_PX = 6;

// Largeur du dessin d'un texte et sa hauteur pour 1 mm de corps, mesurées par
// le canevas du navigateur (le serveur mesure avec fontkit : même règle, voir
// fitCardFontMm). `left`/`right` : où l'encre commence et finit par rapport au
// point de départ, pour coller le texte au bord de sa zone.
function useTextMeasure(fontsVersion: number) {
  return useCallback(
    (zone: CardZone, text: string) => {
      const font = fontOptionById(zone.fontId);
      // Encre mesurée au pixel (voir measureInk) : fiable dans tous les navigateurs.
      const ink = measureInk(`${zone.bold ? font.weightBold : font.weightRegular} "${font.family}"`, text, fontsVersion);
      return { widthPerMm: ink.left + ink.right, heightPerMm: ink.height, left: ink.left, right: ink.right };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fontsVersion]
  );
}

// Icônes Lucide d'alignement (align-*-vertical/horizontal, *-distribute-center).
const ALIGN_ICONS: Record<AlignMode, React.ReactNode> = {
  left: <><rect width="9" height="6" x="6" y="14" rx="2" /><rect width="16" height="6" x="6" y="4" rx="2" /><path d="M2 2v20" /></>,
  hcenter: <><path d="M12 2v20" /><path d="M8 10H4a2 2 0 0 1-2-2V6c0-1.1.9-2 2-2h4" /><path d="M16 10h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4" /><path d="M8 20H7a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h1" /><path d="M16 14h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1" /></>,
  right: <><rect width="16" height="6" x="2" y="4" rx="2" /><rect width="9" height="6" x="9" y="14" rx="2" /><path d="M22 22V2" /></>,
  top: <><rect width="6" height="16" x="4" y="6" rx="2" /><rect width="6" height="9" x="14" y="6" rx="2" /><path d="M22 2H2" /></>,
  vcenter: <><path d="M2 12h20" /><path d="M10 16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" /><path d="M10 8V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4" /><path d="M20 16v1a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-1" /><path d="M14 8V7c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2v1" /></>,
  bottom: <><rect width="6" height="16" x="4" y="2" rx="2" /><rect width="6" height="9" x="14" y="9" rx="2" /><path d="M22 22H2" /></>,
  distributeH: <><rect width="6" height="14" x="4" y="5" rx="2" /><rect width="6" height="10" x="14" y="7" rx="2" /><path d="M17 22v-5" /><path d="M17 7V2" /><path d="M7 22v-3" /><path d="M7 5V2" /></>,
  distributeV: <><path d="M22 17h-3" /><path d="M22 7h-5" /><path d="M5 17H2" /><path d="M7 7H2" /><rect x="5" y="14" width="14" height="6" rx="2" /><rect x="7" y="4" width="10" height="6" rx="2" /></>,
};
const ALIGN_LABELS: Record<AlignMode, string> = {
  left: "Aligner à gauche",
  hcenter: "Centrer horizontalement",
  right: "Aligner à droite",
  top: "Aligner en haut",
  vcenter: "Centrer verticalement",
  bottom: "Aligner en bas",
  distributeH: "Répartir horizontalement",
  distributeV: "Répartir verticalement",
};

// Barre d'alignement : sur la page pour une zone seule, entre elles pour plusieurs.
function AlignBar({ count, onAlign }: { count: number; onAlign: (mode: AlignMode) => void }) {
  const modes: AlignMode[] = ["left", "hcenter", "right", "top", "vcenter", "bottom", "distributeH", "distributeV"];
  return (
    <div className="space-y-1">
      <span className="block text-xs font-medium text-neutral-500">
        {count > 1 ? "Aligner les zones entre elles" : "Aligner sur la page"}
      </span>
      <div className="flex flex-wrap gap-1">
        {modes.map((mode) => {
          const disabled = mode.startsWith("distribute") && count < 3;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onAlign(mode)}
              disabled={disabled}
              title={disabled ? `${ALIGN_LABELS[mode]} (3 zones au moins)` : ALIGN_LABELS[mode]}
              aria-label={ALIGN_LABELS[mode]}
              className="rounded-lg border border-neutral-300 p-1.5 text-neutral-600 hover:border-pico-maroon hover:text-pico-maroon disabled:opacity-30"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                {ALIGN_ICONS[mode]}
              </svg>
            </button>
          );
        })}
      </div>
    </div>
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

// Le document édité : une carte étudiante ou un gabarit à données variables.
export interface VariableDataDoc {
  id: string;
  name: string;
  two_sided: boolean;
  front_path: string | null;
  back_path: string | null;
  zones: CardZone[];
  sample: CardSample | null;
  photo_column: string | null;
  // Fichier de données conservé (voir 0081).
  data_path?: string | null;
  data_filename?: string | null;
  // Repères placés dans l'éditeur (voir 0082).
  guides?: UserGuide[] | null;
}

// Repères de la page (mm) : fond perdu, marge de sécurité et plis de chaque
// face, mesurés depuis le bord de coupe. Jamais imprimés.
export interface PageGuides {
  bleed: number;
  safetyX: number;
  safetyY: number;
  folds: Record<CardSide, { v: number[]; h: number[] }>;
}

/**
 * Éditeur d'un document à données variables : fonds, zones (texte, photo,
 * code-barres) et production à partir d'un fichier d'élèves ou de clients.
 * Sert aux cartes étudiantes et aux gabarits bâtis sur un modèle.
 */
export default function VariableDataEditor({
  doc: template,
  pageWidth,
  pageHeight,
  apiBase,
  backHref,
  subtitle,
  extraField,
  guides,
  rounded = false,
  vocab = DATA_VOCAB,
}: {
  doc: VariableDataDoc;
  // Format de la page, fond perdu compris (mm).
  pageWidth: number;
  pageHeight: number;
  // « /api/student-cards » ou « /api/data-templates ».
  apiBase: string;
  backHref: string;
  subtitle: React.ReactNode;
  // Champ propre au document (l'école d'une carte), enregistré avec lui.
  extraField?: { key: string; label: string; value: string; suggestions: string[] };
  guides?: PageGuides;
  // Coins arrondis à l'écran (une carte CR80).
  rounded?: boolean;
  vocab?: DataVocab;
}) {
  const router = useRouter();
  const W = pageWidth;
  const H = pageHeight;
  const [name, setName] = useState(template.name);
  const [extraValue, setExtraValue] = useState(extraField?.value ?? "");
  const [twoSided, setTwoSided] = useState(template.two_sided);
  const [zones, setZones] = useState<CardZone[]>(template.zones ?? []);
  const [sample, setSample] = useState<CardSample | null>(template.sample);
  const [photoColumn, setPhotoColumn] = useState<string>(template.photo_column ?? "");
  const [side, setSide] = useState<CardSide>("front");
  const [tool, setTool] = useState<CardZoneKind>("text");
  // Zones sélectionnées (Maj ou ⌘ + clic pour en ajouter) ; le panneau de
  // réglages s'ouvre quand il n'y en a qu'une.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const setSelectedId = (id: string | null) => setSelectedIds(id ? [id] : []);
  const [userGuides, setUserGuides] = useState<UserGuide[]>(template.guides ?? []);
  const [snapOn, setSnapOn] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  // Lignes où une zone vient de s'aimanter (affichées pendant le glisser).
  const [snapLines, setSnapLines] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [assetVersion, setAssetVersion] = useState(0);
  const [uploading, setUploading] = useState<CardSide | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [showGuides, setShowGuides] = useState(true);
  // Zoom de l'aperçu : 1 = la page entière dans le cadre.
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Change le zoom en gardant sous le curseur (ou au centre du cadre) le
  // même point de la page.
  const zoomTo = useCallback((next: number, anchor?: { x: number; y: number }) => {
    const box = scrollRef.current;
    const value = Math.min(MAX_ZOOM, Math.max(1, Math.round(next * 100) / 100));
    const ratio = value / zoomRef.current;
    zoomRef.current = value;
    setZoom(value);
    if (!box || ratio === 1) return;
    const rect = box.getBoundingClientRect();
    const ox = anchor ? anchor.x - rect.left : rect.width / 2;
    const oy = anchor ? anchor.y - rect.top : rect.height / 2;
    const left = (box.scrollLeft + ox) * ratio - ox;
    const top = (box.scrollTop + oy) * ratio - oy;
    requestAnimationFrame(() => box.scrollTo({ left, top }));
  }, []);

  // Ctrl/⌘ + molette, ou pincement du pavé tactile : zoom au curseur.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.01), { x: e.clientX, y: e.clientY });
    }
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [zoomTo]);
  // Zones passées en « Texte personnalisé » : la saisie libre reste ouverte
  // même quand leur contenu n'est qu'une colonne, ou vide.
  const [customZones, setCustomZones] = useState<Set<string>>(new Set());
  const svgRef = useRef<SVGSVGElement>(null);

  // Données de la séance : le CSV chargé, les photos déposées, l'élève affiché.
  const [data, setData] = useState<CsvData | null>(null);
  // Fichier de données : celui conservé avec le document, ou un nouveau
  // (`pending`) envoyé au prochain enregistrement ; `removeData` le retire.
  const [dataFile, setDataFile] = useState<{ name: string; pending: File | null } | null>(
    template.data_path ? { name: template.data_filename ?? "données", pending: null } : null
  );
  const [removeData, setRemoveData] = useState(false);
  const [loadingData, setLoadingData] = useState(Boolean(template.data_path));

  // À l'ouverture : le fichier conservé est relu, l'aperçu montre ses lignes.
  useEffect(() => {
    if (!template.data_path) return;
    let cancelled = false;
    fetch(`${apiBase}/${template.id}/data`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const parsed = parseDataFile(await res.arrayBuffer(), template.data_filename ?? template.data_path!);
        if (!cancelled) applyData(parsed);
      })
      .catch(() => !cancelled && setMessage({ tone: "error", text: "Le fichier de données enregistré n'a pas pu être relu." }))
      .finally(() => !cancelled && setLoadingData(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
    removeZones([id]);
  }
  function removeZones(ids: string[]) {
    changeZones(zones.filter((z) => !ids.includes(z.id)));
    setSelectedIds((sel) => sel.filter((id) => !ids.includes(id)));
  }

  // Déplace des zones de (dx, dy) depuis leurs positions `origins`, sans que
  // l'ensemble sorte de la page (les zones gardent leurs écarts).
  function moveGroup(origins: Record<string, { x: number; y: number }>, dx: number, dy: number) {
    const moving = zones.filter((z) => origins[z.id]);
    if (moving.length === 0) return;
    const box = boundsOf(moving.map((z) => ({ ...z, ...origins[z.id] })));
    const cx = Math.min(Math.max(dx, -box.x), W - box.x - box.width);
    const cy = Math.min(Math.max(dy, -box.y), H - box.y - box.height);
    changeZones(
      zones.map((z) => (origins[z.id] ? { ...z, x: round(origins[z.id].x + cx), y: round(origins[z.id].y + cy) } : z))
    );
  }

  // Cibles du magnétisme : bords et centre de la page, coupe, marge de
  // sécurité, plis, repères, et bords des autres zones de la face.
  function snapTargets(exclude: string[]): { v: number[]; h: number[] } {
    const v = [0, W / 2, W, ...userGuides.filter((g) => g.axis === "v").map((g) => g.pos)];
    const h = [0, H / 2, H, ...userGuides.filter((g) => g.axis === "h").map((g) => g.pos)];
    if (guides) {
      const b = guides.bleed;
      v.push(b, W - b, b + guides.safetyX, W - b - guides.safetyX, ...guides.folds[side].v.map((f) => b + f));
      h.push(b, H - b, b + guides.safetyY, H - b - guides.safetyY, ...guides.folds[side].h.map((f) => b + f));
    }
    for (const z of sideZones) {
      if (exclude.includes(z.id)) continue;
      v.push(...edgesX(z));
      h.push(...edgesY(z));
    }
    return { v, h };
  }
  // Seuil du magnétisme en mm, d'après la taille de la page à l'écran.
  function snapThreshold(): number {
    const width = svgRef.current?.getBoundingClientRect().width ?? 0;
    return width > 0 ? (SNAP_PX * W) / width : 1;
  }

  // Aligne la sélection : sur la page (zone de coupe) pour une zone seule,
  // entre elles pour plusieurs.
  function align(mode: AlignMode) {
    const chosen = zones.filter((z) => selectedIds.includes(z.id));
    if (chosen.length === 0) return;
    const b = guides?.bleed ?? 0;
    const ref: Box = chosen.length === 1 ? { x: b, y: b, width: W - b * 2, height: H - b * 2 } : boundsOf(chosen);
    const moved = alignBoxes(chosen, ref, mode);
    changeZones(zones.map((z) => (moved.has(z.id) ? clampZone({ ...z, ...moved.get(z.id)! }) : z)));
  }

  // Image fixe d'une zone : envoyée tout de suite, la zone garde son chemin
  // (enregistré avec les zones).
  async function uploadZoneImage(zoneId: string, file: File | null) {
    if (!file) return;
    setUploadingImage(true);
    setMessage(null);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`${apiBase}/${template.id}/image`, { method: "POST", body }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setUploadingImage(false);
    if (!res?.ok || !json.path) {
      setMessage({ tone: "error", text: json.error ?? "L'envoi de l'image a échoué." });
      return;
    }
    updateZone(zoneId, { imagePath: json.path });
  }

  function addGuide(axis: "v" | "h") {
    const guide: UserGuide = { id: `guide-${Date.now().toString(36)}`, axis, pos: round(axis === "v" ? W / 2 : H / 2) };
    setUserGuides((all) => [...all, guide]);
    setDirty(true);
  }
  function updateGuide(id: string, pos: number) {
    setUserGuides((all) =>
      all.map((g) => (g.id === id ? { ...g, pos: round(Math.min(Math.max(0, pos), g.axis === "v" ? W : H)) } : g))
    );
    setDirty(true);
  }
  function removeGuide(id: string) {
    setUserGuides((all) => all.filter((g) => g.id !== id));
    setDirty(true);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      // ⌘/Ctrl + A : toutes les zones de la face ; Échap : aucune.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedIds(sideZones.map((z) => z.id));
        return;
      }
      if (e.key === "Escape") return setSelectedIds([]);
      if (selectedIds.length === 0) return;
      const step = e.shiftKey ? 2 : 0.2;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (moves[e.key]) {
        e.preventDefault();
        const origins = Object.fromEntries(
          zones.filter((z) => selectedIds.includes(z.id)).map((z) => [z.id, { x: z.x, y: z.y }])
        );
        moveGroup(origins, moves[e.key][0], moves[e.key][1]);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeZones(selectedIds);
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
    const p = snapPoint(toMm(e));
    setSelectedId(null);
    setDrag({ kind: "create", startX: p.x, startY: p.y, x: p.x, y: p.y });
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  // Un point (tracé d'une zone) aimanté aux cibles.
  function snapPoint(p: { x: number; y: number }) {
    if (!snapOn) return p;
    const t = snapTargets([]);
    const th = snapThreshold();
    const sx = snapAxis([p.x], t.v, th);
    const sy = snapAxis([p.y], t.h, th);
    setSnapLines({ v: sx?.line ?? null, h: sy?.line ?? null });
    return { x: p.x + (sx?.delta ?? 0), y: p.y + (sy?.delta ?? 0) };
  }
  function onZoneDown(e: React.PointerEvent, zone: CardZone) {
    e.stopPropagation();
    // Maj ou ⌘ + clic : ajoute ou retire la zone de la sélection.
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      setSelectedIds((sel) => (sel.includes(zone.id) ? sel.filter((id) => id !== zone.id) : [...sel, zone.id]));
      return;
    }
    // Une zone déjà sélectionnée emmène tout le groupe ; sinon, elle seule.
    const ids = selectedIds.includes(zone.id) ? selectedIds : [zone.id];
    if (!selectedIds.includes(zone.id)) setSelectedId(zone.id);
    const p = toMm(e);
    const origins = Object.fromEntries(zones.filter((z) => ids.includes(z.id)).map((z) => [z.id, { x: z.x, y: z.y }]));
    setDrag({ kind: "move", startX: p.x, startY: p.y, origins });
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  function onGuideDown(e: React.PointerEvent, guide: UserGuide) {
    e.stopPropagation();
    setDrag({ kind: "guide", id: guide.id });
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
    if (drag.kind === "create") {
      const q = snapPoint(p);
      setDrag({ ...drag, x: q.x, y: q.y });
    } else if (drag.kind === "guide") {
      const g = userGuides.find((gg) => gg.id === drag.id);
      if (g) updateGuide(g.id, g.axis === "v" ? p.x : p.y);
    } else if (drag.kind === "move") {
      let dx = p.x - drag.startX;
      let dy = p.y - drag.startY;
      if (snapOn) {
        // L'ensemble déplacé (ses bords et son centre) s'aimante aux cibles.
        const ids = Object.keys(drag.origins);
        const moving = zones.filter((z) => drag.origins[z.id]).map((z) => ({ ...z, ...drag.origins[z.id] }));
        const box = boundsOf(moving);
        const t = snapTargets(ids);
        const th = snapThreshold();
        const sx = snapAxis(edgesX({ ...box, x: box.x + dx }), t.v, th);
        const sy = snapAxis(edgesY({ ...box, y: box.y + dy }), t.h, th);
        dx += sx?.delta ?? 0;
        dy += sy?.delta ?? 0;
        setSnapLines({ v: sx?.line ?? null, h: sy?.line ?? null });
      }
      moveGroup(drag.origins, dx, dy);
    } else {
      const z = zones.find((zz) => zz.id === drag.id);
      if (z) {
        // Le coin tiré (bord droit et bas) s'aimante aux cibles.
        let right = p.x;
        let bottom = p.y;
        if (snapOn) {
          const t = snapTargets([z.id]);
          const th = snapThreshold();
          const sx = snapAxis([right], t.v, th);
          const sy = snapAxis([bottom], t.h, th);
          right += sx?.delta ?? 0;
          bottom += sy?.delta ?? 0;
          setSnapLines({ v: sx?.line ?? null, h: sy?.line ?? null });
        }
        updateZone(z.id, { width: right - z.x, height: bottom - z.y });
      }
    }
  }
  function onPointerUp() {
    setSnapLines({ v: null, h: null });
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
    if (extraField) body.append(extraField.key, extraValue);
    body.append("two_sided", String(twoSided));
    body.append("zones", JSON.stringify(zones));
    body.append("photo_column", photoColumn);
    body.append("guides", JSON.stringify(userGuides));
    if (sample) body.append("sample", JSON.stringify(sample));
    if (dataFile?.pending) body.append("data", dataFile.pending);
    else if (removeData) body.append("remove_data", "true");
    const res = await fetch(`${apiBase}/${template.id}`, { method: "PATCH", body }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setSaving(false);
    if (!res?.ok) {
      setMessage({ tone: "error", text: json.error ?? "L'enregistrement a échoué." });
      return false;
    }
    setDataFile((f) => (f ? { name: f.name, pending: null } : null));
    setRemoveData(false);
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
    const res = await fetch(`${apiBase}/${template.id}`, { method: "PATCH", body }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setUploading(null);
    if (!res?.ok) {
      setMessage({ tone: "error", text: json.error ?? "L'envoi a échoué." });
      return;
    }
    setAssetVersion((v) => v + 1);
    router.refresh();
  }

  // Nouveau fichier déposé : conservé au prochain enregistrement.
  function onData(next: CsvData, file: File) {
    applyData(next);
    setDataFile({ name: file.name, pending: file });
    setRemoveData(false);
    setDirty(true);
  }

  function onRemoveData() {
    setData(null);
    setDataFile(null);
    setRemoveData(true);
    setDirty(true);
  }

  // Données lues : elles deviennent l'aperçu du modèle (colonnes et première ligne).
  function applyData(next: CsvData) {
    setData(next);
    setPreviewIndex(0);
    setSample({ columns: next.columns, row: next.rows[0] ?? {} });
    if (!photoColumn) {
      const guess =
        next.columns.find((c) => /photo|image|fichier/.test(looseKey(c))) ?? guessIdColumn(next.columns) ?? "";
      if (guess) setPhotoColumn(guess);
    }
  }

  const hasBackground = (s: CardSide) => Boolean(s === "front" ? template.front_path : template.back_path);
  const backgroundUrl = (s: CardSide) => `${apiBase}/${template.id}/asset/${s}?v=${assetVersion}`;
  // Traits et poignées de même épaisseur à l'écran, quel que soit le zoom.
  const strokeMm = Math.max(W, H) / 400 / zoom;
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
          <Link href={backHref} className="text-xs text-neutral-500 underline hover:text-pico-black">
            ← Retour à la liste
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
            {extraField && (
              <label className="flex items-center gap-2">
                {extraField.label}
                <input
                  list="variable-data-extra"
                  value={extraValue}
                  maxLength={120}
                  onChange={(e) => {
                    setExtraValue(e.target.value);
                    setDirty(true);
                  }}
                  className="w-64 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm"
                />
                <datalist id="variable-data-extra">
                  {extraField.suggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </label>
            )}
            <span className="text-neutral-500">{subtitle}</span>
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
                {(["text", "photo", "barcode", "image"] as const).map((k) => (
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

          <div className="flex items-center justify-end gap-1 text-xs text-neutral-600">
            <button
              type="button"
              onClick={() => zoomTo([...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.01) ?? 1)}
              disabled={zoom <= 1}
              aria-label="Dézoomer"
              className="h-7 w-7 rounded-lg border border-neutral-300 bg-white text-base leading-none hover:bg-neutral-50 disabled:opacity-40"
            >
              −
            </button>
            <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)} %</span>
            <button
              type="button"
              onClick={() => zoomTo(ZOOM_STEPS.find((z) => z > zoom + 0.01) ?? MAX_ZOOM)}
              disabled={zoom >= MAX_ZOOM}
              aria-label="Zoomer"
              className="h-7 w-7 rounded-lg border border-neutral-300 bg-white text-base leading-none hover:bg-neutral-50 disabled:opacity-40"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => zoomTo(1)}
              disabled={zoom === 1}
              className="ml-1 rounded-lg border border-neutral-300 bg-white px-2 py-1 hover:bg-neutral-50 disabled:opacity-40"
            >
              Ajuster
            </button>
            <span className="ml-2 hidden text-neutral-400 sm:inline">Ctrl/⌘ + molette pour zoomer au curseur</span>
          </div>
          <div ref={scrollRef} className="max-h-[78vh] overflow-auto rounded-xl border border-neutral-200 bg-neutral-100 p-4">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="mx-auto block h-auto touch-none select-none bg-white shadow-md"
              style={{
                // Au format exact de la page : la largeur la plus grande qui
                // tienne dans 70 % de la hauteur de l'écran, sans déborder.
                width: `calc(min(100%, 52rem, calc(70vh * ${W / H})) * ${zoom})`,
                maxWidth: "none",
                aspectRatio: `${W} / ${H}`,
                borderRadius: rounded ? `${(3.18 / W) * 100}% / ${(3.18 / H) * 100}%` : undefined,
              }}
              onPointerDown={onBackgroundDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              role="img"
              aria-label={`${CARD_SIDE_LABELS[side]} de la ${vocab.page}`}
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
                if (z.kind === "image") {
                  return (
                    <g key={`c-${z.id}`} transform={transform} pointerEvents="none">
                      {z.imagePath ? (
                        <image
                          href={`${apiBase}/${template.id}/image?path=${encodeURIComponent(z.imagePath)}`}
                          x={-cw / 2}
                          y={-ch / 2}
                          width={cw}
                          height={ch}
                          preserveAspectRatio={z.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}
                        />
                      ) : (
                        <>
                          <rect x={-cw / 2} y={-ch / 2} width={cw} height={ch} fill="#eef2ff" />
                          <text fontSize={Math.min(cw, ch) / 5} fill="#6366f1" textAnchor="middle" dominantBaseline="central">
                            Image
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
                const size = fitCardFontMm(z, m.widthPerMm, m.heightPerMm);
                const font = fontOptionById(z.fontId);
                // Point de départ du texte pour que l'encre touche le bord (ou soit centrée).
                const tx =
                  z.align === "left" ? -cw / 2 + m.left * size : z.align === "right" ? cw / 2 - m.right * size : ((m.left - m.right) / 2) * size;
                return (
                  <g key={`c-${z.id}`} transform={transform} pointerEvents="none">
                    {/* Mis en page à 100, puis réduit : à la taille réelle (2-3 unités),
                        Safari arrondit la police et le texte n'atteint plus le bord. */}
                    <text
                      x={(tx * 100) / size}
                      y={0}
                      transform={`scale(${size / 100})`}
                      fontFamily={`"${font.family}"`}
                      fontWeight={z.bold ? font.weightBold : font.weightRegular}
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
              {guides && showGuides && (() => {
                const b = guides.bleed;
                const sx = b + guides.safetyX;
                const sy = b + guides.safetyY;
                const folds = guides.folds[side];
                return (
                  <g pointerEvents="none" fill="none">
                    {b > 0 && (
                      // Fond perdu : ce qui dépasse de la coupe, ombré.
                      <path
                        d={`M0 0H${W}V${H}H0Z M${b} ${b}V${H - b}H${W - b}V${b}Z`}
                        fill="rgba(225,29,72,0.14)"
                        fillRule="evenodd"
                      />
                    )}
                    {(guides.safetyX > 0 || guides.safetyY > 0) && (
                      <rect
                        x={sx}
                        y={sy}
                        width={W - sx * 2}
                        height={H - sy * 2}
                        stroke="#16a34a"
                        strokeWidth={strokeMm * 0.8}
                        strokeDasharray={`${strokeMm * 2} ${strokeMm * 1.5}`}
                      />
                    )}
                    {folds.v.map((f) => (
                      <line key={`v${f}`} x1={b + f} x2={b + f} y1={0} y2={H} stroke="#2563eb" strokeWidth={strokeMm * 0.8} strokeDasharray={`${strokeMm * 4} ${strokeMm * 2}`} />
                    ))}
                    {folds.h.map((f) => (
                      <line key={`h${f}`} y1={b + f} y2={b + f} x1={0} x2={W} stroke="#2563eb" strokeWidth={strokeMm * 0.8} strokeDasharray={`${strokeMm * 4} ${strokeMm * 2}`} />
                    ))}
                    {/* Ligne de coupe, par-dessus tout. */}
                    <rect x={b} y={b} width={W - b * 2} height={H - b * 2} stroke="#e11d48" strokeWidth={strokeMm} />
                  </g>
                );
              })()}
              {sideZones.map((z) => {
                const isSelected = selectedIds.includes(z.id);
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
                    {z.id === selectedId && (
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
              {/* Repères : une ligne fine, et une bande invisible plus large pour les saisir. */}
              {userGuides.map((g) => {
                const line =
                  g.axis === "v" ? { x1: g.pos, x2: g.pos, y1: 0, y2: H } : { x1: 0, x2: W, y1: g.pos, y2: g.pos };
                return (
                  <g key={g.id}>
                    <line {...line} stroke="#06b6d4" strokeWidth={strokeMm * 0.8} pointerEvents="none" />
                    <line
                      {...line}
                      stroke="transparent"
                      strokeWidth={strokeMm * 6}
                      style={{ cursor: g.axis === "v" ? "ew-resize" : "ns-resize" }}
                      onPointerDown={(e) => onGuideDown(e, g)}
                    />
                  </g>
                );
              })}
              {/* Ligne où une zone s'aimante, le temps du glisser. */}
              {snapLines.v !== null && (
                <line x1={snapLines.v} x2={snapLines.v} y1={0} y2={H} stroke="#d946ef" strokeWidth={strokeMm} pointerEvents="none" />
              )}
              {snapLines.h !== null && (
                <line x1={0} x2={W} y1={snapLines.h} y2={snapLines.h} stroke="#d946ef" strokeWidth={strokeMm} pointerEvents="none" />
              )}
            </svg>
          </div>
          {guides && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
                Coupe et marges
              </label>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5 bg-rose-600" /> Coupe
              </span>
              {guides.bleed > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-5 border border-rose-300 bg-rose-100" /> Fond perdu (
                  {String(Math.round(guides.bleed * 100) / 100).replace(".", ",")} mm)
                </span>
              )}
              {(guides.safetyX > 0 || guides.safetyY > 0) && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-5 border-t-2 border-dashed border-green-600" /> Marge de sécurité
                </span>
              )}
              {(guides.folds.front.v.length > 0 || guides.folds.front.h.length > 0) && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-5 border-t-2 border-dashed border-blue-600" /> Pli
                </span>
              )}
              <span className="text-neutral-400">Jamais imprimés.</span>
            </div>
          )}
          <p className="text-xs text-neutral-500">
            Choisissez quoi tracer (texte, photo, code-barres ou image), puis glissez sur la {vocab.page}. Cliquez une zone pour la
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
                aria-label="Précédent"
              >
                ‹
              </button>
              <span>
                {vocab.Row} {previewIndex + 1} / {data.rows.length}
              </span>
              <button
                type="button"
                onClick={() => setPreviewIndex((i) => Math.min(data.rows.length - 1, i + 1))}
                disabled={previewIndex >= data.rows.length - 1}
                className="rounded-lg border border-neutral-300 px-2 py-1 disabled:opacity-40"
                aria-label="Suivant"
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
              Le visuel du graphiste, au format de la {vocab.page}
              {guides && guides.bleed > 0 ? " fond perdu compris" : ""} (PDF, PNG ou JPEG), sans les données variables.
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
                {selected ? `Zone ${CARD_ZONE_LABELS[selected.kind].toLowerCase()}` : selectedIds.length > 1 ? "Sélection" : "Zones"}
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
            {selectedIds.length > 1 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-700">{selectedIds.length} zones sélectionnées</span>
                  <button
                    type="button"
                    onClick={() => removeZones(selectedIds)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-neutral-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <TrashIcon className="h-3.5 w-3.5" /> Supprimer
                  </button>
                </div>
                <AlignBar count={selectedIds.length} onAlign={align} />
                <p className="text-xs text-neutral-500">
                  Glissez l&apos;une d&apos;elles pour déplacer le groupe ; flèches pour l&apos;ajuster. Maj ou ⌘ + clic
                  ajoute ou retire une zone.
                </p>
              </div>
            ) : !selected ? (
              <p className="text-xs text-neutral-500">
                {sideZones.length === 0
                  ? `Aucune zone sur cette face : choisissez quoi tracer, puis glissez sur la ${vocab.page}.`
                  : `Cliquez une zone sur la ${vocab.page} pour la régler. Maj ou ⌘ + clic pour en sélectionner plusieurs, ⌘A pour toutes.`}
              </p>
            ) : (
              <div className="space-y-3">
                <AlignBar count={1} onAlign={align} />
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
                          Chargez le fichier des {vocab.rows} (Excel ou CSV) pour choisir parmi ses colonnes.
                        </p>
                      )}
                      {hasRowData && shown && (
                        <p className="truncate text-xs text-neutral-500">
                          {vocab.Row} {previewIndex + 1} : <span className="text-pico-black">{shown}</span>
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

                {selected.kind === "image" && (
                  <div className="space-y-2">
                    <Field label="Fichier">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        disabled={uploadingImage}
                        onChange={(e) => {
                          uploadZoneImage(selected.id, e.target.files?.[0] ?? null);
                          e.target.value = "";
                        }}
                        className="mt-1 w-full text-xs"
                      />
                    </Field>
                    {uploadingImage && <p className="text-xs text-neutral-600">Envoi…</p>}
                    <Field label="Dans la zone">
                      <select
                        value={selected.fit}
                        onChange={(e) => updateZone(selected.id, { fit: e.target.value as "contain" | "cover" })}
                        className={inputClass}
                      >
                        <option value="contain">Entière (sans recadrer)</option>
                        <option value="cover">Remplir la zone (recadrée)</option>
                      </select>
                    </Field>
                    <p className="text-xs text-neutral-500">
                      La même image sur chaque {vocab.page} : logo, signature, pictogramme… PNG (transparence gardée),
                      JPEG, WebP ou SVG.
                    </p>
                  </div>
                )}

                {selected.kind === "photo" && (
                  <p className="text-xs text-neutral-500">
                    La photo remplit la zone, recadrée au besoin (le visage est privilégié). Les photos se déposent
                    plus bas, dans « Produire les {vocab.pages} ».
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

          {/* Repères et magnétisme */}
          <section className="space-y-2 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-pico-black">Repères</h2>
              <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} />
                Magnétisme
              </label>
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
                    <input
                      type="number"
                      step={0.1}
                      value={g.pos}
                      onChange={(e) => updateGuide(g.id, Number(e.target.value) || 0)}
                      className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm"
                    />
                    <span>mm</span>
                    <button
                      type="button"
                      onClick={() => removeGuide(g.id)}
                      aria-label="Retirer le repère"
                      className="ml-auto rounded-lg p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-neutral-500">
              Glissez un repère sur la {vocab.page} pour le placer. Avec le magnétisme, les zones s&apos;aimantent aux
              repères, au centre, à la coupe, à la marge de sécurité et aux autres zones. Les repères ne sont jamais
              imprimés.
            </p>
          </section>

          <CardProduction
            templateId={template.id}
            apiBase={apiBase}
            vocab={vocab}
            templateName={name}
            zones={zones}
            data={data}
            onData={onData}
            dataFile={dataFile ? { name: dataFile.name, pending: Boolean(dataFile.pending) } : null}
            onRemoveData={onRemoveData}
            loadingData={loadingData}
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
