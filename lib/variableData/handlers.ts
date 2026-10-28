// Routes communes des documents à données variables : cartes étudiantes
// (student_card_templates) et gabarits bâtis sur un modèle (data_templates).
// Chaque route ne fait que choisir sa configuration : table, bucket des
// fonds, format de page et champs propres (l'école d'une carte…).

import { NextResponse } from "next/server";
import sharp from "sharp";
import { pdfToPng } from "pdf-to-png-converter";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { detectMarksKind } from "@/lib/imposition/marks";
import { contentDisposition } from "@/lib/contentDisposition";
import { parseUserGuides } from "./snap";
import { CardAssetError, SIDE_COLUMN, applyCardBackgrounds } from "@/lib/studentCards/assets";
import { MAX_CARDS_PER_RENDER, renderStudentCards, type CardInput } from "@/lib/studentCards/render";
import { ZONE_IMAGE_PATH, parseCardSample, parseCardZones, type CardSample, type CardZone } from "@/lib/studentCards/types";
import { randomUUID } from "crypto";

type Supabase = ReturnType<typeof createServerSupabaseClient>;

// Colonnes communes aux deux tables.
export interface VariableDataRow {
  id: string;
  name: string;
  two_sided: boolean;
  front_path: string | null;
  back_path: string | null;
  zones: CardZone[];
  sample: CardSample | null;
  photo_column: string | null;
  data_path?: string | null;
  data_filename?: string | null;
}

// Fichier de données conservé avec le document (voir 0081) : Excel ou CSV.
const DATA_EXTENSIONS: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
};
// Sous la limite d'une requête (4,5 Mo) ; une liste de quelques milliers de
// lignes pèse bien moins.
const MAX_DATA_BYTES = 4 * 1024 * 1024;

