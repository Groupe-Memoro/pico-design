"use client";

import { useMemo, useRef, useState } from "react";
import { SpinnerIcon, TrashIcon } from "@/components/icons";
import PagePreview from "@/components/print/PagePreview";
import { layoutAgenda } from "@/lib/agendas/layout";
import type { PrintGeometry } from "@/lib/print/elements";
import { ACCEPTED_PHOTO_TYPES, PAGE_PHOTO_MAX_PX, uploadPdf, uploadPhotos } from "@/lib/print/upload";
import {
  AGENDAS_BUCKET,
  CALENDAR_LAYOUTS,
  SPONSOR_SLOTS,
  type Agenda,
  type AgendaDay,
  type AgendaPage,
  type AgendaPageContent,
  type CalendarContent,
  type CalendarLayout,
  type CoverContent,
  type InfoContent,
  type NotesContent,
  type PdfContent,
  type SponsorsContent,
  type SponsorsLayout,
} from "@/lib/agendas/types";

const inputClass = "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm";
const labelClass = "block text-sm font-medium";
const buttonClass = "rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50";

// Vignettes de photos, avec retrait.
function PhotoGrid({ photos, thumbs, onRemove }: { photos: string[]; thumbs: Record<string, string>; onRemove: (path: string) => void }) {
  return (
    <div className="mt-1 grid grid-cols-3 gap-2">
      {photos.map((p, i) => (
        <div key={p} className="relative aspect-video overflow-hidden rounded-lg bg-neutral-100">
          {thumbs[p] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbs[p]} alt="" className="h-full w-full object-cover" />
          )}
          <span className="absolute left-1 top-1 rounded bg-neutral-50/90 px-1 text-[10px] font-medium">{i + 1}</span>
          <button type="button" onClick={() => onRemove(p)} aria-label="Retirer" className="absolute right-1 top-1 rounded-full bg-neutral-50/90 p-1 text-neutral-600 hover:text-danger">
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Modifier un bloc de l'agenda. L'aperçu suit la saisie, calculé sur tout
 * l'agenda : les pages tombent à gauche et à droite comme à l'impression.
 * Rien n'est enregistré avant « Enregistrer » ; les fichiers, eux, partent
 * au stockage dès qu'on les choisit.
 */
export default function AgendaBlockForm({
  agenda,
  block,
  blocks,
  days,
  geometry,
  thumbs,
  onSaved,
}: {
  agenda: Agenda;
  block: AgendaPage;
  blocks: AgendaPage[];
  days: AgendaDay[];
  geometry: PrintGeometry;
  thumbs: Record<string, string>;
  onSaved: () => void;
}) {
  const [content, setContent] = useState<AgendaPageContent>(block.content);
  const [localThumbs, setLocalThumbs] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const target = { endpoint: `/api/agendas/${agenda.id}/uploads`, bucket: AGENDAS_BUCKET };
  const allThumbs = { ...thumbs, ...localThumbs };

  const preview = useMemo(() => {
    const edited = blocks.map((b) => (b.id === block.id ? { ...b, content } : b));
    const all = layoutAgenda(geometry, agenda, agenda.settings, edited, days);
    return all.map((page, index) => ({ page, index })).filter((p) => p.page.blockId === block.id);
  }, [blocks, block.id, content, geometry, agenda, days]);

  function patch<T extends AgendaPageContent>(p: Partial<T>) {
    setContent((c) => ({ ...c, ...p }) as AgendaPageContent);
  }

  async function addPhotos(files: File[]): Promise<string[]> {
    if (files.length === 0) return [];
    setError(null);
    setUploading(`0 / ${files.length}`);
    try {
      const results = await uploadPhotos(target, files, PAGE_PHOTO_MAX_PX, (d, t) => setUploading(`${d} / ${t}`));
      const ok = results.filter((r) => r.photoPath);
      setLocalThumbs((t) => ({ ...t, ...Object.fromEntries(ok.map((r) => [r.photoPath!, URL.createObjectURL(r.file)])) }));
      const failed = results.filter((r) => r.error);
      if (failed.length) setError(`${failed.length} photo(s) non envoyée(s) : ${failed[0].error}`);
      return ok.map((r) => r.photoPath!);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Envoi impossible.");
      return [];
    } finally {
      setUploading(null);
      if (photoInput.current) photoInput.current.value = "";
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/agendas/${agenda.id}/pages/${block.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Enregistrement impossible.");
      return;
    }
    onSaved();
  }

  // Un seul champ de fichier photo, réutilisé selon le bloc.
  const onPhotos = useRef<(paths: string[]) => void>(() => {});
  const choosePhotos = (multiple: boolean, then: (paths: string[]) => void) => {
    onPhotos.current = then;
    if (photoInput.current) {
      photoInput.current.multiple = multiple;
      photoInput.current.click();
    }
  };

  let fields: React.ReactNode = null;
  if (block.kind === "cover" || block.kind === "info") {
    const c = content as CoverContent | InfoContent;
    fields = (
      <>
        <div>
          <label className={labelClass}>Titre</label>
          <input value={c.title} onChange={(e) => patch({ title: e.target.value })} className={inputClass} />
        </div>
        {block.kind === "cover" ? (
          <div>
            <label className={labelClass}>Sous-titre</label>
            <input value={(c as CoverContent).subtitle} onChange={(e) => patch<CoverContent>({ subtitle: e.target.value })} className={inputClass} />
          </div>
        ) : (
          <div>
            <label className={labelClass}>Texte</label>
            <textarea value={(c as InfoContent).text} onChange={(e) => patch<InfoContent>({ text: e.target.value })} rows={8} className={inputClass} />
            <p className="mt-1 text-xs text-neutral-500">Une page. Pour un long document (code de vie), ajoutez plutôt un bloc « PDF de l&apos;école ».</p>
          </div>
        )}
        <div>
          <label className={labelClass}>Photo</label>
          <div className="mt-1 flex items-center gap-2">
            <button type="button" disabled={Boolean(uploading)} className={buttonClass} onClick={() => choosePhotos(false, ([p]) => p && patch({ photo: p }))}>
              {c.photo ? "Remplacer" : "Choisir une photo"}
            </button>
            {c.photo && (
              <button type="button" onClick={() => patch({ photo: null })} className="text-sm text-danger hover:underline">
                Retirer
              </button>
            )}
          </div>
        </div>
        {block.kind === "cover" && (c as CoverContent).photo && (
          <div>
            <label className={labelClass}>Place de la photo</label>
            <select value={(c as CoverContent).photoMode} onChange={(e) => patch<CoverContent>({ photoMode: e.target.value as CoverContent["photoMode"] })} className={inputClass}>
              <option value="top">Haut de la page, titre dessous</option>
              <option value="full">Pleine page, titre sur un bandeau</option>
            </select>
          </div>
        )}
      </>
    );
  } else if (block.kind === "calendar") {
    const c = content as CalendarContent;
    const isMonth = c.layout === "month1" || c.layout === "month2";
    fields = (
      <>
        <div>
          <label className={labelClass}>Mise en page</label>
          <select value={c.layout} onChange={(e) => patch<CalendarContent>({ layout: e.target.value as CalendarLayout })} className={inputClass}>
            {CALENDAR_LAYOUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-neutral-500">{CALENDAR_LAYOUTS.find((l) => l.id === c.layout)?.help}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Du</label>
            <input type="date" value={c.from || agenda.start_date} onChange={(e) => patch<CalendarContent>({ from: e.target.value === agenda.start_date ? "" : e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Au</label>
            <input type="date" value={c.to || agenda.end_date} onChange={(e) => patch<CalendarContent>({ to: e.target.value === agenda.end_date ? "" : e.target.value })} className={inputClass} />
          </div>
        </div>
        {!isMonth && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.monthOverview} onChange={(e) => patch<CalendarContent>({ monthOverview: e.target.checked })} />
            Vue du mois avant chaque nouveau mois
          </label>
        )}
        {!isMonth && (
          <div>
            <label className={labelClass}>Bandeaux de commanditaires ({c.banners.length})</label>
            <p className="text-xs text-neutral-500">En bas des pages, à tour de rôle. Format bandeau, environ 6 × 1.</p>
            <PhotoGrid photos={c.banners} thumbs={allThumbs} onRemove={(p) => patch<CalendarContent>({ banners: c.banners.filter((x) => x !== p) })} />
            <button
              type="button"
              disabled={Boolean(uploading)}
              className={`${buttonClass} mt-2`}
              onClick={() => choosePhotos(true, (paths) => setContent((cur) => ({ ...(cur as CalendarContent), banners: [...(cur as CalendarContent).banners, ...paths].slice(0, 30) })))}
            >
              Ajouter des bandeaux
            </button>
          </div>
        )}
      </>
    );
  } else if (block.kind === "pdf") {
    const c = content as PdfContent;
    fields = (
      <>
        <p className="text-sm text-neutral-600">
          Les pages d&apos;un PDF fourni par l&apos;école (code de vie, horaire…), mises à l&apos;échelle du format de
          l&apos;agenda.
        </p>
        {c.path && (
          <p className="rounded-lg bg-neutral-50 p-3 text-sm">
            <strong>{c.name || "PDF"}</strong> · {c.pageCount} page{c.pageCount > 1 ? "s" : ""}
          </p>
        )}
        <button type="button" disabled={Boolean(uploading)} className={buttonClass} onClick={() => pdfInput.current?.click()}>
          {c.path ? "Remplacer le PDF" : "Choisir un PDF"}
        </button>
        <input
          ref={pdfInput}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError(null);
            setUploading("PDF");
            try {
              const { path, pageCount } = await uploadPdf(target, file);
              patch<PdfContent>({ path, pageCount, name: file.name });
            } catch (err) {
              setError(err instanceof Error ? err.message : "Envoi impossible.");
            } finally {
              setUploading(null);
              if (pdfInput.current) pdfInput.current.value = "";
            }
          }}
        />
      </>
    );
  } else if (block.kind === "sponsors") {
    const c = content as SponsorsContent;
    const slots = SPONSOR_SLOTS[c.layout];
    fields = (
      <>
        <div>
          <label className={labelClass}>Titre</label>
          <input value={c.title} onChange={(e) => patch<SponsorsContent>({ title: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Publicités par page</label>
          <select
            value={c.layout}
            onChange={(e) => {
              const layout = e.target.value as SponsorsLayout;
              patch<SponsorsContent>({ layout, photos: c.photos.slice(0, SPONSOR_SLOTS[layout]) });
            }}
            className={inputClass}
          >
            <option value="1">1 (pleine page)</option>
            <option value="2">2</option>
            <option value="4">4</option>
            <option value="6">6</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>
            Publicités ({c.photos.length} / {slots})
          </label>
          <PhotoGrid photos={c.photos} thumbs={allThumbs} onRemove={(p) => patch<SponsorsContent>({ photos: c.photos.filter((x) => x !== p) })} />
          {c.photos.length < slots && (
            <button
              type="button"
              disabled={Boolean(uploading)}
              className={`${buttonClass} mt-2`}
              onClick={() => choosePhotos(true, (paths) => setContent((cur) => ({ ...(cur as SponsorsContent), photos: [...(cur as SponsorsContent).photos, ...paths].slice(0, slots) })))}
            >
              Ajouter des publicités
            </button>
          )}
        </div>
      </>
    );
  } else {
    const c = content as NotesContent;
    fields = (
      <>
        <div>
          <label className={labelClass}>Titre</label>
          <input value={c.title} onChange={(e) => patch<NotesContent>({ title: e.target.value })} className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Nombre de pages</label>
            <input
              type="number"
              min={1}
              max={40}
              value={c.count}
              onChange={(e) => patch<NotesContent>({ count: Math.min(40, Math.max(1, Math.floor(Number(e.target.value)) || 1)) })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Style</label>
            <select value={c.style} onChange={(e) => patch<NotesContent>({ style: e.target.value as NotesContent["style"] })} className={inputClass}>
              <option value="lined">Lignée</option>
              <option value="blank">Vierge</option>
            </select>
          </div>
        </div>
      </>
    );
  }

  const shown = preview.slice(0, 4);

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <div className="space-y-4">
        {fields}
        <input
          ref={photoInput}
          type="file"
          accept={ACCEPTED_PHOTO_TYPES}
          className="hidden"
          onChange={async (e) => onPhotos.current(await addPhotos(Array.from(e.target.files ?? [])))}
        />
        {uploading && (
          <p className="flex items-center gap-2 text-sm text-neutral-600">
            <SpinnerIcon className="h-4 w-4" /> Envoi… {uploading}
          </p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={save}
            disabled={saving || Boolean(uploading)}
            className="flex items-center gap-2 btn-primary disabled:opacity-60"
          >
            {saving && <SpinnerIcon className="h-4 w-4" />}
            Enregistrer
          </button>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs text-neutral-500">
          {preview.length} page{preview.length > 1 ? "s" : ""}
          {preview.length > shown.length ? `, les ${shown.length} premières` : ""} — pointillé bleu : bord de coupe.
        </p>
        <div className="grid grid-cols-2 gap-1">
          {/* Une page de droite seule commence la rangée à droite, comme dans l'agenda ouvert. */}
          {shown[0] && shown[0].index % 2 === 0 && <div />}
          {shown.map(({ page, index }) => (
            <div key={index} className="border border-neutral-200 shadow-sm">
              <PagePreview page={page} geometry={geometry} thumbs={allThumbs} showTrim />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
