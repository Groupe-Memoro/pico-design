"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import MeasureField, { UnitToggle, type Unit } from "@/components/MeasureField";
import { SheetsManager } from "@/components/ImpositionPresets";
import DuploJobsManager from "@/components/DuploJobsManager";
import GraphtecProfilesManager from "@/components/GraphtecProfilesManager";
import { DownloadIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import UpdatingBadge from "@/components/UpdatingBadge";
import { createClient } from "@/lib/supabase/client";
import {
  assignCells,
  computeLayout,
  cutLines,
  flipAxisIsVertical,
  type FlipEdge,
  type Layout,
  type PieceOrientation,
} from "@/lib/imposition/layout";
import { DUPLO_MARKS, computeDuploLayout, computeDuploTwoPassLayout } from "@/lib/imposition/duplo";
import { MAX_DOCUMENT_COPIES, leafAt, planDocument } from "@/lib/imposition/documentPlan";
import { regMarkRects, type MmRect } from "@/lib/imposition/regmark";
import { formatInches, sheetLabel } from "@/lib/imposition/presets";
import { IMAGE_TYPES, imageToPdf, isImageFile } from "@/lib/imposition/imageToPdf";
import { MM_TO_PT, formatIn } from "@/lib/pdf/units";
import { MACHINES, MACHINE_LABELS, type CutterMachine } from "@/lib/imposition/machines";
import type { SavedImposition } from "@/lib/imposition/saved";
import type { ImpositionCutter, ImpositionDuploJob, ImpositionSheet } from "@/lib/types";
import SearchSelect from "@/components/SearchSelect";

// Taille de page (fond perdu inclus) d'un format du catalogue.
export interface FormatOption {
  id: string;
  name: string;
  category: string;
  // Fond perdu par côté : la ligne de coupe est à cette distance du bord de la page.
  bleedMm: number;
  widthMm: number;
  heightMm: number;
}

export interface ProductOption {
  id: string;
  name: string;
  templateId: string;
  widthMm: number;
  heightMm: number;
}

interface SourceItem {
  key: string;
  kind: "product" | "upload";
  name: string;
  productId?: string;
  file?: File;
  // Image d'origine quand `file` en est la conversion en PDF (refaite si le format change).
  image?: File;
  // PDF téléversé déjà enregistré avec l'imposition qu'on modifie.
  storedPath?: string;
  // Taille de la page du PDF (mm), null tant qu'elle n'est pas lue.
  widthMm: number | null;
  heightMm: number | null;
  copies: number;
}

const CUSTOM = "custom";
// Pas d'orange ici : il est réservé aux lignes de coupe de l'aperçu.
const COLORS = ["#7c9cc4", "#3f8f5b", "#a06cd5", "#2a9d8f", "#d6609a", "#7d7364"];
const CUT_COLOR = "#ff6a00";
// Fond perdu standard (1/8 po) proposé pour un format personnalisé.
const DEFAULT_BLEED_MM = 3.175;

function sizeLabel(w: number, h: number): string {
  return `${formatIn(w)} × ${formatIn(h)}`;
}

function matchesPiece(item: SourceItem, pieceW: number, pieceH: number): boolean {
  if (item.widthMm === null || item.heightMm === null) return true; // pas encore lue
  const close = (a: number, b: number) => Math.abs(a - b) <= 0.1;
  return (
    (close(item.widthMm, pieceW) && close(item.heightMm, pieceH)) ||
    (close(item.widthMm, pieceH) && close(item.heightMm, pieceW))
  );
}

// Lit la taille de la 1re page d'un PDF téléversé (pdf-lib chargé à la demande :
// il ne sert que sur cette page).
async function readPdfPageSizeMm(file: File): Promise<{ widthMm: number; heightMm: number } | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(await file.arrayBuffer());
    const { width, height } = doc.getPage(0).getSize();
    return { widthMm: width / MM_TO_PT, heightMm: height / MM_TO_PT };
  } catch {
    return null;
  }
}

// Message d'une réponse en erreur. Le serveur explique d'habitude (JSON
// `error`) ; mais une requête refusée AVANT d'atteindre la route (fichier trop
// lourd, délai dépassé) revient sans explication — on dit alors ce qui s'est
// passé plutôt qu'un vague « Erreur lors de la génération ».
async function serverError(res: Response, body: FormData, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  if (data && typeof data.error === "string") return data.error;
  if (res.status === 413) {
    let bytes = 0;
    body.forEach((value) => {
      if (value instanceof File) bytes += value.size;
    });
    return `Fichier trop volumineux pour être envoyé (${Math.round(bytes / 104857.6) / 10} Mo). Réduisez le PDF (images compressées) et réessayez.`;
  }
  if (res.status === 504 || res.status === 502) {
    return "La génération a pris trop de temps. Réessayez ; si ça se répète, essayez avec moins d'exemplaires ou un PDF plus léger.";
  }
  if (res.status === 401) return "Votre session a expiré : reconnectez-vous, puis réessayez.";
  return `${fallback} (code ${res.status})`;
}

type ModalState =
  | { mode: "sheets" }
  | { mode: "duplo-jobs" }
  | { mode: "graphtec-profiles" }
  | { mode: "result"; url: string }
  | null;

