// Construction du PDF imposé à partir de la requête envoyée par l'écran
// d'imposition. Partagée par l'aperçu (sans enregistrement) et par
// l'enregistrement d'une imposition : les deux produisent exactement le même PDF.

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase/server";
import { PDFDocument } from "pdf-lib";
import {
  imposeToPdf,
  impositionLayout,
  type ImposeInput,
  type ImpositionBarcode,
  type ImpositionMarks,
  type ImpositionRegMark,
  type ImpositionSource,
  type DuploSecondPass,
} from "@/lib/imposition/render";
import { barcodePath } from "@/lib/imposition/barcodes";
import { productDisplayName } from "@/lib/imposition/productLabel";
import { DUPLO_MARKS } from "@/lib/imposition/duplo";
import { isMachine } from "@/lib/imposition/machines";
import { detectMarksKind } from "@/lib/imposition/marks";
import { imposeDocumentToPdf } from "@/lib/imposition/document";
import { MAX_DOCUMENT_COPIES, leafAt, planDocumentOn } from "@/lib/imposition/documentPlan";
import { STAGED_SOURCE_PATH, STORED_SOURCE_PATH, sourcesDir } from "@/lib/imposition/saved";
import type { FlipEdge, Layout, PieceOrientation } from "@/lib/imposition/layout";
import type { ImpositionCutter, ImpositionDuploJob, ImpositionSheet } from "@/lib/types";

// Erreur à renvoyer telle quelle à l'utilisateur (message en français + code HTTP).
export class ImpositionError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

// Un fichier à imposer, tel qu'envoyé par l'écran : un produit Pico, un PDF
// téléversé (dans le champ `field` de la requête) ou un PDF déjà enregistré
// avec l'imposition qu'on modifie (`path`).
// Fichier de verso joint à un fichier (dos commun des cartes d'affaires…) :
// téléversé, déposé dans le stockage, ou déjà enregistré avec l'imposition.
export type BackRef = { name?: string } & (
  | { kind: "upload"; field: string }
  | { kind: "staged"; path: string }
  | { kind: "stored"; path: string }
);

export type SourceSpec = {
  copies: number;
  name?: string;
  widthMm?: number | null;
  heightMm?: number | null;
  pageCount?: number | null;
  back?: BackRef | null;
} & (
  | { kind: "product"; productId: string }
  | { kind: "upload"; field: string }
  | { kind: "stored"; path: string }
  // PDF déposé directement dans le stockage par le navigateur (voir
  // app/api/imposition/stage) : seul son chemin voyage dans la requête.
  | { kind: "staged"; path: string }
);

export interface BuiltSource {
  spec: SourceSpec;
  name: string;
  // Octets du PDF pour un fichier téléversé ou déjà enregistré (à ranger avec l'imposition).
  bytes: Uint8Array | null;
  // Verso joint : ses octets et son nom (à ranger aussi).
  back?: { bytes: Uint8Array; name: string } | null;
}

export interface BuiltImposition {
  pdf: Buffer;
  sheet: ImpositionSheet;
  // Selon la machine : le job Duplo ou le profil Graphtec utilisé.
  duploJob: ImpositionDuploJob | null;
  cutter: ImpositionCutter | null;
  sources: BuiltSource[];
  // Nombre de feuilles imposées (plusieurs en mise en production).
  sheetCount?: number;
}

// Clients Supabase utilisés (celui de l'utilisateur connecté, et le client
// administrateur pour le stockage) : injectables pour les tests.
export interface SupabaseClients {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  admin: ReturnType<typeof createAdminSupabaseClient>;
}

export const serverClients = (): SupabaseClients => ({
  supabase: createServerSupabaseClient(),
  admin: createAdminSupabaseClient(),
});

