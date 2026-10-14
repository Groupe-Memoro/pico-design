import { stageLargeFiles } from "@/lib/design/stageUpload";

/**
 * Côté navigateur : adresse d'aperçu d'un fichier déposé dans une case (un
 * volet). Une image s'affiche telle quelle ; un PDF passe par le serveur, qui
 * en rend la première page en JPEG (voir app/api/design/rasterize) — le
 * navigateur ne sait pas montrer un PDF dans une balise <img>. Une seule
 * demande par fichier.
 */
const cache = new WeakMap<File, Promise<string | null>>();

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function filePreviewUrl(file: File, ctx: { templateId: string; grant?: string }): Promise<string | null> {
  if (!isPdfFile(file)) return Promise.resolve(URL.createObjectURL(file));
  const cached = cache.get(file);
  if (cached) return cached;
  const pending = (async () => {
    const body = new FormData();
    body.append("templateId", ctx.templateId);
    if (ctx.grant) body.append("grant", ctx.grant);
    body.append("file", file);
    const res = await fetch("/api/design/rasterize", { method: "POST", body: await stageLargeFiles(body) }).catch(() => null);
    if (!res?.ok) return null;
    return URL.createObjectURL(await res.blob());
  })();
  cache.set(file, pending);
  return pending;
}