export default function ImpositionTool({
  sheets,
  duploJobs,
  cutters,
  barcodeJobNos,
  formats,
  products,
  saved = null,
}: {
  sheets: ImpositionSheet[];
  duploJobs: ImpositionDuploJob[];
  // Profils de découpe de la Graphtec.
  cutters: ImpositionCutter[];
  // Numéros de job dont le code-barres (PDF) est importé.
  barcodeJobNos: number[];
  formats: FormatOption[];
  products: ProductOption[];
  // Imposition enregistrée qu'on modifie (null = nouvelle imposition).
  saved?: SavedImposition | null;
}) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

  const cfg = saved?.config ?? null;
  const [name, setName] = useState(saved?.name ?? "");
  const [formatId, setFormatId] = useState<string>(
    cfg && (cfg.formatId === CUSTOM || formats.some((f) => f.id === cfg.formatId))
      ? cfg.formatId
      : (formats[0]?.id ?? CUSTOM)
  );
  const [customUnit, setCustomUnit] = useState<Unit>("in");
  const [customWidth, setCustomWidth] = useState(cfg?.custom.widthMm || 95.25);
  const [customHeight, setCustomHeight] = useState(cfg?.custom.heightMm || 57.15);
  const [customBleed, setCustomBleed] = useState(cfg?.custom.bleedMm || DEFAULT_BLEED_MM);
  const [showCuts, setShowCuts] = useState(true);
  const [sheetId, setSheetId] = useState(
    cfg && sheets.some((sh) => sh.id === cfg.sheetId) ? cfg.sheetId : (sheets[0]?.id ?? "")
  );
  // La Duplo n'est pas réglée par l'outil (sa grille vient d'un job de son
  // catalogue) ; la Graphtec l'est, par un profil de découpe.
  const [machine, setMachine] = useState<CutterMachine>(cfg?.machine ?? "duplo");
  const [duploJobId, setDuploJobId] = useState(cfg?.duploJobId ?? "");
  // 2e passe sur la Duplo (ex. couper puis rainer) : son job ("" = aucune) et
  // la façon de remettre la feuille, qui dépend du job.
  const [duploJob2Id, setDuploJob2Id] = useState(cfg?.duploJob2Id ?? "");
  // Deux passes : le 1er job coupe la feuille en morceaux, le 2e repasse chaque
  // morceau (coupe finale, rainure) — ex. cartes de souhait.
  const [twoPass, setTwoPass] = useState(Boolean(cfg?.duploJob2Id));
  // Le morceau entre-t-il tourné vers la droite (horaire) ou la gauche ?
  const [duploJob2Turn, setDuploJob2Turn] = useState<"cw" | "ccw">(cfg?.duploJob2Turn ?? "cw");
  const [cutterId, setCutterId] = useState(cfg?.cutterId ?? "");
  const [showMarks, setShowMarks] = useState(true);
  const [showGuide, setShowGuide] = useState(true);
  // Change à chaque mise à jour des profils : l'aperçu recharge alors leurs
  // fichiers, qu'un remplacement laisse à la même adresse.
  const [assetVersion, setAssetVersion] = useState(0);
  const [orientation, setOrientation] = useState<PieceOrientation>(cfg?.orientation ?? "auto");
  const [flip, setFlip] = useState<FlipEdge>(cfg?.flip ?? "long");

  // Type d'imposition : des pièces répétées (cartes, aimants…) sur UNE feuille,
  // ou un document de plusieurs pages en feuilles séparées, coupé au massicot
  // (voir lib/imposition/documentPlan.ts).
  const [mode, setMode] = useState<"pieces" | "document">(cfg?.mode ?? "pieces");
  const isDocument = mode === "document";
  const docSaved = cfg?.mode === "document" ? cfg.sources[0] : undefined;
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docStoredPath, setDocStoredPath] = useState<string | null>(docSaved?.path ?? null);
  const [docName, setDocName] = useState(docSaved?.name ?? "");
  // Pages et format, lus dans le PDF déposé (ou repris de l'imposition enregistrée).
  const [docInfo, setDocInfo] = useState<{ pageCount: number; widthMm: number; heightMm: number; mixed: boolean } | null>(
    docSaved?.pageCount && docSaved.widthMm && docSaved.heightMm
      ? { pageCount: docSaved.pageCount, widthMm: docSaved.widthMm, heightMm: docSaved.heightMm, mixed: false }
      : null
  );
  const [docReading, setDocReading] = useState(false);
  const [docCopies, setDocCopies] = useState(docSaved?.copies ?? 1);
  const [docMargin, setDocMargin] = useState(cfg?.document?.marginMm ?? 5);
  const [docGutter, setDocGutter] = useState(cfg?.document?.gutterMm ?? 0);
  const [docBleed, setDocBleed] = useState(cfg?.document?.bleedMm ?? 0);
  const [docDuplex, setDocDuplex] = useState(cfg?.document?.duplex ?? false);
  const [docCropMarks, setDocCropMarks] = useState(cfg?.document?.cropMarks ?? true);
  const [docUnit, setDocUnit] = useState<Unit>("mm");
  const [docSheetIndex, setDocSheetIndex] = useState(0);
  const docInput = useRef<HTMLInputElement>(null);

  // Lit le nombre de pages et le format du PDF (pdf-lib chargé à la demande),
  // et repère un document aux pages de formats différents.
  async function handleDocFile(file: File | null) {
    if (!file) return;
    setDocReading(true);
    setDocFile(file);
    setDocStoredPath(null);
    setDocName(file.name);
    setDocSheetIndex(0);
    try {
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.load(await file.arrayBuffer());
      const pages = doc.getPages();
      const first = pages[0]?.getSize();
      if (!first) throw new Error();
      const w = first.width / MM_TO_PT;
      const h = first.height / MM_TO_PT;
      const mixed = pages.some((p) => {
        const sz = p.getSize();
        return Math.abs(sz.width / MM_TO_PT - w) > 0.5 || Math.abs(sz.height / MM_TO_PT - h) > 0.5;
      });
      setDocInfo({ pageCount: pages.length, widthMm: w, heightMm: h, mixed });
    } catch {
      setDocInfo(null);
      setError("Ce fichier n'est pas un PDF lisible.");
    } finally {
      setDocReading(false);
      if (docInput.current) docInput.current.value = "";
    }
  }
  const [items, setItems] = useState<SourceItem[]>(() =>
    // Une imposition de document garde son PDF à part (docStoredPath) : il
    // n'a rien à faire dans la liste des pièces.
    (cfg?.mode === "document" ? [] : (cfg?.sources ?? [])).map((src, index) => {
      const product = src.kind === "product" ? products.find((p) => p.id === src.productId) : undefined;
      return {
        key: `item-${index}`,
        kind: src.kind,
        name: product?.name ?? src.name,
        productId: src.productId,
        storedPath: src.path,
        widthMm: product?.widthMm ?? src.widthMm,
        heightMm: product?.heightMm ?? src.heightMm,
        copies: src.copies,
      };
    })
  );
  const [productToAdd, setProductToAdd] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextKey = useRef(cfg?.sources.length ?? 0);

  // Miniature du recto de chaque fichier (adresse d'objet, par clé de fichier), pour
  // montrer le visuel dans l'aperçu de la feuille. Une miniature qui n'a pas pu être
  // produite reste absente : la pièce garde alors sa couleur.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const thumbsRequested = useRef(new Set<string>());
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;
  useEffect(() => {
    for (const item of items) {
      if (thumbsRequested.current.has(item.key)) continue;
      const body = new FormData();
      if (item.kind === "product" && item.productId) body.append("productId", item.productId);
      else if (item.file) body.append("file", item.file);
      else if (item.storedPath) body.append("path", item.storedPath);
      else continue;
      thumbsRequested.current.add(item.key);
      fetch("/api/imposition/thumbnail", { method: "POST", body })
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => {
          if (blob) setThumbs((current) => ({ ...current, [item.key]: URL.createObjectURL(blob) }));
        })
        .catch(() => {});
    }
  }, [items]);
  useEffect(() => () => Object.values(thumbsRef.current).forEach((url) => URL.revokeObjectURL(url)), []);

  // Si le préréglage sélectionné a été supprimé (ou le premier vient d'être
  // créé), retombe sur un choix valide.
  useEffect(() => {
    if (!sheets.some((s) => s.id === sheetId)) setSheetId(sheets[0]?.id ?? "");
  }, [sheets, sheetId]);

  // Libère le PDF généré quand la modale de résultat se ferme.
  useEffect(() => {
    if (modal?.mode !== "result") return;
    const { url } = modal;
    return () => URL.revokeObjectURL(url);
  }, [modal]);

  const isDuplo = machine === "duplo";
  const activeCutter = isDuplo ? null : (cutters.find((c) => c.id === cutterId) ?? null);
  // La Graphtec imprime sur la feuille de son profil : ses marques et son gabarit y sont dessinés.
  const sheet = isDocument
    ? (sheets.find((s) => s.id === sheetId) ?? null)
    : isDuplo
    ? (sheets.find((s) => s.id === sheetId) ?? null)
    : (sheets.find((s) => s.id === activeCutter?.sheet_id) ?? null);
  const format = formats.find((f) => f.id === formatId) ?? null;
  const piece =
    formatId === CUSTOM || !format
      ? { widthMm: customWidth, heightMm: customHeight, bleedMm: customBleed }
      : { widthMm: format.widthMm, heightMm: format.heightMm, bleedMm: format.bleedMm };

  // Jobs de la Duplo qui conviennent à la feuille et au format choisis (avec la
  // grille qu'ils donnent), les plus remplis d'abord.
  const duploCandidates = useMemo(() => {
    if (!sheet || !isDuplo) return [];
    return duploJobs
      .flatMap((job) => {
        const jobLayout = computeDuploLayout({
          job: { widthMm: job.width_mm, lengthMm: job.length_mm, slits: job.slits, cuts: job.cuts },
          sheetWidth: sheet.width_mm,
          sheetHeight: sheet.height_mm,
          pieceWidth: piece.widthMm,
          pieceHeight: piece.heightMm,
          bleedMm: piece.bleedMm,
          orientation,
          offsetX: 0,
          offsetY: 0,
        });
        return jobLayout ? [{ job, layout: jobLayout }] : [];
      })
      .sort((a, b) => b.layout.cells.length - a.layout.cells.length || a.job.job_no - b.job.job_no);
  }, [duploJobs, isDuplo, sheet, piece.widthMm, piece.heightMm, piece.bleedMm, orientation]);
  // Jobs prévus pour la taille de la feuille choisie (dans un sens ou l'autre).
  const fitsSheet = (j: (typeof duploJobs)[number]) =>
    Boolean(sheet) &&
    ((Math.abs(j.width_mm - sheet!.width_mm) <= 1 && Math.abs(j.length_mm - sheet!.height_mm) <= 1) ||
      (Math.abs(j.width_mm - sheet!.height_mm) <= 1 && Math.abs(j.length_mm - sheet!.width_mm) <= 1));
  const geometry = (j: (typeof duploJobs)[number]) => ({ widthMm: j.width_mm, lengthMm: j.length_mm, slits: j.slits, cuts: j.cuts });
  const selectedJob1 = duploJobs.find((j) => j.id === duploJobId) ?? null;
  const selectedJob2 = twoPass ? (duploJobs.find((j) => j.id === duploJob2Id && j.id !== duploJobId) ?? null) : null;
  // Deux passes : la grille vient des deux jobs ensemble.
  const twoPassResult = useMemo(() => {
    if (!isDuplo || !twoPass || !sheet || !selectedJob1 || !selectedJob2) return null;
    return computeDuploTwoPassLayout({
      job1: geometry(selectedJob1),
      job2: geometry(selectedJob2),
      sheetWidth: sheet.width_mm,
      sheetHeight: sheet.height_mm,
      pieceWidth: piece.widthMm,
      pieceHeight: piece.heightMm,
      bleedMm: piece.bleedMm,
      orientation,
      offsetX: 0,
      offsetY: 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDuplo, twoPass, sheet, selectedJob1, selectedJob2, piece.widthMm, piece.heightMm, piece.bleedMm, orientation]);
  // 2e passe : les jobs qui vont avec le 1er d'abord, puis tous les autres.
  const secondPassFits = useMemo(() => {
    if (!twoPass || !sheet || !selectedJob1) return new Map<string, number>();
    const fits = new Map<string, number>();
    for (const j of duploJobs) {
      if (j.id === selectedJob1.id) continue;
      const r = computeDuploTwoPassLayout({
        job1: geometry(selectedJob1),
        job2: geometry(j),
        sheetWidth: sheet.width_mm,
        sheetHeight: sheet.height_mm,
        pieceWidth: piece.widthMm,
        pieceHeight: piece.heightMm,
        bleedMm: piece.bleedMm,
        orientation,
        offsetX: 0,
        offsetY: 0,
      });
      if (r) fits.set(j.id, r.layout.cells.length);
    }
    return fits;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twoPass, sheet, selectedJob1, duploJobs, piece.widthMm, piece.heightMm, piece.bleedMm, orientation]);
  // Le job actif et sa grille : une passe (le job coupe ce format), ou deux.
  const onePassLayout = !twoPass ? (duploCandidates.find((c) => c.job.id === duploJobId)?.layout ?? null) : null;
  const activeDuplo =
    selectedJob1 && (onePassLayout || twoPassResult)
      ? { job: selectedJob1, layout: (onePassLayout ?? twoPassResult!.layout) }
      : null;
  const activeDuplo2 = activeDuplo && twoPass ? selectedJob2 : null;
  // Une passe, job choisi parmi « les autres » : ses traits ne tombent pas sur ce format.
  const mismatchedDuplo = !twoPass && !activeDuplo ? selectedJob1 : null;
  const otherDuploJobs = duploJobs.filter((j) => !duploCandidates.some((c) => c.job.id === j.id));
  // Grille de la Graphtec : celle du profil, fixe (colonnes × rangées, marges, espacement).
  const cutterLayout = useMemo(() => {
    if (!activeCutter || !sheet) return null;
    return computeLayout({
      sheetWidth: sheet.width_mm,
      sheetHeight: sheet.height_mm,
      margins: {
        top: activeCutter.margin_top_mm,
        right: activeCutter.margin_right_mm,
        bottom: activeCutter.margin_bottom_mm,
        left: activeCutter.margin_left_mm,
      },
      gutterX: activeCutter.gutter_x_mm,
      gutterY: activeCutter.gutter_y_mm,
      offsetX: activeCutter.offset_x_mm,
      offsetY: activeCutter.offset_y_mm,
      centerGrid: activeCutter.center_grid,
      pieceWidth: piece.widthMm,
      pieceHeight: piece.heightMm,
      orientation,
      grid: { cols: activeCutter.grid_cols, rows: activeCutter.grid_rows },
      trimBleed: piece.bleedMm,
    });
  }, [activeCutter, sheet, piece.widthMm, piece.heightMm, piece.bleedMm, orientation]);
  // La grille vient du job Duplo choisi, ou du profil Graphtec.
  const layout = isDuplo ? (activeDuplo?.layout ?? null) : cutterLayout;

  const cellCount = layout?.cells.length ?? 0;
  const { assignment, overflow } = useMemo(
    () => assignCells(items, cellCount),
    [items, cellCount]
  );
  const totalCopies = items.reduce((sum, i) => sum + i.copies, 0);

  // Les formats arrivent déjà triés par catégorie : on les regroupe en gardant l'ordre.
  const formatGroups = formats.reduce<{ category: string; formats: FormatOption[] }[]>((groups, f) => {
    const last = groups[groups.length - 1];
    if (last && last.category === f.category) last.formats.push(f);
    else groups.push({ category: f.category, formats: [f] });
    return groups;
  }, []);

  const availableProducts = products.filter((p) => formatId === CUSTOM || p.templateId === formatId);

  function refreshPresets() {
    setAssetVersion((v) => v + 1);
    startTransition(() => router.refresh());
  }

  function addItem(partial: Omit<SourceItem, "key" | "copies">) {
    setItems((current) => {
      const used = current.reduce((sum, i) => sum + i.copies, 0);
      return [
        ...current,
        { ...partial, key: `item-${nextKey.current++}`, copies: Math.max(1, cellCount - used) },
      ];
    });
  }

  function handleAddProduct() {
    const product = products.find((p) => p.id === productToAdd);
    if (!product) return;
    addItem({
      kind: "product",
      name: product.name,
      productId: product.id,
      widthMm: product.widthMm,
      heightMm: product.heightMm,
    });
    setProductToAdd("");
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (isImageFile(file)) {
        try {
          const pdf = await imageToPdf(file, piece.widthMm, piece.heightMm);
          const size = await readPdfPageSizeMm(pdf);
          addItem({ kind: "upload", name: file.name, file: pdf, image: file, widthMm: size?.widthMm ?? null, heightMm: size?.heightMm ?? null });
        } catch {
          setError(`Impossible de lire l'image « ${file.name} ».`);
        }
        continue;
      }
      const size = await readPdfPageSizeMm(file);
      addItem({
        kind: "upload",
        name: file.name,
        file,
        widthMm: size?.widthMm ?? null,
        heightMm: size?.heightMm ?? null,
      });
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function updateItem(key: string, patch: Partial<SourceItem>) {
    setItems((current) => current.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function fillItem(key: string) {
    setItems((current) => {
      const others = current.filter((i) => i.key !== key).reduce((sum, i) => sum + i.copies, 0);
      return current.map((i) => (i.key === key ? { ...i, copies: Math.max(1, cellCount - others) } : i));
    });
  }

  // Une image suit le format : si celui-ci change, on refait son PDF (et sa miniature).
  useEffect(() => {
    let cancelled = false;
    for (const item of items) {
      if (!item.image || matchesPiece(item, piece.widthMm, piece.heightMm)) continue;
      const image = item.image;
      imageToPdf(image, piece.widthMm, piece.heightMm)
        .then(async (pdf) => {
          const size = await readPdfPageSizeMm(pdf);
          if (cancelled) return;
          thumbsRequested.current.delete(item.key);
          setItems((current) =>
            current.map((i) =>
              i.key === item.key && i.image === image
                ? { ...i, file: pdf, widthMm: size?.widthMm ?? null, heightMm: size?.heightMm ?? null }
                : i
            )
          );
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [items, piece.widthMm, piece.heightMm]);

  const mismatched = items.filter((i) => !matchesPiece(i, piece.widthMm, piece.heightMm));
  const machineProblem = isDuplo
    ? !sheet
      ? "Créez une feuille pour commencer."
      : !activeDuplo
        ? duploJobs.length === 0
          ? "Importez le catalogue de jobs de la Duplo (Job Duplo > Gérer)."
          : twoPass
            ? "Choisissez deux jobs Duplo qui vont ensemble (passe 1 et passe 2)."
            : duploCandidates.length === 0
            ? "Aucun job Duplo ne coupe ce format en une passe : créez-le sur la Duplo, ou essayez « Deux passes »."
            : "Choisissez un job Duplo."
        : null
    : !activeCutter
      ? cutters.length === 0
        ? "Créez un profil de découpe Graphtec (Profil de découpe > Gérer)."
        : "Choisissez un profil de découpe."
      : !sheet
        ? `Le profil « ${activeCutter.name} » n'a plus de format de papier : modifiez-le.`
        : null;
  // Plan du document : poses par feuille, feuilles à imprimer (même calcul que le PDF).
  const docPlan = useMemo(
    () =>
      isDocument && sheet && docInfo
        ? planDocument({
            sheetWidth: sheet.width_mm,
            sheetHeight: sheet.height_mm,
            marginMm: docMargin,
            gutterMm: docGutter,
            pageWidth: docInfo.widthMm,
            pageHeight: docInfo.heightMm,
            pageCount: docInfo.pageCount,
            duplex: docDuplex,
            copies: docCopies,
          })
        : null,
    [isDocument, sheet, docInfo, docMargin, docGutter, docDuplex, docCopies]
  );
  const docProblem = !sheet
    ? "Créez une feuille pour commencer."
    : !docFile && !docStoredPath
      ? "Ajoutez le PDF du document."
      : docReading
        ? "Lecture du PDF…"
        : docInfo?.mixed
          ? "Toutes les pages du PDF doivent avoir le même format."
          : docPlan && docPlan.perSheet === 0
            ? "Une page ne tient pas sur cette feuille avec ces marges : choisissez une feuille plus grande ou réduisez la marge."
            : null;

  const piecesProblem = machineProblem
    ? machineProblem
    : !layout || cellCount === 0
        ? activeCutter
          ? `La grille du profil (${activeCutter.grid_cols} × ${activeCutter.grid_rows}) ne rentre pas sur la feuille avec ce format, ces marges et cet espacement.`
          : "Ce format ne rentre pas dans la zone utile de la feuille."
        : items.length === 0
          ? "Ajoutez au moins un fichier."
          : overflow > 0
            ? `Trop de copies : ${overflow} de plus que les ${cellCount} emplacements.`
            : mismatched.length > 0
              ? `La taille de « ${mismatched[0].name} » ne correspond pas au format.`
              : null;
  const problem = isDocument ? docProblem : piecesProblem;
  const saveProblem = problem ?? (name.trim() ? null : "Donnez un nom à l'imposition pour l'enregistrer.");

  // Requête commune à l'aperçu et à l'enregistrement.
  // PDF déjà déposés dans le stockage (voir app/api/imposition/stage), par
  // fichier : un aperçu puis un enregistrement ne renvoient pas deux fois le
  // même document.
  const stagedPaths = useRef(new Map<File, string>());
  const [staging, setStaging] = useState(false);

  // Dépose les PDF à imposer DIRECTEMENT dans le stockage. La plateforme refuse
  // toute requête de plus de 4,5 Mo : un document de plusieurs pages ne pouvait
  // pas passer dans le corps de la requête. Seul son chemin y voyage ensuite.
  async function stageFiles() {
    const files = isDocument ? (docFile ? [docFile] : []) : items.flatMap((i) => (i.file ? [i.file] : []));
    const pending = files.filter((f) => !stagedPaths.current.has(f));
    if (pending.length === 0) return;
    setStaging(true);
    try {
      const supabase = createClient();
      for (const file of pending) {
        const res = await fetch("/api/imposition/stage", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.path || !data.token) throw new Error(data.error ?? "Préparation de l'envoi impossible.");
        const { error: uploadError } = await supabase.storage
          .from("imposition")
          .uploadToSignedUrl(data.path, data.token, file, { contentType: "application/pdf" });
        if (uploadError) {
          const sizeMb = Math.round(file.size / 104857.6) / 10;
          // Refus du stockage pour la taille : la limite par fichier du projet
          // Supabase (réglage Storage), pas une limite de Pico Design.
          if (/maximum allowed size|too large|Payload too large/i.test(uploadError.message)) {
            throw new Error(
              `« ${file.name} » (${sizeMb} Mo) dépasse la taille maximale par fichier du stockage. Réduisez le PDF (Acrobat : Fichier → Réduire la taille du fichier) ou relevez la limite dans Supabase (Storage → Settings).`
            );
          }
          throw new Error(`Envoi de « ${file.name} » (${sizeMb} Mo) impossible : ${uploadError.message}`);
        }
        stagedPaths.current.set(file, data.path);
      }
    } finally {
      setStaging(false);
    }
  }

  // Requête d'un document de plusieurs pages (voir buildDocumentImposition).
  function buildDocumentBody(): FormData | null {
    if (!sheet || (!docFile && !docStoredPath)) return null;
    const body = new FormData();
    body.append("mode", "document");
    body.append("sheetId", sheet.id);
    body.append("machine", machine);
    body.append("flip", flip);
    body.append("marginMm", String(docMargin));
    body.append("gutterMm", String(docGutter));
    body.append("bleedMm", String(docBleed));
    body.append("duplex", String(docDuplex));
    body.append("cropMarks", String(docCropMarks));
    if (saved) body.append("impositionId", saved.id);
    body.append(
      "config",
      JSON.stringify({
        version: 1,
        mode: "document",
        document: { marginMm: docMargin, gutterMm: docGutter, bleedMm: docBleed, duplex: docDuplex, cropMarks: docCropMarks },
        sheetId: sheet.id,
        machine,
        duploJobId: "",
        cutterId: "",
        formatId,
        custom: { widthMm: customWidth, heightMm: customHeight, bleedMm: customBleed },
        orientation,
        flip,
      })
    );
    const shown = {
      name: docName,
      widthMm: docInfo?.widthMm ?? null,
      heightMm: docInfo?.heightMm ?? null,
      pageCount: docInfo?.pageCount ?? null,
      copies: docCopies,
    };
    const docStaged = docFile ? stagedPaths.current.get(docFile) : undefined;
    if (docFile && docStaged) {
      body.append("sources", JSON.stringify([{ kind: "staged", path: docStaged, ...shown }]));
    } else if (docFile) {
      body.append("file0", docFile);
      body.append("sources", JSON.stringify([{ kind: "upload", field: "file0", ...shown }]));
    } else {
      body.append("sources", JSON.stringify([{ kind: "stored", path: docStoredPath, ...shown }]));
    }
    return body;
  }

  function buildBody(): FormData | null {
    if (isDocument) return buildDocumentBody();
    if (!sheet || (!activeDuplo && !activeCutter)) return null;
    const body = new FormData();
    body.append("sheetId", sheet.id);
    body.append("machine", machine);
    if (activeDuplo) body.append("duploJobId", activeDuplo.job.id);
    if (activeDuplo2) {
      body.append("duploJob2Id", activeDuplo2.id);
      body.append("duploJob2Turn", duploJob2Turn);
    }
    if (activeCutter) body.append("cutterId", activeCutter.id);
    body.append("pieceWidthMm", String(piece.widthMm));
    body.append("pieceHeightMm", String(piece.heightMm));
    body.append("orientation", orientation);
    body.append("flip", flip);
    body.append("pieceBleedMm", String(piece.bleedMm));
    if (saved) body.append("impositionId", saved.id);
    body.append(
      "config",
      JSON.stringify({
        version: 1,
        sheetId: sheet.id,
        machine,
        duploJobId: activeDuplo?.job.id ?? "",
        duploJob2Id: activeDuplo2?.id ?? "",
        duploJob2Turn,
        cutterId: activeCutter?.id ?? "",
        formatId,
        custom: { widthMm: customWidth, heightMm: customHeight, bleedMm: customBleed },
        orientation,
        flip,
      })
    );
    const specs = items.map((item, index) => {
      const shown = { name: item.name, widthMm: item.widthMm, heightMm: item.heightMm, copies: item.copies };
      const itemStaged = item.file ? stagedPaths.current.get(item.file) : undefined;
      if (item.kind === "upload" && item.file && itemStaged) return { kind: "staged", path: itemStaged, ...shown };
      if (item.kind === "upload" && item.file) {
        body.append(`file${index}`, item.file);
        return { kind: "upload", field: `file${index}`, ...shown };
      }
      if (item.kind === "upload" && item.storedPath) return { kind: "stored", path: item.storedPath, ...shown };
      return { kind: "product", productId: item.productId, ...shown };
    });
    body.append("sources", JSON.stringify(specs));
    return body;
  }

  // Aperçu du PDF, sans l'enregistrer.
  async function handlePreview() {
    if (problem) return;
    setGenerating(true);
    setError(null);
    try {
      await stageFiles();
      const body = buildBody();
      if (!body) return;
      const res = await fetch("/api/imposition/generate", { method: "POST", body });
      if (!res.ok) {
        setError(await serverError(res, body, "Erreur lors de la génération."));
        return;
      }
      const blob = await res.blob();
      setModal({ mode: "result", url: URL.createObjectURL(blob) });
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Impossible de joindre le serveur.");
    } finally {
      setGenerating(false);
    }
  }

  // Enregistre l'imposition (nom, configuration et PDF) puis revient à la liste.
  async function handleSave() {
    if (saveProblem) return;
    setSaving(true);
    setError(null);
    try {
      await stageFiles();
      const body = buildBody();
      if (!body) {
        setSaving(false);
        return;
      }
      body.append("name", name.trim());
      const res = await fetch(saved ? `/api/impositions/${saved.id}` : "/api/impositions", {
        method: saved ? "PATCH" : "POST",
        body,
      });
      if (!res.ok) {
        setError(await serverError(res, body, "Erreur lors de l'enregistrement."));
        setSaving(false);
        return;
      }
      router.push("/imposition");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Impossible de joindre le serveur.");
      setSaving(false);
    }
  }

  // Réglage de l'imprimante (Fiery) qui correspond à chaque bord de retournement :
  // haut-haut si la feuille se retourne autour de son axe vertical, haut-bas sinon.
  // Sans feuille choisie, on suppose une feuille en portrait.
  function flipMode(edge: FlipEdge): string {
    const vertical = flipAxisIsVertical(sheet?.width_mm ?? 1, sheet?.height_mm ?? 2, edge);
    return vertical ? "haut-haut" : "haut-bas";
  }

  const selectClass = "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm";
  const labelClass = "block text-xs font-medium text-neutral-500";

  return (
    <div>
      <div className="mb-6">
        <Link href="/imposition" className="text-xs text-neutral-500 underline hover:text-pico-black">
          ← Toutes les impositions
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-page-title font-semibold text-pico-black">
          {saved ? "Modifier l'imposition" : "Nouvelle imposition"}
          <UpdatingBadge show={isRefreshing} />
        </h1>
        <p className="text-sm text-neutral-500">
          Placez des PDF d&apos;impression ou des images sur une feuille selon le format et les paramètres de la machine.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <div className="space-y-5">
          <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div>
              <label className={labelClass}>Nom de l&apos;imposition</label>
              <input
                type="text"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex. Cartes d'affaires — commande 1042"
                className={selectClass}
              />
            </div>

            {/* Type d'imposition : pièces répétées sur une feuille, ou document de
                plusieurs pages en feuilles séparées. */}
            <div>
              <label className={labelClass}>Type d&apos;imposition</label>
              <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg border border-neutral-300 p-1 text-sm">
                {(
                  [
                    ["pieces", "Pièces (cartes, aimants…)"],
                    ["document", "Document multipage"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    className={`rounded-md px-2 py-1.5 ${
                      mode === value ? "bg-pico-maroon text-white" : "text-neutral-600 hover:bg-neutral-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {!isDocument && (
            <div>
              <label className={labelClass}>Format</label>
              <SearchSelect
                value={formatId}
                onChange={setFormatId}
                className={selectClass}
                ariaLabel="Format"
                placeholder="Rechercher un format (nom, taille…)"
                options={[
                  ...formatGroups.flatMap((group) =>
                    group.formats.map((f) => ({
                      value: f.id,
                      // Taille sans le fond perdu ; la page (fond perdu compris)
                      // reste celle du calcul de la feuille.
                      label: `${f.name} · ${sizeLabel(f.widthMm - 2 * f.bleedMm, f.heightMm - 2 * f.bleedMm)}`,
                      group: group.category,
                    }))
                  ),
                  { value: CUSTOM, label: "Personnalisé…", group: "Autre" },
                ]}
              />
              {formatId === CUSTOM && (
                <div className="mt-3 space-y-2">
                  <div className="flex justify-end">
                    <UnitToggle unit={customUnit} onChange={setCustomUnit} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <MeasureField
                      key={`cw-${customUnit}`}
                      label="Largeur"
                      valueMm={customWidth}
                      unit={customUnit}
                      onChange={setCustomWidth}
                    />
                    <MeasureField
                      key={`ch-${customUnit}`}
                      label="Hauteur"
                      valueMm={customHeight}
                      unit={customUnit}
                      onChange={setCustomHeight}
                    />
                    <MeasureField
                      key={`cb-${customUnit}`}
                      label="Fond perdu (par côté)"
                      valueMm={customBleed}
                      unit={customUnit}
                      onChange={setCustomBleed}
                    />
                  </div>
                </div>
              )}
            </div>
            )}

            {(isDuplo || isDocument) && (
              <div>
                <div className="flex items-center justify-between">
                  <label className={labelClass}>Feuille</label>
                  <button
                    type="button"
                    onClick={() => setModal({ mode: "sheets" })}
                    className="text-xs text-neutral-500 underline hover:text-pico-black"
                  >
                    Gérer
                  </button>
                </div>
                <select value={sheetId} onChange={(e) => setSheetId(e.target.value)} className={selectClass}>
                  {sheets.length === 0 && <option value="">— Aucune feuille —</option>}
                  {sheets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {sheetLabel(s.width_mm, s.height_mm)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!isDocument && (
            <div>
              <label className={labelClass}>Découpeuse</label>
              <select
                value={machine}
                onChange={(e) => setMachine(e.target.value as CutterMachine)}
                className={selectClass}
              >
                {MACHINES.map((m) => (
                  <option key={m} value={m}>
                    {MACHINE_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            )}

            {!isDuplo && !isDocument && (
              <div>
                <div className="flex items-center justify-between">
                  <label className={labelClass}>Profil de découpe</label>
                  <button
                    type="button"
                    onClick={() => setModal({ mode: "graphtec-profiles" })}
                    className="text-xs text-neutral-500 underline hover:text-pico-black"
                  >
                    Gérer
                  </button>
                </div>
                <select value={activeCutter?.id ?? ""} onChange={(e) => setCutterId(e.target.value)} className={selectClass}>
                  <option value="">{cutters.length === 0 ? "— Aucun profil —" : "— Choisir un profil —"}</option>
                  {cutters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.grid_cols} × {c.grid_rows} pièces
                    </option>
                  ))}
                </select>
                {activeCutter && (
                  <p className="mt-1 text-xs text-neutral-500">
                    {sheet ? `Feuille ${sheetLabel(sheet.width_mm, sheet.height_mm)}` : "Aucun format de papier"} ·
                    marges {[activeCutter.margin_top_mm, activeCutter.margin_right_mm, activeCutter.margin_bottom_mm, activeCutter.margin_left_mm]
                      .map((v) => formatIn(v))
                      .join(" / ")}{" "}
                    (haut / droite / bas / gauche) · espacement {formatIn(activeCutter.gutter_x_mm)} ×{" "}
                    {formatIn(activeCutter.gutter_y_mm)}
                    {activeCutter.marks_path ? " · codes et marques imprimés au recto" : " · sans fichier de marques"}
                  </p>
                )}
              </div>
            )}

            {isDuplo && !isDocument && (
              <div>
                <div className="flex items-center justify-between">
                  <label className={labelClass}>Job Duplo</label>
                  <button
                    type="button"
                    onClick={() => setModal({ mode: "duplo-jobs" })}
                    className="text-xs text-neutral-500 underline hover:text-pico-black"
                  >
                    Gérer
                  </button>
                </div>
                <label className="mt-1 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={twoPass}
                    onChange={(e) => {
                      setTwoPass(e.target.checked);
                      if (!e.target.checked) setDuploJob2Id("");
                    }}
                  />
                  Deux passes (la feuille est coupée en morceaux, puis chaque morceau repasse)
                </label>
                {twoPass && <p className="mt-2 text-xs font-medium text-neutral-600">Passe 1 — découpe de la feuille</p>}
                <select
                  value={selectedJob1?.id ?? ""}
                  onChange={(e) => setDuploJobId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">
                    {duploJobs.length === 0
                      ? "— Aucun job importé —"
                      : "— Choisir un job —"}
                  </option>
                  {twoPass
                    ? [
                        { label: "Pour cette feuille", jobs: duploJobs.filter(fitsSheet) },
                        { label: "Autres jobs", jobs: duploJobs.filter((j) => !fitsSheet(j)) },
                      ]
                        .filter((g) => g.jobs.length > 0)
                        .map((g) => (
                          <optgroup key={g.label} label={g.label}>
                            {g.jobs.map((job) => (
                              <option key={job.id} value={job.id}>
                                N° {job.job_no} — {job.name}
                              </option>
                            ))}
                          </optgroup>
                        ))
                    : (
                      <>
                        {duploCandidates.length > 0 && (
                          <optgroup label="Pour cette feuille et ce format">
                            {duploCandidates.map(({ job, layout: jobLayout }) => (
                              <option key={job.id} value={job.id}>
                                N° {job.job_no} — {job.name} · {jobLayout.cells.length} pièces ({jobLayout.cols} × {jobLayout.rows})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {otherDuploJobs.length > 0 && (
                          <optgroup label="Autres jobs">
                            {otherDuploJobs.map((job) => (
                              <option key={job.id} value={job.id}>
                                N° {job.job_no} — {job.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    )}
                </select>
                {mismatchedDuplo && (
                  <p className="mt-1 text-xs text-amber-700">
                    Les traits du job n° {mismatchedDuplo.job_no} ne tombent pas sur ce format : il ne peut pas couper
                    ces pièces en une passe. S&apos;il coupe la feuille en morceaux à repasser, cochez « Deux passes ».
                  </p>
                )}
                {twoPass && (
                  <>
                    <p className="mt-3 text-xs font-medium text-neutral-600">Passe 2 — sur chaque morceau (coupe finale, rainure)</p>
                    <select
                      value={selectedJob2?.id ?? ""}
                      onChange={(e) => setDuploJob2Id(e.target.value)}
                      className={selectClass}
                      disabled={!selectedJob1}
                    >
                      <option value="">{selectedJob1 ? "— Choisir le job de la 2e passe —" : "— Choisissez d'abord la passe 1 —"}</option>
                      {[
                        { label: "Vont avec la passe 1", jobs: duploJobs.filter((j) => secondPassFits.has(j.id)) },
                        { label: "Autres jobs", jobs: duploJobs.filter((j) => j.id !== selectedJob1?.id && !secondPassFits.has(j.id)) },
                      ]
                        .filter((g) => g.jobs.length > 0)
                        .map((g) => (
                          <optgroup key={g.label} label={g.label}>
                            {g.jobs.map((job) => (
                              <option key={job.id} value={job.id}>
                                N° {job.job_no} — {job.name}
                                {secondPassFits.has(job.id) ? ` · ${secondPassFits.get(job.id)} pièces` : ""}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                    </select>
                    {selectedJob1 && selectedJob2 && !twoPassResult && (
                      <p className="mt-1 text-xs text-amber-700">
                        Ces deux jobs ne vont pas ensemble : la passe 1 doit couper la feuille en morceaux de{" "}
                        {Math.round(selectedJob2.width_mm * 10) / 10} × {Math.round(selectedJob2.length_mm * 10) / 10} mm (la
                        feuille du job n° {selectedJob2.job_no}), et ce job doit couper ce format dans chaque morceau.
                      </p>
                    )}
                    {twoPassResult && selectedJob2 && (
                      <p className="mt-1 text-xs text-neutral-500">
                        {twoPassResult.pieces.length} morceau{twoPassResult.pieces.length > 1 ? "x" : ""} ×{" "}
                        {twoPassResult.layout.cells.length / twoPassResult.pieces.length} pièce
                        {twoPassResult.layout.cells.length / twoPassResult.pieces.length > 1 ? "s" : ""} ={" "}
                        {twoPassResult.layout.cells.length} pièces. Le code-barres
                        {selectedJob2.reg_mark ? " et le repère REG" : ""} du job n° {selectedJob2.job_no} sont posés sur
                        chaque morceau, en haut à droite une fois le morceau dans la machine.
                        {barcodeJobNos.includes(selectedJob2.job_no) ? "" : " ⚠ Aucun code-barres importé pour ce job."}
                      </p>
                    )}
                    {twoPassResult?.pieces[0]?.rotated && (
                      <label className="mt-2 block text-xs text-neutral-600">
                        Le morceau entre tourné d&apos;un quart de tour :
                        <select
                          value={duploJob2Turn}
                          onChange={(e) => setDuploJob2Turn(e.target.value === "ccw" ? "ccw" : "cw")}
                          className={`${selectClass} mt-1`}
                        >
                          <option value="cw">Tourné vers la droite (sens horaire) — code sur le bord gauche du morceau</option>
                          <option value="ccw">Tourné vers la gauche (sens antihoraire) — code sur le bord droit du morceau</option>
                        </select>
                      </label>
                    )}
                  </>
                )}
                {activeDuplo && (
                  <p className="mt-1 text-xs text-neutral-500">
                    Les pièces suivent les traits du job : marges, espacement et centrage du profil sont ignorés
                    (le décalage de calibration reste appliqué).
                    {barcodeJobNos.includes(activeDuplo.job.job_no)
                      ? " Le code-barres du job est posé au recto, à la position lue par la Duplo."
                      : ""}
                    {activeDuplo.job.reg_mark
                      ? ` Repère REG à ${Math.round(activeDuplo.job.side_mark_mm * 10) / 10} mm du bord latéral et ${Math.round(activeDuplo.job.lead_mark_mm * 10) / 10} mm du bord d'attaque, dans le même coin.`
                      : ""}
                  </p>
                )}
              </div>
            )}

            {!isDocument && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Sens des pièces</label>
                <select
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as PieceOrientation)}
                  className={selectClass}
                >
                  <option value="auto">Auto (le plus de pièces)</option>
                  <option value="normal">Normal</option>
                  <option value="rotated">Pivoté de 90°</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Retournement du verso</label>
                <select value={flip} onChange={(e) => setFlip(e.target.value as FlipEdge)} className={selectClass}>
                  <option value="long">Sur le bord long ({flipMode("long")})</option>
                  <option value="short">Sur le bord court ({flipMode("short")})</option>
                </select>
              </div>
            </div>
            )}
            {isDocument && (
              <div className="space-y-4">
                <div>
                  <label className={labelClass}>Document (PDF, toutes les pages)</label>
                  <input
                    ref={docInput}
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => handleDocFile(e.target.files?.[0] ?? null)}
                    className="mt-1 block w-full text-sm"
                  />
                  {(docFile || docStoredPath) && (
                    <p className={`mt-1 text-xs ${docInfo?.mixed ? "text-red-600" : "text-neutral-500"}`}>
                      {docName}
                      {docReading
                        ? " · lecture…"
                        : docInfo
                          ? ` · ${docInfo.pageCount} page${docInfo.pageCount > 1 ? "s" : ""} · ${sizeLabel(docInfo.widthMm, docInfo.heightMm)}${
                              docInfo.mixed ? " — pages de formats différents" : ""
                            }`
                          : ""}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Exemplaires</label>
                    <input
                      type="number"
                      min={1}
                      max={MAX_DOCUMENT_COPIES}
                      step={1}
                      value={docCopies}
                      onChange={(e) =>
                        setDocCopies(Math.min(MAX_DOCUMENT_COPIES, Math.max(1, Math.floor(Number(e.target.value)) || 1)))
                      }
                      className={selectClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Impression</label>
                    <select
                      value={docDuplex ? "duplex" : "simplex"}
                      onChange={(e) => setDocDuplex(e.target.value === "duplex")}
                      className={selectClass}
                    >
                      <option value="simplex">Recto seul</option>
                      <option value="duplex">Recto-verso</option>
                    </select>
                  </div>
                </div>

                {docDuplex && (
                  <div>
                    <label className={labelClass}>Retournement du verso</label>
                    <select value={flip} onChange={(e) => setFlip(e.target.value as FlipEdge)} className={selectClass}>
                      <option value="long">Sur le bord long ({flipMode("long")})</option>
                      <option value="short">Sur le bord court ({flipMode("short")})</option>
                    </select>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className={labelClass}>Marges et coupe</span>
                    <UnitToggle unit={docUnit} onChange={setDocUnit} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <MeasureField key={`dm-${docUnit}`} label="Marge de la feuille" valueMm={docMargin} unit={docUnit} onChange={setDocMargin} />
                    <MeasureField key={`dg-${docUnit}`} label="Espacement" valueMm={docGutter} unit={docUnit} onChange={setDocGutter} />
                    <MeasureField key={`db-${docUnit}`} label="Fond perdu (par côté)" valueMm={docBleed} unit={docUnit} onChange={setDocBleed} />
                  </div>
                  <p className="text-xs text-neutral-500">
                    Le fond perdu est celui déjà compris dans les pages du PDF (0 s&apos;il n&apos;y en a pas) : les traits
                    de coupe tombent à cette distance du bord de chaque page.
                  </p>
                  <label className="flex items-center gap-2 text-sm text-neutral-700">
                    <input type="checkbox" checked={docCropMarks} onChange={(e) => setDocCropMarks(e.target.checked)} />
                    Traits de coupe dans la marge
                  </label>
                </div>
              </div>
            )}
          </section>

          {!isDocument && (
          <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-pico-black">Fichiers à imposer</h2>

            {items.length === 0 && <p className="text-sm text-neutral-500">Aucun fichier pour l&apos;instant.</p>}
            <ul className="space-y-2">
              {items.map((item, index) => {
                const ok = matchesPiece(item, piece.widthMm, piece.heightMm);
                return (
                  <li key={item.key} className="rounded-lg border border-neutral-200 p-2.5">
                    <div className="flex items-start gap-2">
                      {items.length > 1 && (
                        <span
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-semibold text-white"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        >
                          {index + 1}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className={`text-xs ${ok ? "text-neutral-500" : "text-red-600"}`}>
                          {item.kind === "product" ? "Produit" : item.image ? "Image téléversée" : "PDF téléversé"}
                          {item.widthMm !== null && item.heightMm !== null
                            ? ` · ${sizeLabel(item.widthMm, item.heightMm)}`
                            : ""}
                          {!ok && " — taille différente du format"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setItems((c) => c.filter((i) => i.key !== item.key))}
                        aria-label="Retirer"
                        className="rounded-lg p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs text-neutral-500">Copies sur la feuille</label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={item.copies}
                        onChange={(e) =>
                          updateItem(item.key, { copies: Math.max(1, Math.floor(Number(e.target.value)) || 1) })
                        }
                        className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => fillItem(item.key)}
                        className="text-xs text-neutral-500 underline hover:text-pico-black"
                      >
                        Remplir
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="space-y-2 border-t border-neutral-100 pt-3">
              <div className="flex gap-2">
                <select
                  value={productToAdd}
                  onChange={(e) => setProductToAdd(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">
                    {availableProducts.length === 0 ? "Aucun produit avec PDF pour ce format" : "Ajouter un produit…"}
                  </option>
                  {availableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddProduct}
                  disabled={!productToAdd}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
                >
                  Ajouter
                </button>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept={["application/pdf", ...IMAGE_TYPES].join(",")}
                multiple
                onChange={(e) => handleFiles(e.target.files)}
                className="block w-full text-sm"
              />
            </div>
          </section>
          )}
        </div>

        <section className="space-y-4">
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-pico-black">Aperçu de la feuille</h2>
              <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                <input type="checkbox" checked={showCuts} onChange={(e) => setShowCuts(e.target.checked)} />
                <span className="inline-block h-0.5 w-4" style={{ backgroundColor: CUT_COLOR }} />
                {isDocument ? "Coupes au massicot" : "Coupes de la découpeuse"}
              </label>
              {activeCutter?.marks_path && (
                <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                  <input type="checkbox" checked={showMarks} onChange={(e) => setShowMarks(e.target.checked)} />
                  Marques
                </label>
              )}
              {activeCutter?.guide_path && (
                <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                  <input type="checkbox" checked={showGuide} onChange={(e) => setShowGuide(e.target.checked)} />
                  Gabarit de guidage
                </label>
              )}
              {!isDocument && layout && cellCount > 0 && (
                <p className="text-sm text-neutral-600">
                  <strong>{cellCount}</strong> pièces par feuille ({layout.cols} × {layout.rows}
                  {layout.rotated ? ", pivotées" : ""}) · {Math.min(totalCopies, cellCount)} placée
                  {Math.min(totalCopies, cellCount) > 1 ? "s" : ""}
                </p>
              )}
            </div>
            {isDocument ? (
              sheet && docPlan && docPlan.perSheet > 0 && docInfo ? (
                <DocumentPreview
                  sheet={sheet}
                  plan={docPlan}
                  pageCount={docInfo.pageCount}
                  duplex={docDuplex}
                  sheetIndex={Math.min(docSheetIndex, docPlan.sheets - 1)}
                  onSheetIndexChange={setDocSheetIndex}
                  bleedMm={showCuts ? docBleed : null}
                />
              ) : (
                <p className="text-sm text-neutral-500">{docProblem ?? "Ajoutez le PDF du document."}</p>
              )
            ) : sheet && layout ? (
              <SheetPreview
                sheet={sheet}
                layout={layout}
                assignment={assignment}
                images={items.map((item) =>
                  thumbs[item.key]
                    ? { url: thumbs[item.key], widthMm: item.widthMm, heightMm: item.heightMm }
                    : null
                )}
                multiColor={items.length > 1}
                hasBarcode={Boolean(activeDuplo && barcodeJobNos.includes(activeDuplo.job.job_no))}
                regRects={
                  activeDuplo?.job.reg_mark
                    ? regMarkRects(
                        DUPLO_MARKS.corner,
                        activeDuplo.job.side_mark_mm,
                        activeDuplo.job.lead_mark_mm,
                        sheet.width_mm,
                        sheet.height_mm
                      )
                    : null
                }
                bleedMm={showCuts ? piece.bleedMm : null}
                cutStyle={isDuplo ? "guillotine" : "contour"}
                marksUrl={
                  activeCutter?.marks_path && showMarks
                    ? `/api/imposition/cutters/${activeCutter.id}/asset/marks?v=${assetVersion}`
                    : null
                }
                guideUrl={
                  activeCutter?.guide_path && showGuide
                    ? `/api/imposition/cutters/${activeCutter.id}/asset/guide?v=${assetVersion}`
                    : null
                }
              />
            ) : (
              <p className="text-sm text-neutral-500">
                {machineProblem ??
                  (isDuplo ? "Choisissez un job Duplo pour voir la grille." : "Choisissez un profil de découpe.")}
              </p>
            )}
            <p className="mt-3 text-xs text-neutral-500">
              {isDocument ? (
                <>
                  Le numéro sur chaque pose est la page placée au recto ; en recto-verso, la page suivante est au dos.
                  Pointillés gris = zone utile (feuille moins marges). Traits orange = coupes au massicot, au bord de
                  chaque page finie : visibles ici seulement. Les traits de coupe imprimés, eux, sont dans la marge.
                </>
              ) : isDuplo ? (
                <>
                  L&apos;aperçu montre la grille ; les marques de la découpeuse et le verso apparaissent dans le PDF
                  généré. Pointillés gris = zone utile (feuille moins marges). Traits orange = coupes de la
                  découpeuse, de bord à bord de la feuille, au bord de chaque pièce finie (à l&apos;intérieur du
                  fond perdu) : visibles ici seulement, jamais dans le PDF.
                </>
              ) : (
                <>
                  Pointillés gris = zone utile (feuille moins marges). Contours orange = coupe de la Graphtec autour
                  de chaque pièce finie (à l&apos;intérieur du fond perdu). Les marques sont imprimées au recto ; le
                  gabarit de guidage et les contours orange sont visibles ici seulement, jamais dans le PDF.
                </>
              )}
            </p>
          </div>

          <div className="flex flex-col items-stretch gap-2">
            {(error || saveProblem) && (
              <p className={`text-sm ${error ? "text-red-600" : "text-neutral-500"}`}>{error ?? saveProblem}</p>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || generating || Boolean(saveProblem)}
              className="flex items-center justify-center gap-2 rounded-lg bg-pico-maroon px-4 py-2.5 text-sm font-medium text-white hover:bg-pico-maroon-dark disabled:opacity-50"
            >
              {saving && <SpinnerIcon className="h-4 w-4" />}
              {saving ? (staging ? "Envoi du PDF…" : "Enregistrement en cours...") : saved ? "Enregistrer les modifications" : "Enregistrer l'imposition"}
            </button>
            <button
              type="button"
              onClick={handlePreview}
              disabled={saving || generating || Boolean(problem)}
              className="flex items-center justify-center gap-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              {generating && <SpinnerIcon className="h-4 w-4" />}
              {generating ? (staging ? "Envoi du PDF…" : "Génération en cours...") : "Aperçu du PDF (sans enregistrer)"}
            </button>
          </div>
        </section>
      </div>

      {modal?.mode === "sheets" && (
        <Modal title="Gérer les feuilles" onClose={() => setModal(null)}>
          <SheetsManager sheets={sheets} onChanged={refreshPresets} />
        </Modal>
      )}
      {modal?.mode === "duplo-jobs" && (
        <Modal title="Jobs de la Duplo" onClose={() => setModal(null)} wide>
          <DuploJobsManager jobs={duploJobs} barcodeJobNos={barcodeJobNos} onChanged={refreshPresets} />
        </Modal>
      )}
      {modal?.mode === "graphtec-profiles" && (
        <Modal title="Profils de découpe Graphtec" onClose={() => setModal(null)} wide>
          <GraphtecProfilesManager profiles={cutters} sheets={sheets} onChanged={refreshPresets} />
        </Modal>
      )}
      {modal?.mode === "result" && (
        <Modal title="Aperçu du PDF imposé" onClose={() => setModal(null)} wide>
          <iframe src={modal.url} title="PDF imposé" className="h-[65vh] w-full rounded border border-neutral-200" />
          <a
            href={modal.url}
            download={`imposition-${sheet ? `${formatInches(sheet.width_mm)}x${formatInches(sheet.height_mm)}` : "feuille"}.pdf`}
            className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-pico-maroon px-4 py-2 text-sm font-medium text-white hover:bg-pico-maroon-dark"
          >
            <DownloadIcon className="h-4 w-4" />
            Télécharger le PDF
          </a>
        </Modal>
      )}
    </div>
  );
}

// Aperçu d'une imposition de document : une feuille à la fois (recto), le
// numéro de page sur chaque pose, et ce qu'il faut savoir pour l'impression
// et la coupe.
function DocumentPreview({
  sheet,
  plan,
  pageCount,
  duplex,
  sheetIndex,
  onSheetIndexChange,
  bleedMm,
}: {
  sheet: ImpositionSheet;
  plan: ReturnType<typeof planDocument>;
  pageCount: number;
  duplex: boolean;
  sheetIndex: number;
  onSheetIndexChange: (index: number) => void;
  bleedMm: number | null;
}) {
  // « Source » de chaque pose = la page placée au recto (son numéro s'affiche).
  const assignment = plan.layout.cells.map((_, slot) => leafAt(plan, sheetIndex, slot, duplex, pageCount)?.front ?? null);
  const copies = Math.max(1, Math.round(plan.totalLeaves / Math.max(1, plan.leavesPerCopy)));
  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600">
        <strong>{plan.perSheet}</strong> page{plan.perSheet > 1 ? "s" : ""} par feuille ({plan.layout.cols} ×{" "}
        {plan.layout.rows}
        {plan.layout.rotated ? ", pivotées" : ""}) · <strong>{plan.sheets}</strong> feuille{plan.sheets > 1 ? "s" : ""} à
        imprimer {duplex ? "en recto-verso" : "en recto seul"} · {copies} exemplaire{copies > 1 ? "s" : ""} de{" "}
        {pageCount} page{pageCount > 1 ? "s" : ""}
      </p>
      <div className="flex items-center justify-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => onSheetIndexChange(Math.max(0, sheetIndex - 1))}
          disabled={sheetIndex === 0}
          className="rounded-lg border border-neutral-300 px-2.5 py-1 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
          aria-label="Feuille précédente"
        >
          ←
        </button>
        <span className="tabular-nums text-neutral-600">
          Feuille {sheetIndex + 1} / {plan.sheets} (recto)
        </span>
        <button
          type="button"
          onClick={() => onSheetIndexChange(Math.min(plan.sheets - 1, sheetIndex + 1))}
          disabled={sheetIndex >= plan.sheets - 1}
          className="rounded-lg border border-neutral-300 px-2.5 py-1 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
          aria-label="Feuille suivante"
        >
          →
        </button>
      </div>
      <SheetPreview
        sheet={sheet}
        layout={plan.layout}
        assignment={assignment}
        images={[]}
        multiColor
        hasBarcode={false}
        regRects={null}
        bleedMm={bleedMm}
        cutStyle="guillotine"
        marksUrl={null}
        guideUrl={null}
      />
      {plan.perSheet > 1 && (
        <p className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">
          <strong>Couper et empiler :</strong> imprimez le PDF en un seul exemplaire (les {copies} exemplaires y sont
          déjà), coupez la pile, puis posez la pile de la position 2 sous celle de la position 1, la 3 sous la 2, et
          ainsi de suite (positions de gauche à droite, puis de haut en bas). Les documents sont alors dans l&apos;ordre,
          l&apos;un après l&apos;autre.
        </p>
      )}
    </div>
  );
}

function SheetPreview({
  sheet,
  layout,
  assignment,
  images,
  multiColor,
  hasBarcode,
  regRects,
  bleedMm,
  cutStyle,
  marksUrl,
  guideUrl,
}: {
  sheet: ImpositionSheet;
  layout: Layout;
  assignment: (number | null)[];
  // Miniature du recto de chaque fichier (null tant qu'elle n'est pas prête) et taille de sa page.
  images: ({ url: string; widthMm: number | null; heightMm: number | null } | null)[];
  multiColor: boolean;
  hasBarcode: boolean;
  // Traits du repère REG du job Duplo (mm), ou null.
  regRects: MmRect[] | null;
  // Fond perdu par côté ; null = lignes de coupe masquées.
  bleedMm: number | null;
  // Duplo : traits de bord à bord de la feuille. Graphtec : contour de chaque pièce.
  cutStyle: "guillotine" | "contour";
  // Marques imprimées (sous les pièces, comme dans le PDF) et gabarit de guidage
  // (par-dessus, en transparence), de la taille de la feuille. Null = masqués.
  marksUrl: string | null;
  guideUrl: string | null;
}) {
  const { usable } = layout;
  const clipPrefix = useId();
  const stroke = sheet.width_mm / 500;
  const fontSize = Math.min(layout.cellWidth, layout.cellHeight) * 0.4;
  const { xs: cutXs, ys: cutYs } =
    bleedMm === null || cutStyle !== "guillotine" ? { xs: [], ys: [] } : cutLines(layout, bleedMm);
  // Contour de coupe : la pièce finie, à `bleed` du bord de la cellule (borné comme dans cutLines).
  const contourInset =
    bleedMm === null || cutStyle !== "contour"
      ? null
      : Math.max(0, Math.min(bleedMm, Math.min(layout.cellWidth, layout.cellHeight) / 2));
  return (
    <svg
      viewBox={`0 0 ${sheet.width_mm} ${sheet.height_mm}`}
      className="mx-auto max-h-[70vh] w-auto max-w-full rounded border border-neutral-300 bg-white shadow-sm"
      style={{ aspectRatio: `${sheet.width_mm} / ${sheet.height_mm}` }}
      role="img"
      aria-label="Aperçu de l'imposition"
    >
      {marksUrl && (
        <image href={marksUrl} x={0} y={0} width={sheet.width_mm} height={sheet.height_mm} preserveAspectRatio="none" />
      )}
      <rect
        x={usable.x}
        y={usable.y}
        width={Math.max(usable.width, 0)}
        height={Math.max(usable.height, 0)}
        fill="none"
        stroke="#a99e8e"
        strokeWidth={stroke}
        strokeDasharray={`${stroke * 4} ${stroke * 3}`}
      />
      {layout.cells.map((cell, i) => {
        const source = assignment[i];
        const color = source === null ? null : multiColor ? COLORS[source % COLORS.length] : COLORS[0];
        const image = source === null ? null : images[source] ?? null;
        // Comme dans le PDF : la page est posée à plat si elle a la taille de la
        // pièce, sinon tournée d'un quart de tour (sens antihoraire).
        const sideways =
          image !== null &&
          image.widthMm !== null &&
          image.heightMm !== null &&
          !(Math.abs(image.widthMm - cell.width) <= 0.5 && Math.abs(image.heightMm - cell.height) <= 0.5);
        const cx = cell.x + cell.width / 2;
        const cy = cell.y + cell.height / 2;
        // Comme dans le PDF : une pièce dont le fond perdu chevauche une voisine
        // est rognée au milieu de l'espacement (voir computeLayout).
        const box = cell.clip ?? cell;
        const clipId = cell.clip ? `${clipPrefix}-clip-${i}` : null;
        return (
          <g key={`${cell.row}-${cell.col}`}>
            {clipId && (
              <clipPath id={clipId}>
                <rect x={box.x} y={box.y} width={box.width} height={box.height} />
              </clipPath>
            )}
            <g clipPath={clipId ? `url(#${clipId})` : undefined}>
              {image &&
                (sideways ? (
                  <image
                    href={image.url}
                    x={cx - cell.height / 2}
                    y={cy - cell.width / 2}
                    width={cell.height}
                    height={cell.width}
                    preserveAspectRatio="none"
                    transform={`rotate(-90 ${cx} ${cy})`}
                  />
                ) : (
                  <image
                    href={image.url}
                    x={cell.x}
                    y={cell.y}
                    width={cell.width}
                    height={cell.height}
                    preserveAspectRatio="none"
                  />
                ))}
            </g>
            <rect
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              fill={image ? "none" : color ?? "none"}
              fillOpacity={0.35}
              stroke={color ?? "#a99e8e"}
              strokeWidth={stroke}
              strokeDasharray={color ? undefined : `${stroke * 3} ${stroke * 3}`}
            />
            {multiColor && source !== null && !image && (
              <text
                x={cell.x + cell.width / 2}
                y={cell.y + cell.height / 2}
                fontSize={fontSize}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#1a1613"
                fillOpacity={0.6}
              >
                {source + 1}
              </text>
            )}
          </g>
        );
      })}
      {contourInset !== null &&
        layout.cells.map((cell) => (
          <rect
            key={`cut-${cell.row}-${cell.col}`}
            x={cell.x + contourInset}
            y={cell.y + contourInset}
            width={cell.width - contourInset * 2}
            height={cell.height - contourInset * 2}
            fill="none"
            stroke={CUT_COLOR}
            strokeWidth={stroke * 1.2}
          />
        ))}
      {cutXs.map((x) => (
        <line key={`cx-${x}`} x1={x} y1={0} x2={x} y2={sheet.height_mm} stroke={CUT_COLOR} strokeWidth={stroke * 1.2} />
      ))}
      {cutYs.map((y) => (
        <line key={`cy-${y}`} x1={0} y1={y} x2={sheet.width_mm} y2={y} stroke={CUT_COLOR} strokeWidth={stroke * 1.2} />
      ))}
      {regRects?.map((r, i) => (
        <rect key={`reg-${i}`} x={r.x} y={r.y} width={r.width} height={r.height} fill="#1a1613" />
      ))}
      {guideUrl && (
        // Tout au-dessus, opaque, pour lire les coupes sur les visuels ;
        // « multiply » rend le blanc du gabarit transparent : seuls ses traits recouvrent les pièces.
        <image
          href={guideUrl}
          x={0}
          y={0}
          width={sheet.width_mm}
          height={sheet.height_mm}
          preserveAspectRatio="none"
          style={{ mixBlendMode: "multiply" }}
        />
      )}
      {(hasBarcode || regRects) && (
        <text x={sheet.width_mm / 2} y={sheet.height_mm - 2} fontSize={sheet.width_mm / 45} textAnchor="middle" fill="#7d7364">
          + {[hasBarcode && "code-barres du job", regRects && "repère REG"]
            .filter(Boolean)
            .join(" + ")}
        </text>
      )}
    </svg>
  );
}