export async function buildImposition(
  formData: FormData,
  { supabase, admin }: SupabaseClients = serverClients()
): Promise<BuiltImposition> {

  const sheetId = String(formData.get("sheetId") ?? "");
  const machine = formData.get("machine");
  const pieceWidth = Number(formData.get("pieceWidthMm"));
  const pieceHeight = Number(formData.get("pieceHeightMm"));
  const orientationRaw = String(formData.get("orientation") ?? "auto");
  const orientation: PieceOrientation =
    orientationRaw === "normal" || orientationRaw === "rotated" ? orientationRaw : "auto";
  const flip: FlipEdge = formData.get("flip") === "short" ? "short" : "long";
  const duploJobId = String(formData.get("duploJobId") ?? "");
  // 2e passe sur la Duplo (facultative) : le job qui repasse chaque morceau.
  const duploJob2Id = String(formData.get("duploJob2Id") ?? "");
  // Morceau tourné d'un quart de tour pour la 2e passe : sens horaire ou antihoraire.
  const duploJob2Turn = formData.get("duploJob2Turn") === "ccw" ? "ccw" : "cw";
  const cutterId = String(formData.get("cutterId") ?? "");
  const pieceBleedMm = Number(formData.get("pieceBleedMm") ?? 0) || 0;
  // Imposition qu'on modifie : seuls ses propres PDF enregistrés peuvent être réutilisés.
  const impositionId = String(formData.get("impositionId") ?? "");
  const storedPrefix = /^[0-9a-f-]{36}$/i.test(impositionId) ? `${sourcesDir(impositionId)}/` : null;

  // Document de plusieurs pages (feuilles séparées, massicot) : ni format de
  // pièce, ni machine — sa propre construction. Passé à la découpeuse, il suit
  // le chemin des pièces (grille et marques de la machine), dans l'ordre du
  // plan du document (voir documentPlacement).
  const documentOnMachine = formData.get("mode") === "document" && formData.get("cutting") === "machine";
  if (formData.get("mode") === "document" && !documentOnMachine) {
    return buildDocumentImposition(formData, sheetId, flip, storedPrefix, { supabase, admin });
  }

  if (!(pieceWidth > 0) || !(pieceHeight > 0)) throw new ImpositionError("Le format de la pièce est invalide.");

  let specs: SourceSpec[];
  try {
    specs = JSON.parse(String(formData.get("sources") ?? "[]"));
  } catch {
    throw new ImpositionError("Liste de fichiers invalide.");
  }
  if (!Array.isArray(specs) || specs.length === 0) throw new ImpositionError("Ajoutez au moins un fichier.");
  if (documentOnMachine) {
    if (specs.length !== 1) throw new ImpositionError("Ajoutez le PDF du document.");
    if (specs[0].copies > MAX_DOCUMENT_COPIES) {
      throw new ImpositionError(`Le nombre d'exemplaires doit être un entier de 1 à ${MAX_DOCUMENT_COPIES}.`);
    }
  }
  if (specs.some((s) => !Number.isInteger(s.copies) || s.copies < 1)) {
    throw new ImpositionError("Le nombre de copies doit être un entier d'au moins 1.");
  }

  if (!isMachine(machine)) throw new ImpositionError("Machine inconnue.");

  // Ce que la machine impose à la feuille : sa taille, sa grille et ses marques.
  // La Duplo tire tout d'un job de son catalogue ; la Graphtec, d'un profil de découpe.
  let sheet: ImpositionSheet;
  let duploJob: ImpositionDuploJob | null = null;
  let cutter: ImpositionCutter | null = null;
  if (machine === "duplo") {
    if (!duploJobId) throw new ImpositionError("Choisissez un job Duplo.");
    const [{ data: foundSheet }, { data: foundJob }] = await Promise.all([
      supabase.from("imposition_sheets").select("*").eq("id", sheetId).single<ImpositionSheet>(),
      supabase.from("imposition_duplo_jobs").select("*").eq("id", duploJobId).single<ImpositionDuploJob>(),
    ]);
    if (!foundSheet) throw new ImpositionError("Feuille introuvable.", 404);
    if (!foundJob) throw new ImpositionError("Job Duplo introuvable.", 404);
    sheet = foundSheet;
    duploJob = foundJob;
  } else {
    if (!cutterId) throw new ImpositionError("Choisissez un profil de découpe Graphtec.");
    const { data: foundCutter } = await supabase
      .from("imposition_cutters")
      .select("*")
      .eq("id", cutterId)
      .eq("machine", "graphtec")
      .single<ImpositionCutter>();
    if (!foundCutter) throw new ImpositionError("Profil de découpe introuvable.", 404);
    // La feuille est celle du profil : ses marques sont dessinées à sa taille.
    if (!foundCutter.sheet_id) {
      throw new ImpositionError(`Le profil « ${foundCutter.name} » n'a plus de format de papier : modifiez-le.`);
    }
    const { data: foundSheet } = await supabase
      .from("imposition_sheets")
      .select("*")
      .eq("id", foundCutter.sheet_id)
      .single<ImpositionSheet>();
    if (!foundSheet) throw new ImpositionError("Feuille du profil introuvable.", 404);
    sheet = foundSheet;
    cutter = foundCutter;
  }

  const sources: ImpositionSource[] = [];
  const built: BuiltSource[] = [];
  // Fichiers de plusieurs pages : recto-verso (pages 1-2, 3-4…) ou recto seul
  // (une pièce par page). Absent : comme avant, page 1 et page 2 au dos.
  const sourcePages = formData.get("sourcePages");
  for (const spec of specs) {
    const loaded = await loadSource(spec, formData, storedPrefix, { supabase, admin });
    const back = spec.back ? await loadBack(spec.back, spec.name || loaded.built.name, formData, storedPrefix, admin) : null;
    const source: ImpositionSource = back ? { ...loaded.source, backPdf: back.bytes } : loaded.source;
    if (sourcePages === "duplex" || sourcePages === "simplex" || back) {
      // Avec un verso joint, les pages du fichier sont toutes des rectos.
      sources.push(...(await expandPages(source, !back && sourcePages === "duplex")));
    } else {
      sources.push(source);
    }
    built.push({ ...loaded.built, back });
  }

  // Ce qui dépend de la machine : la grille et les marques imprimées au recto.
  let machineInput: Pick<
    ImposeInput,
    | "margins"
    | "gutterX"
    | "gutterY"
    | "offsetX"
    | "offsetY"
    | "centerGrid"
    | "grid"
    | "trimBleed"
    | "marks"
    | "barcode"
    | "regMark"
    | "duploJob"
    | "duploJob2"
    | "secondPass"
  >;
  if (duploJob) {
    // Code-barres d'un job Duplo (s'il en a un d'importé), à la position fixe
    // lue par la machine, et son repère REG dans le même coin, aux distances du job.
    async function jobMarks(job: ImpositionDuploJob) {
      let barcode: ImpositionBarcode | null = null;
      const { data: barcodeFile } = await admin.storage.from("imposition").download(barcodePath(job.job_no));
      if (barcodeFile) {
        barcode = {
          pdf: new Uint8Array(await barcodeFile.arrayBuffer()),
          corner: DUPLO_MARKS.corner,
          xMm: DUPLO_MARKS.barcodeXMm,
          yMm: DUPLO_MARKS.barcodeYMm,
          rotation: DUPLO_MARKS.barcodeRotation,
        };
      }
      const regMark: ImpositionRegMark | null = job.reg_mark
        ? { corner: DUPLO_MARKS.corner, sideMm: job.side_mark_mm, leadMm: job.lead_mark_mm }
        : null;
      return { barcode, regMark };
    }
    const { barcode, regMark } = await jobMarks(duploJob);
    // 2e passe : le 1er job coupe la feuille en morceaux, le 2e coupe la pièce
    // finale dans chacun (voir computeDuploTwoPassLayout).
    let secondPass: DuploSecondPass | null = null;
    let job2Geometry: ImposeInput["duploJob2"] = null;
    if (duploJob2Id) {
      const { data: job2 } = await supabase
        .from("imposition_duplo_jobs")
        .select("*")
        .eq("id", duploJob2Id)
        .single<ImpositionDuploJob>();
      if (!job2) throw new ImpositionError("Job Duplo de la 2e passe introuvable.", 404);
      secondPass = { ...(await jobMarks(job2)), turn: duploJob2Turn };
      job2Geometry = { widthMm: job2.width_mm, lengthMm: job2.length_mm, slits: job2.slits, cuts: job2.cuts };
    }
    machineInput = {
      // Marges, espacement et calibration ne servent pas : la grille vient du job.
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      gutterX: 0,
      gutterY: 0,
      offsetX: 0,
      offsetY: 0,
      centerGrid: false,
      grid: null,
      trimBleed: null,
      marks: null,
      barcode,
      regMark,
      secondPass,
      duploJob2: job2Geometry,
      duploJob: {
        widthMm: duploJob.width_mm,
        lengthMm: duploJob.length_mm,
        slits: duploJob.slits,
        cuts: duploJob.cuts,
      },
    };
  } else {
    const profile = cutter!;
    // Codes et repères de la Graphtec, imprimés au recto. Le gabarit de
    // guidage, lui, ne sert qu'à l'aperçu : il n'entre jamais dans le PDF.
    let marks: ImpositionMarks | null = null;
    if (profile.marks_path) {
      const { data: marksFile } = await admin.storage.from("imposition").download(profile.marks_path);
      if (!marksFile) throw new ImpositionError(`Le fichier de marques du profil « ${profile.name} » est introuvable.`, 404);
      const bytes = new Uint8Array(await marksFile.arrayBuffer());
      const kind = detectMarksKind(bytes);
      if (!kind) throw new ImpositionError(`Le fichier de marques du profil « ${profile.name} » est illisible.`);
      marks = { bytes, kind };
    }
    machineInput = {
      margins: {
        top: profile.margin_top_mm,
        right: profile.margin_right_mm,
        bottom: profile.margin_bottom_mm,
        left: profile.margin_left_mm,
      },
      gutterX: profile.gutter_x_mm,
      gutterY: profile.gutter_y_mm,
      offsetX: profile.offset_x_mm,
      offsetY: profile.offset_y_mm,
      centerGrid: profile.center_grid,
      grid: { cols: profile.grid_cols, rows: profile.grid_rows },
      // La Graphtec découpe au contour : marges et espacement partent du trait de coupe.
      trimBleed: pieceBleedMm,
      marks,
      barcode: null,
      regMark: null,
      duploJob: null,
      duploJob2: null,
      secondPass: null,
    };
  }

  try {
    const base = {
      sheetWidth: sheet.width_mm,
      sheetHeight: sheet.height_mm,
      ...machineInput,
      pieceWidth,
      pieceHeight,
      orientation,
      flip,
      pieceBleedMm,
    };
    // Plusieurs feuilles (mise en production, ou plus de pièces que
    // d'emplacements) : les copies remplissent les emplacements feuille après
    // feuille, réunies dans un seul PDF.
    const machineLayout = impositionLayout(base).layout;
    if (documentOnMachine) {
      const merged = await PDFDocument.create();
      const onSheets = await documentPlacement(sources[0], machineLayout, formData);
      for (const onSheet of onSheets) {
        const one = await imposeToPdf({ ...base, sources: onSheet });
        const doc = await PDFDocument.load(one.pdf);
        (await merged.copyPages(doc, doc.getPageIndices())).forEach((page) => merged.addPage(page));
      }
      return { pdf: Buffer.from(await merged.save()), sheet, duploJob, cutter, sources: built, sheetCount: onSheets.length };
    }
    const perSheet = machineLayout.cells.length;
    const pieceCount = sources.reduce((n, s) => n + s.copies, 0);
    if (formData.get("multiSheet") === "1" || pieceCount > perSheet) {
      const queue = sources.map((s) => ({ ...s }));
      const merged = await PDFDocument.create();
      let sheetCount = 0;
      while (queue.some((s) => s.copies > 0)) {
        let room = perSheet;
        const onSheet: ImpositionSource[] = [];
        for (const s of queue) {
          if (room === 0) break;
          const take = Math.min(room, s.copies);
          if (take === 0) continue;
          onSheet.push({ ...s, copies: take });
          s.copies -= take;
          room -= take;
        }
        const one = await imposeToPdf({ ...base, sources: onSheet });
        const doc = await PDFDocument.load(one.pdf);
        (await merged.copyPages(doc, doc.getPageIndices())).forEach((page) => merged.addPage(page));
        sheetCount += 1;
      }
      return { pdf: Buffer.from(await merged.save()), sheet, duploJob, cutter, sources: built, sheetCount };
    }
    const result = await imposeToPdf({ ...base, sources });
    return { pdf: result.pdf, sheet, duploJob, cutter, sources: built, sheetCount: 1 };
  } catch (err) {
    throw new ImpositionError(err instanceof Error ? err.message : "Erreur lors de l'imposition.");
  }
}

