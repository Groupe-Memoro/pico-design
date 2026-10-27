"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, HelpCircleIcon, SpinnerIcon, TrashIcon, UploadIcon, XIcon } from "@/components/icons";
import ToolTopBar from "@/components/ToolTopBar";
import { applyOrientation, isLandscape } from "@/lib/pdf/orientation";
import { formatIn } from "@/lib/pdf/units";
import { stageLargeFiles } from "@/lib/design/stageUpload";
import { imagesFromZip } from "@/lib/zip";
import type { Template } from "@/lib/types";
import { rangeFillStyle } from "@/components/ui/rangeFill";

/**
 * Outil Shopify, module « Impression de photos » (templates.tool_module =
 * "photos") : le client téléverse ses photos (ou un zip), valide le cadrage
 * de chacune au format du modèle, choisit les quantités, puis repart vers son
 * panier — une ligne par photo.
 *
 * Chaque photo devient un design enregistré ordinaire (/api/design/submit :
 * image, cadrage, orientation, quantité), regroupé avec les autres par un lot
 * (batchId). Le bloc Liquid de la fiche produit lit ce lot pour remplir le
 * panier ; la commande, son webhook et ses PDF suivent le chemin habituel.
 *
 * Le cadrage montré ici reproduit exactement celui du serveur
 * (coverCropToBuffer : « cover », zoom, position 0-1), sur la page entière,
 * fond perdu compris.
 */

interface Photo {
  id: string;
  file: File;
  // Vignette légère pour la grille ; l'image entière ne sert qu'au cadrage.
  thumbUrl: string;
  width: number;
  height: number;
  positionX: number;
  positionY: number;
  zoom: number;
  // Format tourné (portrait/paysage) pour suivre la photo, si le modèle le permet.
  rotated: boolean;
  quantity: number;
  reviewed: boolean;
}

const ACCEPT = "image/jpeg,image/png,image/webp,.zip,application/zip";
const THUMB_PX = 480;
const MAX_ZOOM = 4;
const CONCURRENCY = 3;

let nextId = 0;

async function loadPhoto(file: File, template: Template): Promise<Photo> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, THUMB_PX / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  // Le format suit l'orientation de la photo quand le modèle le permet.
  const photoLandscape = width > height;
  const templateLandscape = isLandscape(template.width_mm, template.height_mm);
  const rotated = template.allow_orientation_change && width !== height && photoLandscape !== templateLandscape;
  return {
    id: `p${nextId++}`,
    file,
    thumbUrl: URL.createObjectURL(blob ?? file),
    width,
    height,
    positionX: 0.5,
    positionY: 0.5,
    zoom: 1,
    rotated,
    quantity: 1,
    reviewed: false,
  };
}

// La page (fond perdu compris) d'une photo, selon son orientation.
function pageOf(template: Template, rotated: boolean) {
  const t = applyOrientation(template, rotated);
  return { w: t.width_mm + 2 * t.bleed_mm, h: t.height_mm + 2 * t.bleed_mm, bleed: t.bleed_mm, trimW: t.width_mm, trimH: t.height_mm };
}

// Placement de l'image dans un cadre de W × H (px) : même calcul que
// coverCropToBuffer (couvrir, zoomer, décaler selon la position 0-1).
function placement(photo: Photo, W: number, H: number) {
  const scale = Math.max(W / photo.width, H / photo.height) * photo.zoom;
  const w = photo.width * scale;
  const h = photo.height * scale;
  return { w, h, left: -(w - W) * photo.positionX, top: -(h - H) * photo.positionY };
}

// Résolution réelle à l'impression (points par pouce) : sous 150, ça se voit.
function effectiveDpi(photo: Photo, template: Template) {
  const page = pageOf(template, photo.rotated);
  return Math.min(photo.width / (page.w / 25.4), photo.height / (page.h / 25.4)) / photo.zoom;
}

