import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { formDataFromSubmission, type DesignSubmission } from "@/lib/design/submission";
import { renderPdfFromForm } from "@/lib/design/renderPdf";
import { mapLimit } from "@/lib/concurrency";
import { buildImposition, ImpositionError } from "@/lib/imposition/build";
import { storageFileName } from "@/lib/storageName";
import type { ImpositionProfile, Template } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface OrderRow {
  id: string;
  order_number: string | null;
  shopify_order_id: string;
  order_items: { id: string; title: string | null; quantity: number; design_submission_id: string | null; product_id: string | null }[];
}

// Un article à imposer : d'où vient son PDF, combien de copies, et pour qui.
interface Piece {
  label: string;
  copies: number;
  templateId: string;
  submission?: DesignSubmission;
  productId?: string;
}

/**
 * Mise en production d'une ou plusieurs commandes : leurs designs sont
 * regroupés par profil d'imposition (celui du modèle, voir 0078) et par
 * modèle, et chaque groupe devient un PDF imposé — sur autant de feuilles
 * qu'il faut. Les commandes passent « en production ». Les articles sans
 * design, ou dont le modèle n'a pas de profil, sont signalés et laissés de côté.
 */
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { orderIds?: unknown };
  const orderIds = Array.isArray(body.orderIds) ? body.orderIds.filter((id): id is string => typeof id === "string").slice(0, 50) : [];
  if (orderIds.length === 0) return NextResponse.json({ error: "Choisissez au moins une commande." }, { status: 400 });

  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number, shopify_order_id, order_items(id, title, quantity, design_submission_id, product_id)")
    .in("id", orderIds);
  const rows = (orders as OrderRow[] | null) ?? [];
  if (rows.length === 0) return NextResponse.json({ error: "Commandes introuvables." }, { status: 404 });

  // Designs des clients et produits Pico des lignes, pour connaître leur modèle.
  const items = rows.flatMap((o) => o.order_items.map((item) => ({ order: o, item })));
  const submissionIds = items.flatMap(({ item }) => (item.design_submission_id ? [item.design_submission_id] : []));
  const productIds = items.flatMap(({ item }) => (!item.design_submission_id && item.product_id ? [item.product_id] : []));
  const [{ data: submissions }, { data: products }] = await Promise.all([
    submissionIds.length ? supabase.from("design_submissions").select("*").in("id", submissionIds) : Promise.resolve({ data: [] }),
    productIds.length ? supabase.from("products").select("id, name, template_id").in("id", productIds) : Promise.resolve({ data: [] }),
  ]);
  const submissionById = new Map(((submissions as DesignSubmission[] | null) ?? []).map((s) => [s.id, s]));
  const productById = new Map(((products as { id: string; name: string; template_id: string }[] | null) ?? []).map((p) => [p.id, p]));

  const pieces: Piece[] = [];
  const skipped: string[] = [];
  for (const { order, item } of items) {
    const numero = order.order_number ?? order.shopify_order_id;
    const label = `${numero} — ${item.title ?? "Article"}`;
    const submission = item.design_submission_id ? submissionById.get(item.design_submission_id) : undefined;
    const product = !submission && item.product_id ? productById.get(item.product_id) : undefined;
    if (submission) pieces.push({ label, copies: item.quantity, templateId: submission.template_id, submission });
    else if (product) pieces.push({ label, copies: item.quantity, templateId: product.template_id, productId: product.id });
    else skipped.push(`${label} : sans design`);
  }

  const templateIds = Array.from(new Set(pieces.map((p) => p.templateId)));
  const { data: templates } = templateIds.length
    ? await supabase.from("templates").select("*").in("id", templateIds)
    : { data: [] };
  const templateById = new Map(((templates as Template[] | null) ?? []).map((t) => [t.id, t]));
  const profileIds = Array.from(
    new Set(Array.from(templateById.values()).flatMap((t) => (t.imposition_profile_id ? [t.imposition_profile_id] : [])))
  );
  const { data: profiles } = profileIds.length
    ? await supabase.from("imposition_profiles").select("*").in("id", profileIds)
    : { data: [] };
  const profileById = new Map(((profiles as ImpositionProfile[] | null) ?? []).map((p) => [p.id, p]));

  // Groupes : un profil et un modèle (même format de pièce).
  const groups = new Map<string, { profile: ImpositionProfile; template: Template; pieces: Piece[] }>();
  for (const piece of pieces) {
    const template = templateById.get(piece.templateId);
    const profile = template?.imposition_profile_id ? profileById.get(template.imposition_profile_id) : undefined;
    if (!template || !profile) {
      skipped.push(`${piece.label} : le modèle « ${template?.name ?? "?"} » n'a pas de profil d'imposition`);
      continue;
    }
    const key = `${profile.id}:${template.id}`;
    if (!groups.has(key)) groups.set(key, { profile, template, pieces: [] });
    groups.get(key)!.pieces.push(piece);
  }

  const admin = createAdminSupabaseClient();
  const batchId = randomUUID();
  const files: { name: string; path: string; sheets: number; pieces: number }[] = [];
  const errors: string[] = [];
  for (const { profile, template, pieces: groupPieces } of Array.from(groups.values())) {
    const name = `${template.name} — ${profile.name}`;
    try {
      const form = new FormData();
      form.append("sheetId", profile.sheet_id);
      form.append("machine", profile.machine);
      if (profile.duplo_job_id) form.append("duploJobId", profile.duplo_job_id);
      if (profile.duplo_job2_id) {
        form.append("duploJob2Id", profile.duplo_job2_id);
        form.append("duploJob2Turn", profile.duplo_job2_turn);
      }
      if (profile.cutter_id) form.append("cutterId", profile.cutter_id);
      form.append("pieceWidthMm", String(template.width_mm + template.bleed_mm * 2));
      form.append("pieceHeightMm", String(template.height_mm + template.bleed_mm * 2));
      form.append("pieceBleedMm", String(template.bleed_mm));
      form.append("orientation", profile.orientation);
      form.append("flip", profile.flip);
      form.append("multiSheet", "1");
      // Le PDF du design, fabriqué comme au téléchargement depuis la commande.
      // Rendus 3 par 3 (sharp sur des images 300 dpi : la mémoire est limitée),
      // puis ajoutés au formulaire dans l'ordre des articles.
      const rendered = await mapLimit(groupPieces, 3, async (piece) =>
        piece.productId
          ? null
          : renderPdfFromForm(admin, await formDataFromSubmission(admin, piece.submission!), piece.templateId, template)
      );
      const specs = [];
      for (const [i, piece] of groupPieces.entries()) {
        const pdf = rendered[i];
        if (piece.productId || !pdf) {
          specs.push({ kind: "product", productId: piece.productId, copies: piece.copies, name: piece.label });
        } else {
          form.append(`file${i}`, new File([new Uint8Array(pdf.pdf)], `${piece.label}.pdf`, { type: "application/pdf" }));
          specs.push({ kind: "upload", field: `file${i}`, copies: piece.copies, name: piece.label });
        }
      }
      form.append("sources", JSON.stringify(specs));
      const built = await buildImposition(form, { supabase, admin });
      const path = `production/${batchId}/${storageFileName(name)}.pdf`;
      const { error: uploadError } = await admin.storage
        .from("outputs")
        .upload(path, built.pdf, { contentType: "application/pdf", upsert: true });
      if (uploadError) throw new Error(uploadError.message);
      files.push({ name, path, sheets: built.sheetCount ?? 1, pieces: groupPieces.reduce((n, p) => n + p.copies, 0) });
    } catch (err) {
      errors.push(`${name} : ${err instanceof ImpositionError || err instanceof Error ? err.message : "erreur"}`);
    }
  }

  if (files.length === 0) {
    return NextResponse.json(
      { error: "Rien n'a pu être imposé.", skipped: [...skipped, ...errors] },
      { status: 422 }
    );
  }

  const { error: batchError } = await supabase.from("production_batches").insert({
    id: batchId,
    order_ids: rows.map((o) => o.id),
    files,
    skipped: [...skipped, ...errors],
    created_by: user.id,
  });
  if (batchError) return NextResponse.json({ error: batchError.message }, { status: 500 });

  // Les commandes avancent : en production, et vues.
  const now = new Date().toISOString();
  await supabase
    .from("orders")
    .update({ pico_status: "en_production", updated_at: now, viewed_at: now })
    .in("id", rows.map((o) => o.id));

  return NextResponse.json({ batchId, files, skipped: [...skipped, ...errors] });
}