/**
 * Un document passé à la découpeuse : les pièces de chaque feuille, pose par
 * pose, selon le plan du document (assemblé, couper et empiler, ou cartons)
 * calculé sur la grille de la machine.
 */
async function documentPlacement(source: ImpositionSource, layout: Layout, formData: FormData): Promise<ImpositionSource[][]> {
  let pageCount: number;
  try {
    pageCount = (await PDFDocument.load(source.pdf, { updateMetadata: false })).getPageCount();
  } catch {
    throw new ImpositionError(`« ${source.name} » n'est pas un PDF lisible.`);
  }
  const duplex = formData.get("duplex") === "true";
  const plan = planDocumentOn(layout, {
    pageCount,
    duplex,
    copies: source.copies,
    collated: formData.get("collated") === "true",
    eachPage: formData.get("eachPage") === "true",
  });
  const sheets: ImpositionSource[][] = [];
  for (let sheet = 0; sheet < plan.sheets; sheet++) {
    const onSheet: ImpositionSource[] = [];
    // Les poses vides sont toujours en fin de feuille : les pièces se suivent.
    for (let slot = 0; slot < plan.perSheet; slot++) {
      const leaf = leafAt(plan, sheet, slot, duplex, pageCount);
      if (!leaf) break;
      const last = onSheet[onSheet.length - 1];
      if (last && last.page === leaf.front && last.backPage === leaf.back) last.copies += 1;
      else onSheet.push({ ...source, copies: 1, page: leaf.front, backPage: leaf.back });
    }
    sheets.push(onSheet);
  }
  return sheets;
}

