"use client";

import { useMemo, useRef, useState } from "react";
import { SpinnerIcon, TrashIcon } from "@/components/icons";
import AlbumPagePreview from "@/components/albums/AlbumPagePreview";
import { layoutAlbum, type AlbumGeometry } from "@/lib/albums/layout";
import { ACCEPTED_PHOTO_TYPES, PAGE_PHOTO_MAX_PX, uploadAlbumPhotos } from "@/lib/albums/upload";
import {
  FREE_LAYOUT_SLOTS,
  type AlbumPage,
  type AlbumPageContent,
  type AlbumSettings,
  type AlbumStudent,
  type CoverContent,
  type FreeContent,
  type FreeLayout,
  type PortraitsContent,
  type SignaturesContent,
} from "@/lib/albums/types";

const inputClass = "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm";
const labelClass = "block text-sm font-medium";

/**
 * Modifier un bloc de l'album. L'aperçu à droite suit la saisie ; rien n'est
 * enregistré avant « Enregistrer ». Les photos, elles, partent au stockage dès
 * qu'on les choisit (leur aperçu vient alors du fichier local).
 */
export default function AlbumBlockForm({
  albumId,
  block,
  geometry,
  settings,
  students,
  thumbs,
  onSaved,
}: {
  albumId: string;
  block: AlbumPage;
  geometry: AlbumGeometry;
  settings: AlbumSettings;
  students: AlbumStudent[];
  thumbs: Record<string, string>;
  onSaved: () => void;
}) {
  const [content, setContent] = useState<AlbumPageContent>(block.content);
  const [localThumbs, setLocalThumbs] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => [...new Set(students.map((s) => s.group_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")), [students]);
  const preview = useMemo(
    () => layoutAlbum(geometry, settings, [{ ...block, content }], students),
    [geometry, settings, block, content, students]
  );
  const allThumbs = { ...thumbs, ...localThumbs };

  function patch<T extends AlbumPageContent>(p: Partial<T>) {
    setContent((c) => ({ ...c, ...p }) as AlbumPageContent);
  }

  // Envoie des photos et renvoie leurs chemins (aperçu local en attendant).
  async function upload(files: File[]): Promise<string[]> {
    setError(null);
    setUploading(`0 / ${files.length}`);
    try {
      const results = await uploadAlbumPhotos(albumId, files, PAGE_PHOTO_MAX_PX, (done, total) => setUploading(`${done} / ${total}`));
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
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/albums/${albumId}/pages/${block.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Enregistrement impossible.");
      return;
    }
    onSaved();
  }

  let fields: React.ReactNode = null;
  if (block.kind === "cover") {
    const c = content as CoverContent;
    fields = (
      <>
        <div>
          <label className={labelClass}>Titre</label>
          <input value={c.title} onChange={(e) => patch<CoverContent>({ title: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Sous-titre</label>
          <input value={c.subtitle} onChange={(e) => patch<CoverContent>({ subtitle: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Photo</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={Boolean(uploading)}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              {c.photo ? "Remplacer la photo" : "Choisir une photo"}
            </button>
            {c.photo && (
              <button type="button" onClick={() => patch<CoverContent>({ photo: null })} className="text-sm text-red-600 hover:underline">
                Retirer
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_PHOTO_TYPES}
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const [path] = await upload([file]);
              if (path) patch<CoverContent>({ photo: path });
            }}
          />
        </div>
        {c.photo && (
          <div>
            <label className={labelClass}>Place de la photo</label>
            <select value={c.photoMode} onChange={(e) => patch<CoverContent>({ photoMode: e.target.value as CoverContent["photoMode"] })} className={inputClass}>
              <option value="top">Haut de la page, titre dessous</option>
              <option value="full">Pleine page, titre sur un bandeau</option>
            </select>
          </div>
        )}
      </>
    );
  } else if (block.kind === "portraits") {
    const c = content as PortraitsContent;
    fields = (
      <>
        <div>
          <label className={labelClass}>Titre de la première page</label>
          <input value={c.title} onChange={(e) => patch<PortraitsContent>({ title: e.target.value })} placeholder="Nos finissants" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Élèves</label>
          <select value={c.group} onChange={(e) => patch<PortraitsContent>({ group: e.target.value })} className={inputClass}>
            <option value="">Tous les groupes (chaque groupe commence une page)</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g} seulement
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-neutral-500">
          Les pages se créent toutes seules : {settings.columns} × {settings.rows} portraits par page, triés par nom (grille
          modifiable dans Réglages).
        </p>
      </>
    );
  } else if (block.kind === "free") {
    const c = content as FreeContent;
    const slots = FREE_LAYOUT_SLOTS[c.layout];
    fields = (
      <>
        <div>
          <label className={labelClass}>Titre</label>
          <input value={c.title} onChange={(e) => patch<FreeContent>({ title: e.target.value })} placeholder="Ex. Le bal" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Mise en page</label>
          <select
            value={c.layout}
            onChange={(e) => {
              const layout = e.target.value as FreeLayout;
              patch<FreeContent>({ layout, photos: c.photos.slice(0, FREE_LAYOUT_SLOTS[layout]) });
            }}
            className={inputClass}
          >
            <option value="1">1 photo</option>
            <option value="2">2 photos</option>
            <option value="4">4 photos</option>
            <option value="6">6 photos</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>
            Photos ({c.photos.length} / {slots})
          </label>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {c.photos.map((p, i) => (
              <div key={p} className="group relative aspect-square overflow-hidden rounded-lg bg-neutral-100">
                {allThumbs[p] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={allThumbs[p]} alt="" className="h-full w-full object-cover" />
                )}
                <span className="absolute left-1 top-1 rounded bg-white/90 px-1 text-[10px] font-medium">{i + 1}</span>
                <button
                  type="button"
                  onClick={() => patch<FreeContent>({ photos: c.photos.filter((x) => x !== p) })}
                  aria-label="Retirer la photo"
                  className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-neutral-600 hover:text-red-600"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          {c.photos.length < slots && (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={Boolean(uploading)}
              className="mt-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              Ajouter des photos
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_PHOTO_TYPES}
            multiple
            className="hidden"
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []).slice(0, slots - c.photos.length);
              if (files.length === 0) return;
              const paths = await upload(files);
              setContent((cur) => ({ ...(cur as FreeContent), photos: [...(cur as FreeContent).photos, ...paths].slice(0, slots) }));
            }}
          />
        </div>
        <div>
          <label className={labelClass}>Texte (facultatif)</label>
          <textarea value={c.text} onChange={(e) => patch<FreeContent>({ text: e.target.value })} rows={4} className={inputClass} />
        </div>
      </>
    );
  } else {
    const c = content as SignaturesContent;
    fields = (
      <>
        <div>
          <label className={labelClass}>Titre</label>
          <input value={c.title} onChange={(e) => patch<SignaturesContent>({ title: e.target.value })} className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Nombre de pages</label>
            <input
              type="number"
              min={1}
              max={20}
              value={c.count}
              onChange={(e) => patch<SignaturesContent>({ count: Math.min(20, Math.max(1, Math.floor(Number(e.target.value)) || 1)) })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Style</label>
            <select value={c.style} onChange={(e) => patch<SignaturesContent>({ style: e.target.value as SignaturesContent["style"] })} className={inputClass}>
              <option value="lined">Lignée</option>
              <option value="blank">Vierge</option>
            </select>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <div className="space-y-4">
        {fields}
        {uploading && (
          <p className="flex items-center gap-2 text-sm text-neutral-600">
            <SpinnerIcon className="h-4 w-4" /> Envoi des photos… {uploading}
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={save}
            disabled={saving || Boolean(uploading)}
            className="flex items-center gap-2 rounded-lg bg-pico-maroon px-4 py-2 text-sm font-medium text-white hover:bg-pico-maroon-dark disabled:opacity-60"
          >
            {saving && <SpinnerIcon className="h-4 w-4" />}
            Enregistrer
          </button>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs text-neutral-500">
          Aperçu{preview.length > 1 ? ` (${preview.length} pages, les 2 premières)` : ""} — pointillé bleu : bord de coupe.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {preview.slice(0, 2).map((page, i) => (
            <div key={i} className="rounded border border-neutral-200 shadow-sm">
              <AlbumPagePreview page={page} geometry={geometry} thumbs={allThumbs} showTrim />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