export interface VariableDataConfig {
  table: "student_card_templates" | "data_templates";
  bucket: string;
  // Format de la page (mm, fond perdu compris) d'une ligne de la table.
  pageSize: (row: Record<string, unknown>, supabase: Supabase) => Promise<{ width: number; height: number } | null>;
  // Champs texte propres à la table, enregistrés tels quels (nettoyés).
  textFields?: string[];
}

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
const clean = (v: FormDataEntryValue | null, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function parseJson(value: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

async function session() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function loadRow(supabase: Supabase, cfg: VariableDataConfig, id: string) {
  const { data } = await supabase.from(cfg.table).select("*").eq("id", id).single();
  return (data as (VariableDataRow & Record<string, unknown>) | null) ?? null;
}

// Enregistre un document : nom, champs propres, recto-verso, zones et aperçu
// (JSON), fonds (multipart).
export async function patchVariableData(request: Request, id: string, cfg: VariableDataConfig) {
  const { supabase, user } = await session();
  if (!user) return json({ error: "Non authentifié." }, 401);
  const current = await loadRow(supabase, cfg, id);
  if (!current) return json({ error: "Introuvable." }, 404);
  const page = await cfg.pageSize(current, supabase);
  if (!page) return json({ error: "Le modèle de ce gabarit est introuvable." }, 404);

  const form = await request.formData();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (form.has("name")) {
    const name = clean(form.get("name"), 120);
    if (!name) return json({ error: "Donnez un nom." }, 400);
    update.name = name;
  }
  for (const field of cfg.textFields ?? []) if (form.has(field)) update[field] = clean(form.get(field), 120);
  if (form.has("two_sided")) update.two_sided = form.get("two_sided") === "true";
  if (form.has("zones")) {
    const zones = parseCardZones(parseJson(form.get("zones")), page.width, page.height);
    if (!zones) return json({ error: "Zones invalides : chacune doit avoir une taille et rester dans la page." }, 400);
    update.zones = zones;
  }
  if (form.has("sample")) update.sample = parseCardSample(parseJson(form.get("sample")));
  if (form.has("photo_column")) update.photo_column = clean(form.get("photo_column"), 100) || null;
  if (form.has("guides")) {
    const guides = parseUserGuides(parseJson(form.get("guides")), page.width, page.height);
    if (!guides) return json({ error: "Repères invalides." }, 400);
    update.guides = guides;
  }

  try {
    const storage = createAdminSupabaseClient().storage;
    Object.assign(update, await applyCardBackgrounds(storage, current.id, form, current, cfg.bucket));
    // Fichier de données : un nouveau remplace l'ancien ; `remove_data` le retire.
    const data = form.get("data");
    if (data instanceof File && data.size > 0) {
      const ext = data.name.split(".").pop()?.toLowerCase() ?? "";
      if (!DATA_EXTENSIONS[ext]) throw new CardAssetError("Fichier de données : Excel (.xlsx) ou CSV attendu.");
      if (data.size > MAX_DATA_BYTES) throw new CardAssetError("Fichier de données trop lourd (4 Mo au plus).");
      const path = `${current.id}/data.${ext}`;
      const { error } = await storage
        .from(cfg.bucket)
        .upload(path, new Uint8Array(await data.arrayBuffer()), { contentType: DATA_EXTENSIONS[ext], upsert: true });
      if (error) throw new CardAssetError(`Enregistrement de « ${data.name} » impossible : ${error.message}`);
      if (current.data_path && current.data_path !== path) await storage.from(cfg.bucket).remove([current.data_path]);
      update.data_path = path;
      update.data_filename = data.name.slice(0, 200);
    } else if (form.get("remove_data") === "true" && current.data_path) {
      await storage.from(cfg.bucket).remove([current.data_path]);
      update.data_path = null;
      update.data_filename = null;
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Enregistrement impossible." }, err instanceof CardAssetError ? 400 : 500);
  }

  const { data, error } = await supabase.from(cfg.table).update(update).eq("id", current.id).select().single();
  if (error) return json({ error: error.message }, 500);
  // Images de zones qui ne servent plus (zone supprimée, image remplacée).
  if (update.zones) {
    const used = new Set((update.zones as CardZone[]).flatMap((z) => [z.imagePath, z.maskPath].filter((p): p is string => !!p)));
    const storage = createAdminSupabaseClient().storage.from(cfg.bucket);
    const { data: files } = await storage.list(`${current.id}/images`);
    const unused = (files ?? []).map((f) => `${current.id}/images/${f.name}`).filter((path) => !used.has(path));
    if (unused.length > 0) await storage.remove(unused);
  }
  return json({ row: data });
}

export async function deleteVariableData(id: string, cfg: VariableDataConfig) {
  const { supabase, user } = await session();
  if (!user) return json({ error: "Non authentifié." }, 401);
  const { data, error } = await supabase.from(cfg.table).delete().eq("id", id).select("front_path, back_path, data_path");
  if (error) return json({ error: error.message }, 500);
  if (!data || data.length === 0) return json({ error: "Introuvable." }, 404);
  const files = (data as { front_path: string | null; back_path: string | null; data_path: string | null }[])
    .flatMap((row) => [row.front_path, row.back_path, row.data_path])
    .filter((p): p is string => Boolean(p));
  const storage = createAdminSupabaseClient().storage.from(cfg.bucket);
  const { data: images } = await storage.list(`${id}/images`);
  files.push(...(images ?? []).map((f) => `${id}/images/${f.name}`));
  if (files.length > 0) await storage.remove(files);
  return json({ ok: true });
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Image fixe d'une zone (logo, signature…) : enregistrée sous <id>/images/,
 * en PNG (transparence gardée ; WebP et SVG convertis) ou en JPEG. Renvoie
 * son chemin, que l'éditeur met dans la zone.
 */
export async function uploadVariableDataImage(request: Request, id: string, cfg: VariableDataConfig) {
  const { supabase, user } = await session();
  if (!user) return json({ error: "Non authentifié." }, 401);
  if (!(await loadRow(supabase, cfg, id))) return json({ error: "Introuvable." }, 404);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return json({ error: "Choisissez une image." }, 400);
  if (file.size > MAX_IMAGE_BYTES) return json({ error: "Image trop lourde (4 Mo au plus)." }, 400);
  let bytes: Buffer;
  let ext: "png" | "jpg";
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const meta = await sharp(input, { density: 600 }).metadata();
    if (meta.format === "jpeg") {
      bytes = input;
      ext = "jpg";
    } else if (meta.format === "png" || meta.format === "webp" || meta.format === "svg" || meta.format === "gif") {
      bytes = meta.format === "png" ? input : await sharp(input, { density: 600 }).png().toBuffer();
      ext = "png";
    } else {
      throw new Error();
    }
  } catch {
    return json({ error: "Image illisible : PNG, JPEG, WebP ou SVG attendu." }, 400);
  }
  const path = `${id}/images/${randomUUID()}.${ext}`;
  const { error } = await createAdminSupabaseClient()
    .storage.from(cfg.bucket)
    .upload(path, bytes, { contentType: ext === "png" ? "image/png" : "image/jpeg" });
  if (error) return json({ error: error.message }, 500);
  return json({ path });
}

// Une image fixe, pour l'aperçu de l'éditeur.
export async function getVariableDataImage(request: Request, id: string, cfg: VariableDataConfig) {
  const { user } = await session();
  if (!user) return json({ error: "Non authentifié." }, 401);
  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!ZONE_IMAGE_PATH.test(path) || !path.startsWith(`${id}/images/`)) return json({ error: "Image invalide." }, 400);
  const { data: file } = await createAdminSupabaseClient().storage.from(cfg.bucket).download(path);
  if (!file) return json({ error: "Image introuvable." }, 404);
  return new NextResponse(new Uint8Array(await file.arrayBuffer()), {
    headers: {
      "Content-Type": path.endsWith(".png") ? "image/png" : "image/jpeg",
      // Le chemin change à chaque envoi : l'image peut rester en cache.
      "Cache-Control": "private, max-age=86400",
    },
  });
}

// Le fichier de données conservé, tel qu'il a été déposé (relu par l'éditeur).
export async function getVariableDataFile(id: string, cfg: VariableDataConfig) {
  const { supabase, user } = await session();
  if (!user) return json({ error: "Non authentifié." }, 401);
  const { data: row } = await supabase.from(cfg.table).select("data_path, data_filename").eq("id", id).single();
  const doc = row as { data_path: string | null; data_filename: string | null } | null;
  if (!doc?.data_path) return json({ error: "Aucun fichier de données." }, 404);
  const { data: file } = await createAdminSupabaseClient().storage.from(cfg.bucket).download(doc.data_path);
  if (!file) return json({ error: "Fichier introuvable." }, 404);
  const ext = doc.data_path.split(".").pop() ?? "csv";
  return new NextResponse(new Uint8Array(await file.arrayBuffer()), {
    headers: {
      "Content-Type": DATA_EXTENSIONS[ext] ?? "application/octet-stream",
      "Content-Disposition": contentDisposition(doc.data_filename ?? `donnees.${ext}`),
      "Cache-Control": "private, no-store",
    },
  });
}

// Assez pour placer les zones au dixième de millimètre.
const PREVIEW_WIDTH_PX = 1600;

// Le fond d'une face, en PNG pour l'éditeur (une balise <image> SVG ne lit pas un PDF).
export async function getVariableDataBackground(id: string, side: string, cfg: VariableDataConfig) {
  const { supabase, user } = await session();
  if (!user) return json({ error: "Non authentifié." }, 401);
  if (side !== "front" && side !== "back") return json({ error: "Face inconnue." }, 404);
  const column = SIDE_COLUMN[side];
  const { data: row } = await supabase.from(cfg.table).select(column).eq("id", id).single();
  const path = (row as Record<string, string | null> | null)?.[column];
  if (!path) return json({ error: "Aucun fond pour cette face." }, 404);

  const { data: file } = await createAdminSupabaseClient().storage.from(cfg.bucket).download(path);
  if (!file) return json({ error: "Fichier introuvable." }, 404);
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    let image: Buffer = bytes;
    if (detectMarksKind(bytes) === "pdf") {
      const [page] = await pdfToPng(bytes, { pagesToProcess: [1], viewportScale: 4 });
      if (!page?.content) throw new Error();
      image = page.content;
    }
    const png = await sharp(image).resize({ width: PREVIEW_WIDTH_PX, withoutEnlargement: true }).png().toBuffer();
    return new NextResponse(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
    });
  } catch {
    return json({ error: "Impossible de lire ce fichier." }, 422);
  }
}