/**
 * Un PDF de plusieurs pages en pièces : une par page (recto seul), ou une
 * par paire de pages (recto-verso : 1-2, 3-4… ; une dernière page impaire
 * n'a pas de verso). Chaque pièce reprend le nombre de copies du fichier.
 */
async function expandPages(source: ImpositionSource, duplex: boolean): Promise<ImpositionSource[]> {
  const pageCount = async (bytes: Uint8Array, label: string) => {
    try {
      return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
    } catch {
      throw new ImpositionError(`${label} n'est pas un PDF lisible.`);
    }
  };
  const count = await pageCount(source.pdf, `« ${source.name} »`);
  // Verso joint : une seule page = le même dos pour toutes les pièces ;
  // autant de pages que de pièces = un dos par pièce, dans l'ordre.
  if (source.backPdf) {
    const backCount = await pageCount(source.backPdf, `Le verso de « ${source.name} »`);
    return Array.from({ length: count }, (_, page) => ({
      ...source,
      name: count > 1 ? `${source.name} (p. ${page + 1})` : source.name,
      page,
      backPage: backCount >= count ? page : 0,
    }));
  }
  if (count <= 1) return [{ ...source, backPage: null }];
  const step = duplex ? 2 : 1;
  const pieces: ImpositionSource[] = [];
  for (let page = 0; page < count; page += step) {
    const backPage = duplex && page + 1 < count ? page + 1 : null;
    const label = backPage === null ? `p. ${page + 1}` : `p. ${page + 1}-${page + 2}`;
    pieces.push({ ...source, name: `${source.name} (${label})`, page, backPage });
  }
  return pieces;
}

