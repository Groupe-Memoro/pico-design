// Enregistrement d'une imposition : génère le PDF, range ses fichiers dans le
// stockage privé "imposition" et écrit la ligne en base. Partagé par la création
// (POST) et la modification (PATCH).

import { randomUUID } from "crypto";
import { ImpositionError, buildImposition, serverClients, type SupabaseClients } from "@/lib/imposition/build";
import { isMachine } from "@/lib/imposition/machines";
import {
  cleanImpositionName,
  imposedPdfPath,
  safeStorageName,
  sourcesDir,
  type ImpositionConfig,
  type SavedImposition,
  type SavedSource,
} from "@/lib/imposition/saved";

const BUCKET = "imposition";

// Options d'écran de la configuration (tout sauf la liste des fichiers, que le
// serveur reconstruit d'après ce qu'il a réellement reçu).
function parseConfigBase(raw: unknown): Omit<ImpositionConfig, "sources"> {
  let c: Record<string, unknown> | null = null;
  try {
    c = JSON.parse(String(raw ?? ""));
  } catch {
    c = null;
  }
  const custom = (c?.custom ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  if (!c || !isMachine(c.machine) || typeof c.sheetId !== "string" || typeof c.formatId !== "string") {
    throw new ImpositionError("Configuration de l'imposition invalide.");
  }
  const doc = (c.document ?? {}) as Record<string, unknown>;
  return {
    version: 1,
    mode: c.mode === "document" ? "document" : "pieces",
    document:
      c.mode === "document"
        ? {
            marginMm: num(doc.marginMm),
            gutterMm: num(doc.gutterMm),
            bleedMm: num(doc.bleedMm),
            duplex: doc.duplex === true,
            collated: doc.collated === true,
            eachPage: doc.eachPage === true,
            cutting: doc.cutting === "machine" ? "machine" : "guillotine",
            cropMarks: doc.cropMarks !== false,
          }
        : undefined,
    sheetId: c.sheetId,
    machine: c.machine,
    duploJobId: typeof c.duploJobId === "string" ? c.duploJobId : "",
    duploJob2Id: typeof c.duploJob2Id === "string" ? c.duploJob2Id : "",
    duploJob2Turn: c.duploJob2Turn === "ccw" ? "ccw" : "cw",
    cutterId: typeof c.cutterId === "string" ? c.cutterId : "",
    formatId: c.formatId,
    custom: { widthMm: num(custom.widthMm), heightMm: num(custom.heightMm), bleedMm: num(custom.bleedMm) },
    orientation: c.orientation === "normal" || c.orientation === "rotated" ? c.orientation : "auto",
    flip: c.flip === "short" ? "short" : "long",
    ...(c.sourcePages === "duplex" || c.sourcePages === "simplex" ? { sourcePages: c.sourcePages } : {}),
  };
}

export async function saveImposition(
  formData: FormData,
  id: string,
  userId: string,
  existing: SavedImposition | null,
  clients: SupabaseClients = serverClients()
): Promise<{ id: string; name: string }> {
  const { supabase, admin } = clients;
  const name = cleanImpositionName(formData.get("name"));
  if (!name) throw new ImpositionError("Donnez un nom à l'imposition.");
  const base = parseConfigBase(formData.get("config"));

  // Seule la modification peut réutiliser les PDF déjà enregistrés de cette imposition.
  if (existing) formData.set("impositionId", id);
  else formData.delete("impositionId");
  const built = await buildImposition(formData, clients);

  const uploaded: string[] = [];
  const cleanup = () => admin.storage.from(BUCKET).remove(uploaded);

  try {
    // Les PDF téléversés sont rangés avec l'imposition (nom unique : les autres
    // fichiers déjà enregistrés ne sont jamais écrasés).
    const sources: SavedSource[] = [];
    for (const [i, source] of built.sources.entries()) {
      const { spec } = source;
      // Verso joint : déjà enregistré (gardé tel quel), ou rangé maintenant.
      let back: SavedSource["back"] = null;
      if (source.back && spec.back) {
        if (spec.back.kind === "stored") {
          back = { path: spec.back.path, name: source.back.name };
        } else {
          const path = `${sourcesDir(id)}/${randomUUID().slice(0, 8)}-${i}-verso-${safeStorageName(source.back.name)}`;
          const { error } = await admin.storage
            .from(BUCKET)
            .upload(path, source.back.bytes, { contentType: "application/pdf", upsert: false });
          if (error) throw new ImpositionError(`Enregistrement du verso de « ${source.name} » impossible : ${error.message}`, 500);
          uploaded.push(path);
          back = { path, name: source.back.name };
        }
      }
      const shown = {
        name: (typeof spec.name === "string" && spec.name) || source.name,
        widthMm: Number.isFinite(Number(spec.widthMm)) && spec.widthMm != null ? Number(spec.widthMm) : null,
        heightMm: Number.isFinite(Number(spec.heightMm)) && spec.heightMm != null ? Number(spec.heightMm) : null,
        ...(Number.isInteger(spec.pageCount) && Number(spec.pageCount) > 0 ? { pageCount: Number(spec.pageCount) } : {}),
        copies: spec.copies,
        ...(back ? { back } : {}),
      };
      if (spec.kind === "product") {
        sources.push({ kind: "product", productId: spec.productId, ...shown });
      } else if (spec.kind === "stored") {
        sources.push({ kind: "upload", path: spec.path, ...shown });
      } else {
        // Téléversé, ou déposé directement dans le stockage (staged) : rangé
        // sous le dossier de l'imposition.
        const path = `${sourcesDir(id)}/${randomUUID().slice(0, 8)}-${i}-${safeStorageName(source.name)}`;
        const { error } = await admin.storage
          .from(BUCKET)
          .upload(path, source.bytes!, { contentType: "application/pdf", upsert: false });
        if (error) throw new ImpositionError(`Enregistrement de « ${source.name} » impossible : ${error.message}`, 500);
        uploaded.push(path);
        sources.push({ kind: "upload", path, ...shown });
      }
    }

    const pdfPath = imposedPdfPath(id);
    const { error: pdfError } = await admin.storage
      .from(BUCKET)
      .upload(pdfPath, built.pdf, { contentType: "application/pdf", upsert: true });
    if (pdfError) throw new ImpositionError(`Enregistrement du PDF impossible : ${pdfError.message}`, 500);

    const config: ImpositionConfig = { ...base, sources };
    if (existing) {
      const { error } = await supabase
        .from("impositions")
        .update({ name, config, pdf_path: pdfPath, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new ImpositionError(error.message, 500);
      // Retire les PDF téléversés qui ne servent plus.
      const keep = new Set(sources.flatMap((s) => [s.path, s.back?.path].filter((p): p is string => Boolean(p))));
      const orphans = existing.config.sources
        .flatMap((s) => [s.path, s.back?.path])
        .filter((p): p is string => Boolean(p) && !keep.has(p!));
      if (orphans.length > 0) await admin.storage.from(BUCKET).remove(orphans);
    } else {
      const { error } = await supabase
        .from("impositions")
        .insert({ id, name, config, pdf_path: pdfPath, created_by: userId });
      if (error) {
        await admin.storage.from(BUCKET).remove([pdfPath]);
        throw new ImpositionError(error.message, 500);
      }
    }
    // Les PDF déposés directement par le navigateur sont maintenant rangés
    // avec l'imposition : leur copie de dépôt ne sert plus.
    const staged = built.sources.flatMap((s) => [
      ...(s.spec.kind === "staged" ? [s.spec.path] : []),
      ...(s.spec.back?.kind === "staged" ? [s.spec.back.path] : []),
    ]);
    if (staged.length > 0) await admin.storage.from(BUCKET).remove(staged);
    return { id, name };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