// Fonds et images fixes des zones (seulement celles du document), pour le rendu.
async function loadRenderFiles(doc: VariableDataRow, cfg: VariableDataConfig, withBack: boolean) {
  const storage = createAdminSupabaseClient().storage.from(cfg.bucket);
  const load = async (path: string | null) => {
    const file = path ? (await storage.download(path)).data : null;
    return file ? new Uint8Array(await file.arrayBuffer()) : null;
  };
  const [front, back] = await Promise.all([load(doc.front_path), load(withBack ? doc.back_path : null)]);
  const images = new Map<string, Buffer>();
  for (const zone of doc.zones) {
    const path = zone.kind === "image" ? zone.imagePath : zone.kind === "photo" ? zone.maskPath : null;
    if (!path || !path.startsWith(`${doc.id}/images/`)) continue;
    const bytes = await load(path);
    if (bytes) images.set(path, Buffer.from(bytes));
  }
  return { front, back, images };
}

// Photo de remplacement des vignettes : une silhouette grise.
const PLACEHOLDER_PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">
<rect width="300" height="400" fill="#d4d4d8"/>
<circle cx="150" cy="150" r="70" fill="#a1a1aa"/>
<path d="M30 400c0-80 54-140 120-140s120 60 120 140z" fill="#a1a1aa"/>
</svg>`;
const THUMBNAIL_WIDTH_PX = 480;

/**
 * Vignette réaliste du recto pour la liste : la carte rendue comme à la
 * production, avec la ligne d'exemple (dernier fichier chargé) et une
 * silhouette à la place de la photo. L'URL porte la date de mise à jour :
 * le navigateur peut la garder.
 */
export async function thumbnailVariableData(id: string, cfg: VariableDataConfig) {
  const { supabase, user } = await session();
  if (!user) return json({ error: "Non authentifié." }, 401);
  const doc = await loadRow(supabase, cfg, id);
  if (!doc) return json({ error: "Introuvable." }, 404);
  const page = await cfg.pageSize(doc, supabase);
  if (!page) return json({ error: "Le modèle de ce gabarit est introuvable." }, 404);
  try {
    const { front, images } = await loadRenderFiles(doc, cfg, false);
    const photo = await sharp(Buffer.from(PLACEHOLDER_PHOTO_SVG)).jpeg().toBuffer();
    const { pdf } = await renderStudentCards(
      { width_mm: page.width, height_mm: page.height, two_sided: false, zones: doc.zones },
      { front, back: null },
      [{ row: doc.sample?.row ?? {}, photo, label: "Exemple" }],
      images
    );
    // Échelle du rendu : environ deux fois la largeur affichée, puis réduit.
    const scale = Math.max(1, (THUMBNAIL_WIDTH_PX * 2) / ((page.width / 25.4) * 72));
    const [png] = await pdfToPng(pdf, { pagesToProcess: [1], viewportScale: scale });
    if (!png?.content) throw new Error();
    const out = await sharp(png.content).resize({ width: THUMBNAIL_WIDTH_PX, withoutEnlargement: true }).png().toBuffer();
    return new NextResponse(new Uint8Array(out), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=604800" },
    });
  } catch {
    return json({ error: "Vignette impossible." }, 422);
  }
}

/**
 * Un lot de pages en PDF. Le navigateur envoie les lignes par lots (champ
 * `cards` : [{ row, photo, label }], `photo` nommant le fichier joint) et
 * assemble les PDF reçus. Les photos ne sont pas enregistrées.
 */
export async function renderVariableData(request: Request, id: string, cfg: VariableDataConfig) {
  const { supabase, user } = await session();
  if (!user) return json({ error: "Non authentifié." }, 401);
  const doc = await loadRow(supabase, cfg, id);
  if (!doc) return json({ error: "Introuvable." }, 404);
  const page = await cfg.pageSize(doc, supabase);
  if (!page) return json({ error: "Le modèle de ce gabarit est introuvable." }, 404);

  const form = await request.formData();
  const raw = parseJson(form.get("cards"));
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CARDS_PER_RENDER) {
    return json({ error: "Lot invalide." }, 400);
  }
  const cards: CardInput[] = [];
  for (const [i, c] of (raw as Record<string, unknown>[]).entries()) {
    const row: Record<string, string> = {};
    if (c.row && typeof c.row === "object") {
      for (const [k, v] of Object.entries(c.row as Record<string, unknown>).slice(0, 100)) {
        row[String(k).slice(0, 100)] = String(v ?? "").slice(0, 300);
      }
    }
    const file = typeof c.photo === "string" ? form.get(c.photo) : null;
    cards.push({
      row,
      photo: file instanceof File && file.size > 0 ? Buffer.from(await file.arrayBuffer()) : null,
      label: typeof c.label === "string" ? c.label.slice(0, 120) : `Ligne ${i + 1}`,
    });
  }

  try {
    const { front, back, images } = await loadRenderFiles(doc, cfg, doc.two_sided);
    const { pdf, warnings } = await renderStudentCards(
      { width_mm: page.width, height_mm: page.height, two_sided: doc.two_sided, zones: doc.zones },
      { front, back },
      cards,
      images
    );
    // Avertissements (photo illisible, code impossible) dans un en-tête :
    // bornés, un en-tête trop long ferait échouer la réponse.
    let shown = warnings.slice(0, 40);
    while (shown.length && encodeURIComponent(JSON.stringify(shown)).length > 6000) shown = shown.slice(0, -5);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "X-Card-Warnings": encodeURIComponent(JSON.stringify(shown)),
        "X-Card-Warning-Count": String(warnings.length),
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Rendu impossible." }, 500);
  }
}