// Charge le verso joint à un fichier, d'où qu'il vienne.
async function loadBack(
  ref: BackRef,
  ofName: string,
  formData: FormData,
  storedPrefix: string | null,
  admin: SupabaseClients["admin"]
): Promise<{ bytes: Uint8Array; name: string }> {
  const name = ref.name || `Verso de ${ofName}`;
  if (ref.kind === "upload") {
    const file = formData.get(ref.field);
    if (!(file instanceof File) || file.size === 0) throw new ImpositionError(`Le verso de « ${ofName} » est manquant.`);
    return { bytes: new Uint8Array(await file.arrayBuffer()), name: ref.name || file.name };
  }
  const allowed =
    ref.kind === "staged"
      ? STAGED_SOURCE_PATH.test(ref.path)
      : Boolean(storedPrefix && ref.path.startsWith(storedPrefix) && STORED_SOURCE_PATH.test(ref.path));
  if (typeof ref.path !== "string" || !allowed) throw new ImpositionError(`Verso de « ${ofName} » invalide.`);
  const { data: file } = await admin.storage.from("imposition").download(ref.path);
  if (!file) throw new ImpositionError(`Le verso de « ${ofName} » est introuvable : ajoutez-le de nouveau.`, 404);
  return { bytes: new Uint8Array(await file.arrayBuffer()), name };
}