function QualityBadge({ dpi }: { dpi: number }) {
  if (dpi >= 150) return null;
  const low = dpi < 100;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${low ? "bg-danger-subtle text-danger" : "bg-warning-subtle text-warning-strong"}`}
      title={`Environ ${Math.round(dpi)} ppp à ce format (300 idéal).`}
    >
      {low ? "Risque de flou" : "Qualité moyenne"}
    </span>
  );
}

// Aperçu recadré d'une photo, à la proportion de sa page.
function CropPreview({ photo, template, url, width }: { photo: Photo; template: Template; url: string; width: number }) {
  const page = pageOf(template, photo.rotated);
  const H = (width * page.h) / page.w;
  const p = placement(photo, width, H);
  const bleedPx = (page.bleed / page.w) * width;
  return (
    <div className="relative overflow-hidden bg-white" style={{ width, height: H }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" draggable={false} className="pointer-events-none absolute max-w-none select-none" style={{ width: p.w, height: p.h, left: p.left, top: p.top }} />
      {bleedPx > 0.5 && <div className="pointer-events-none absolute border border-dashed border-white/80 shadow-[0_0_0_9999px_rgba(255,255,255,0.35)]" style={{ inset: bleedPx }} />}
    </div>
  );
}

// Cadrage d'une photo : glisser pour déplacer, curseur pour zoomer.
function CropEditor({
  photo,
  template,
  onChange,
}: {
  photo: Photo;
  template: Template;
  onChange: (patch: Partial<Photo>) => void;
}) {
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [box, setBox] = useState(520);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const page = pageOf(template, photo.rotated);

  useEffect(() => {
    const url = URL.createObjectURL(photo.file);
    setFullUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo.file]);

  // Cadre aussi grand que possible dans la fenêtre.
  useEffect(() => {
    const fit = () => {
      const maxW = Math.min(720, (wrapRef.current?.clientWidth ?? 520) - 8);
      const maxH = window.innerHeight * 0.58;
      setBox(Math.max(200, Math.min(maxW, (maxH * page.w) / page.h)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [page.w, page.h]);

  const H = (box * page.h) / page.w;
  const p = placement(photo, box, H);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: photo.positionX, py: photo.positionY };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    // Glisser l'image vers la droite montre davantage sa gauche : la position diminue.
    const overX = p.w - box;
    const overY = p.h - H;
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    onChange({
      positionX: overX > 0 ? clamp(d.px - (e.clientX - d.x) / overX) : 0.5,
      positionY: overY > 0 ? clamp(d.py - (e.clientY - d.y) / overY) : 0.5,
    });
  }

  return (
    <div ref={wrapRef} className="flex flex-col items-center gap-3">
      <div
        className="relative cursor-grab touch-none overflow-hidden bg-white shadow-md active:cursor-grabbing"
        style={{ width: box, height: H }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
      >
        {fullUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fullUrl} alt="" draggable={false} className="pointer-events-none absolute max-w-none select-none" style={{ width: p.w, height: p.h, left: p.left, top: p.top }} />
        )}
        {page.bleed > 0 && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-[#ff00ff] shadow-[0_0_0_9999px_rgba(255,255,255,0.45)]"
            style={{ inset: (page.bleed / page.w) * box }}
          />
        )}
      </div>
      <p className="text-center text-xs text-text-muted">
        Glisse la photo pour la placer. Ce qui dépasse le trait rose sera coupé à l&apos;impression.
      </p>
      <div className="flex w-full max-w-sm items-center gap-3 text-sm">
        <span className="text-text-muted">Zoom</span>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={photo.zoom}
          onChange={(e) => onChange({ zoom: Number(e.target.value) })}
          className="pico-range flex-1"
          style={rangeFillStyle(photo.zoom, 1, MAX_ZOOM)}
          aria-label="Zoom"
        />
        <button type="button" onClick={() => onChange({ zoom: 1, positionX: 0.5, positionY: 0.5 })} className="text-xs text-text-muted underline hover:text-text">
          Recentrer
        </button>
      </div>
    </div>
  );
}

// Petit aperçu pour le panier : la partie imprimée (sans le fond perdu).
async function cartPreview(photo: Photo, template: Template): Promise<Blob | null> {
  const page = pageOf(template, photo.rotated);
  const W = 600;
  const scale = W / page.trimW;
  const H = Math.round(page.trimH * scale);
  const fullW = page.w * scale;
  const fullH = page.h * scale;
  const p = placement(photo, fullW, fullH);
  const bitmap = await createImageBitmap(photo.file);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  const bleed = page.bleed * scale;
  ctx.drawImage(bitmap, p.left - bleed, p.top - bleed, p.w, p.h);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
}

export default function PhotoPrintTool({
  template,
  grant,
  shopify,
  onChangeModel,
  brandScope = "tool",
  shopHome = null,
}: {
  template: Template;
  grant?: string;
  shopify?: { variantId: string; quantity: number; returnUrl: string | null };
  onChangeModel?: () => void;
  // Logo et retour à la boutique de la barre du haut (voir ToolTopBar).
  brandScope?: string;
  shopHome?: string | null;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [allQty, setAllQty] = useState(1);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Photos déjà enregistrées (id de la photo → id du design) : un nouvel essai
  // après une erreur ne renvoie pas les autres.
  const sent = useRef(new Map<string, string>());
  const batchId = useRef<string>(crypto.randomUUID());

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.thumbUrl)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = useMemo(() => photos.reduce((n, p) => n + p.quantity, 0), [photos]);
  const toReview = photos.filter((p) => !p.reviewed).length;
  const format = `${formatIn(template.width_mm)} × ${formatIn(template.height_mm)}`;

  async function addFiles(list: FileList | File[]) {
    setError(null);
    const files: File[] = [];
    for (const f of Array.from(list)) {
      if (f.name.toLowerCase().endsWith(".zip") || f.type.includes("zip")) {
        setLoading(`Ouverture de « ${f.name} »…`);
        try {
          files.push(...(await imagesFromZip(f)));
        } catch (err) {
          setError(err instanceof Error ? err.message : `« ${f.name} » n'a pas pu être ouvert.`);
        }
      } else if (/^image\/(jpeg|png|webp)$/.test(f.type)) {
        files.push(f);
      }
    }
    const added: Photo[] = [];
    for (let i = 0; i < files.length; i++) {
      setLoading(`Préparation des photos… ${i + 1} / ${files.length}`);
      try {
        added.push(await loadPhoto(files[i], template));
      } catch {
        setError(`« ${files[i].name} » n'est pas une image lisible.`);
      }
    }
    if (files.length === 0) setError("Aucune photo trouvée : JPEG, PNG ou WebP, ou un fichier .zip qui en contient.");
    setPhotos((cur) => [...cur, ...added]);
    setLoading(null);
    if (input.current) input.current.value = "";
  }

  function update(index: number, patch: Partial<Photo>) {
    setPhotos((cur) => cur.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function remove(index: number) {
    setPhotos((cur) => {
      URL.revokeObjectURL(cur[index].thumbUrl);
      return cur.filter((_, i) => i !== index);
    });
    setEditing(null);
  }

  async function submitOne(photo: Photo): Promise<void> {
    if (sent.current.has(photo.id)) return;
    const body = new FormData();
    body.append("templateId", template.id);
    if (grant) body.append("grant", grant);
    body.append("batchId", batchId.current);
    body.append("rotated", String(photo.rotated));
    body.append("image", photo.file);
    body.append("pdfPage", "1");
    body.append("positionX", String(photo.positionX));
    body.append("positionY", String(photo.positionY));
    body.append("zoom", String(photo.zoom));
    body.append("imageRotation", "0");
    body.append("quantity", String(photo.quantity));
    if (shopify) body.append("variantId", shopify.variantId);
    const preview = await cartPreview(photo, template).catch(() => null);
    if (preview) body.append("preview", preview, "preview.jpg");
    const res = await fetch("/api/design/submit", { method: "POST", body: await stageLargeFiles(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `« ${photo.file.name} » n'a pas pu être envoyée.`);
    sent.current.set(photo.id, data.id);
  }

  async function finish() {
    const list = photos.filter((p) => p.quantity > 0);
    if (list.length === 0) return;
    if (toReview > 0 && !confirm(`${toReview} photo${toReview > 1 ? "s n'ont" : " n'a"} pas été vérifiée${toReview > 1 ? "s" : ""}. Continuer quand même ?`)) return;
    setError(null);
    let doneCount = 0;
    setSending(`Envoi des photos… 0 / ${list.length}`);
    try {
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
          while (next < list.length) {
            await submitOne(list[next++]);
            setSending(`Envoi des photos… ${++doneCount} / ${list.length}`);
          }
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Envoi impossible.");
      setSending(null);
      return;
    }
    if (shopify?.returnUrl) {
      setSending("Retour à la boutique…");
      const params = new URLSearchParams({ pico_batch: batchId.current, variant: shopify.variantId });
      const base = shopify.returnUrl;
      window.location.href = `${base}${base.includes("?") ? "&" : "?"}${params}`;
      return;
    }
    setSending(null);
    setDone(list.length);
  }

  const current = editing !== null ? photos[editing] : null;

  return (
    <div className="flex min-h-screen flex-col bg-background text-text">
      <ToolTopBar
        brandScope={brandScope}
        shopHome={shopHome}
        title={template.name}
        subtitle={`${format} po · Impression de photos`}
        onChangeModel={onChangeModel}
        actions={
          <>
            {sending && (
              <span className="hidden items-center gap-2 text-sm text-text-muted sm:flex">
                <SpinnerIcon className="h-4 w-4" /> {sending}
              </span>
            )}
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="Aide"
              className="flex items-center gap-1.5 rounded-full bg-[rgba(79,10,31,0.06)] px-3 py-1.5 text-sm font-medium text-primary hover:bg-[rgba(79,10,31,0.12)]"
            >
              <HelpCircleIcon className="h-4 w-4 shrink-0" />
              <span className="hidden whitespace-nowrap md:inline">Aide</span>
            </button>
            <button
              type="button"
              onClick={finish}
              disabled={Boolean(sending) || total === 0}
              className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-text-on-brand hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {shopify?.returnUrl ? `Ajouter au panier${total ? ` (${total})` : ""}` : `Enregistrer${total ? ` (${total})` : ""}`}
            </button>
          </>
        }
      />
      {sending && (
        <p className="flex items-center justify-center gap-2 border-b border-border bg-surface py-2 text-sm text-text-muted sm:hidden">
          <SpinnerIcon className="h-4 w-4" /> {sending}
        </p>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-6">
        <div
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
          role="button"
          tabIndex={0}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            dragOver ? "border-primary bg-primary-subtle" : "border-border bg-surface hover:border-border-strong"
          }`}
        >
          {loading ? <SpinnerIcon className="h-6 w-6 text-text-muted" /> : <UploadIcon className="h-6 w-6 text-text-muted" />}
          <p className="font-medium">{loading ?? (photos.length ? "Ajouter d'autres photos" : "Ajoute tes photos")}</p>
          <p className="text-sm text-text-muted">Glisse-les ici ou clique — JPEG, PNG, WebP, ou un fichier .zip.</p>
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        {done !== null && (
          <p className="mt-4 rounded-lg bg-success-subtle p-3 text-sm text-success-strong">
            {done} photo{done > 1 ? "s" : ""} enregistrée{done > 1 ? "s" : ""} (lot {batchId.current}). Depuis la boutique, elles
            arrivent directement au panier.
          </p>
        )}

        {photos.length > 0 && (
          <>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-text-muted">
                <strong className="text-text">{photos.length}</strong> photo{photos.length > 1 ? "s" : ""} ·{" "}
                <strong className="text-text">{total}</strong> tirage{total > 1 ? "s" : ""}
                {toReview > 0 && <span> · {toReview} à vérifier</span>}
              </p>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-text-muted">Quantité pour toutes</span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={allQty}
                  onChange={(e) => setAllQty(Math.max(1, Math.min(999, Math.floor(Number(e.target.value)) || 1)))}
                  className="w-16 rounded-lg border border-border bg-surface px-2 py-1"
                />
                <button type="button" onClick={() => setPhotos((cur) => cur.map((p) => ({ ...p, quantity: allQty })))} className="rounded-lg border border-border px-3 py-1 hover:bg-surface-muted">
                  Appliquer
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {photos.map((photo, i) => (
                <div key={photo.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-2">
                  <button type="button" onClick={() => setEditing(i)} className="relative flex h-44 items-center justify-center bg-surface-muted" title="Vérifier le cadrage">
                    <CropPreview photo={photo} template={template} url={photo.thumbUrl} width={pageOf(template, photo.rotated).w > pageOf(template, photo.rotated).h ? 160 : 112} />
                    {photo.reviewed && (
                      <span className="absolute right-1 top-1 rounded-full bg-success p-0.5 text-white">
                        <CheckIcon className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                  <div className="flex min-h-[22px] items-center justify-between gap-1">
                    <span className="truncate text-xs text-text-muted" title={photo.file.name}>
                      {photo.file.name}
                    </span>
                    <QualityBadge dpi={effectiveDpi(photo, template)} />
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center rounded-lg border border-border">
                      <button type="button" onClick={() => update(i, { quantity: Math.max(0, photo.quantity - 1) })} className="px-2 py-1 text-text-muted hover:text-text" aria-label="Moins">
                        −
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={999}
                        value={photo.quantity}
                        onChange={(e) => update(i, { quantity: Math.max(0, Math.min(999, Math.floor(Number(e.target.value)) || 0)) })}
                        className="w-10 bg-transparent text-center text-sm"
                        aria-label="Quantité"
                      />
                      <button type="button" onClick={() => update(i, { quantity: Math.min(999, photo.quantity + 1) })} className="px-2 py-1 text-text-muted hover:text-text" aria-label="Plus">
                        +
                      </button>
                    </div>
                    <button type="button" onClick={() => remove(i)} className="rounded-lg p-1.5 text-text-muted hover:bg-danger-subtle hover:text-danger" aria-label="Retirer">
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>


      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setHelpOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-lg font-semibold">Aide — tes tirages, pas à pas</p>
              <button type="button" onClick={() => setHelpOpen(false)} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-muted" aria-label="Fermer">
                <XIcon className="h-5 w-5" />
              </button>
            </div>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-text-muted">
              <li>Ajoute tes photos : glisse-les dans la zone, ou un fichier .zip qui les contient.</li>
              <li>Clique une photo pour vérifier son cadrage : glisse-la pour la placer, zoome au besoin. Ce qui dépasse le trait rose sera coupé.</li>
              <li>« Valider le cadrage » passe à la photo suivante. Une pastille « Qualité moyenne » ou « Risque de flou » signale une photo trop petite pour ce format.</li>
              <li>Choisis la quantité de chaque photo (ou la même pour toutes), puis ajoute le tout au panier : une ligne par photo.</li>
            </ol>
          </div>
        </div>
      )}

      {current && editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-3xl rounded-2xl bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="truncate text-sm font-medium">
                Photo {editing + 1} / {photos.length} · {current.file.name}
              </p>
              <div className="flex items-center gap-2">
                <QualityBadge dpi={effectiveDpi(current, template)} />
                <button type="button" onClick={() => setEditing(null)} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-muted" aria-label="Fermer">
                  <XIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
            <CropEditor photo={current} template={template} onChange={(patch) => update(editing, patch)} />
            {/* Sur téléphone, « Valider » prend toute la largeur au-dessus des
                flèches (trois boutons de front n'y tiennent pas). */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setEditing(Math.max(0, editing - 1))}
                disabled={editing === 0}
                className="flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-muted disabled:opacity-40"
              >
                <ChevronLeftIcon className="h-4 w-4" /> Précédente
              </button>
              <button
                type="button"
                onClick={() => {
                  update(editing, { reviewed: true });
                  // Valider passe à la suivante encore à vérifier.
                  const nextIndex = photos.findIndex((p, i) => i > editing && !p.reviewed);
                  setEditing(nextIndex >= 0 ? nextIndex : null);
                }}
                className="order-first flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-primary px-4 py-2 text-sm font-medium text-text-on-brand hover:bg-primary-hover sm:order-none sm:w-auto"
              >
                <CheckIcon className="h-4 w-4" /> Valider le cadrage
              </button>
              <button
                type="button"
                onClick={() => setEditing(Math.min(photos.length - 1, editing + 1))}
                disabled={editing === photos.length - 1}
                className="flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-muted disabled:opacity-40"
              >
                Suivante <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