// Charge un fichier à imposer : un PDF téléversé (champ du formulaire), un PDF
// déjà enregistré avec l'imposition qu'on modifie (sous `storedPrefix`
// seulement), ou le PDF d'un produit Pico.
async function loadSource(
  spec: SourceSpec,
  formData: FormData,
  storedPrefix: string | null,
  { supabase, admin }: SupabaseClients
): Promise<{ source: ImpositionSource; built: BuiltSource }> {
  if (spec.kind === "staged") {
    if (typeof spec.path !== "string" || !STAGED_SOURCE_PATH.test(spec.path)) {
      throw new ImpositionError("Fichier déposé invalide.");
    }
    const { data: file, error } = await admin.storage.from("imposition").download(spec.path);
    if (error || !file) throw new ImpositionError("Le PDF déposé est introuvable : ajoutez-le de nouveau.", 404);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = spec.name || "fichier.pdf";
    return { source: { name, pdf: bytes, copies: spec.copies }, built: { spec, name, bytes } };
  }
  if (spec.kind === "upload") {
    const file = formData.get(spec.field);
    if (!(file instanceof File) || file.size === 0) throw new ImpositionError("Fichier PDF manquant.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { source: { name: file.name, pdf: bytes, copies: spec.copies }, built: { spec, name: file.name, bytes } };
  } else if (spec.kind === "stored") {
    if (
      !storedPrefix ||
      typeof spec.path !== "string" ||
      !spec.path.startsWith(storedPrefix) ||
      !STORED_SOURCE_PATH.test(spec.path)
    ) {
      throw new ImpositionError("Fichier enregistré invalide.");
    }
    const { data: file, error } = await admin.storage.from("imposition").download(spec.path);
    if (error || !file) throw new ImpositionError("Un PDF enregistré avec cette imposition est introuvable.", 404);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = spec.name || spec.path.split("/").pop() || "fichier.pdf";
    return { source: { name, pdf: bytes, copies: spec.copies }, built: { spec, name, bytes } };
  } else if (spec.kind === "product") {
    const { data: product } = await supabase
      .from("products")
      .select("name, pdf_path, image_path, visual_id")
      .eq("id", spec.productId)
      .single<{ name: string; pdf_path: string | null; image_path: string | null; visual_id: string | null }>();
    if (!product) throw new ImpositionError("Produit introuvable.", 404);
    if (!product.pdf_path) {
      throw new ImpositionError(`Le PDF de « ${product.name} » n'a pas encore été généré.`);
    }
    const { data: file, error } = await admin.storage.from("outputs").download(product.pdf_path);
    if (error || !file) throw new ImpositionError(`PDF introuvable pour « ${product.name} ».`, 404);
    const { data: visual } = product.visual_id
      ? await supabase.from("visuals").select("name").eq("id", product.visual_id).single<{ name: string }>()
      : { data: null };
    const label = productDisplayName(product, new Map(visual && product.visual_id ? [[product.visual_id, visual.name]] : []));
    return {
      source: { name: label, pdf: new Uint8Array(await file.arrayBuffer()), copies: spec.copies },
      built: { spec, name: label, bytes: null },
    };
  } else {
    throw new ImpositionError("Type de fichier inconnu.");
  }
}

// Lit un nombre de millimètres du formulaire, dans [0, max].
function mmField(formData: FormData, key: string, fallback: number, max = 100): number {
  const raw = formData.get(key);
  const value = raw === null || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new ImpositionError("Les marges, l'espacement et le fond perdu doivent être des nombres positifs.");
  }
  return value;
}

// Imposition d'un document de plusieurs pages (voir lib/imposition/document.ts).
async function buildDocumentImposition(
  formData: FormData,
  sheetId: string,
  flip: FlipEdge,
  storedPrefix: string | null,
  clients: SupabaseClients
): Promise<BuiltImposition> {
  let specs: SourceSpec[];
  try {
    specs = JSON.parse(String(formData.get("sources") ?? "[]"));
  } catch {
    throw new ImpositionError("Fichier invalide.");
  }
  if (!Array.isArray(specs) || specs.length !== 1) throw new ImpositionError("Ajoutez le PDF du document.");
  const spec = specs[0];
  const copies = spec.copies;
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_DOCUMENT_COPIES) {
    throw new ImpositionError(`Le nombre d'exemplaires doit être un entier de 1 à ${MAX_DOCUMENT_COPIES}.`);
  }

  const { data: sheet } = await clients.supabase
    .from("imposition_sheets")
    .select("*")
    .eq("id", sheetId)
    .single<ImpositionSheet>();
  if (!sheet) throw new ImpositionError("Feuille introuvable.", 404);

  const { source, built } = await loadSource(spec, formData, storedPrefix, clients);
  try {
    const result = await imposeDocumentToPdf({
      name: source.name,
      pdf: source.pdf,
      sheetWidth: sheet.width_mm,
      sheetHeight: sheet.height_mm,
      marginMm: mmField(formData, "marginMm", 5),
      gutterMm: mmField(formData, "gutterMm", 0),
      bleedMm: mmField(formData, "bleedMm", 0, 20),
      duplex: formData.get("duplex") === "true",
      flip,
      copies,
      collated: formData.get("collated") === "true",
      eachPage: formData.get("eachPage") === "true",
      cropMarks: formData.get("cropMarks") !== "false",
    });
    return { pdf: result.pdf, sheet, duploJob: null, cutter: null, sources: [built] };
  } catch (err) {
    if (err instanceof ImpositionError) throw err;
    throw new ImpositionError(err instanceof Error ? err.message : "Erreur lors de l'imposition.");
  }
}
