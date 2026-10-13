"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { ChevronDownIcon, ChevronUpIcon, FilePenIcon, TrashIcon } from "@/components/icons";
import AlbumPagePreview from "@/components/albums/AlbumPagePreview";
import AlbumBlockForm from "@/components/albums/AlbumBlockForm";
import { layoutAlbum, type AlbumGeometry } from "@/lib/albums/layout";
import {
  PAGE_KIND_LABELS,
  defaultContent,
  type AlbumPage,
  type AlbumPageKind,
  type AlbumSettings,
  type AlbumStudent,
  type CoverContent,
  type FreeContent,
  type PortraitsContent,
  type SignaturesContent,
} from "@/lib/albums/types";

function summary(block: AlbumPage): string {
  const c = block.content;
  if (block.kind === "cover") return (c as CoverContent).title || "Sans titre";
  if (block.kind === "portraits") return (c as PortraitsContent).group || "Tous les groupes";
  if (block.kind === "free") return (c as FreeContent).title || `${(c as FreeContent).photos.length} photo(s)`;
  return `${(c as SignaturesContent).count} page(s) ${(c as SignaturesContent).style === "lined" ? "lignée(s)" : "vierge(s)"}`;
}

/**
 * Les blocs de l'album, dans l'ordre, avec les pages que chacun produit.
 * Monter / descendre change l'ordre ; le crayon ouvre le bloc.
 */
export default function AlbumPagesPanel({
  albumId,
  geometry,
  settings,
  blocks,
  students,
  thumbs,
  onChanged,
}: {
  albumId: string;
  geometry: AlbumGeometry;
  settings: AlbumSettings;
  blocks: AlbumPage[];
  students: AlbumStudent[];
  thumbs: Record<string, string>;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<AlbumPage | null>(null);
  const [busy, setBusy] = useState(false);
  const pages = useMemo(() => layoutAlbum(geometry, settings, blocks, students), [geometry, settings, blocks, students]);

  async function call(url: string, init: RequestInit) {
    setBusy(true);
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    setBusy(false);
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "L'opération a échoué.");
    onChanged();
    return res;
  }

  async function add(kind: AlbumPageKind) {
    const res = await call(`/api/albums/${albumId}/pages`, { method: "POST", body: JSON.stringify({ kind }) });
    if (res.ok && kind !== "portraits") {
      const { id } = await res.json();
      setEditing({ id, album_id: albumId, kind, position: blocks.length, content: defaultContent(kind) });
    }
  }

  function move(index: number, delta: number) {
    const order = blocks.map((b) => b.id);
    const [moved] = order.splice(index, 1);
    order.splice(index + delta, 0, moved);
    call(`/api/albums/${albumId}/pages`, { method: "PUT", body: JSON.stringify({ order }) });
  }

  function remove(block: AlbumPage) {
    if (!confirm(`Supprimer le bloc « ${PAGE_KIND_LABELS[block.kind]} — ${summary(block)} » ?`)) return;
    call(`/api/albums/${albumId}/pages/${block.id}`, { method: "DELETE" });
  }

  const total = pages.length;

  return (
    <div className={busy ? "pointer-events-none opacity-60" : ""}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-600">
          {total} page{total > 1 ? "s" : ""}
          {total % 4 !== 0 && (
            <span className="text-amber-700">
              {" "}
              · reliure piquée : il faut un multiple de 4 ({Math.ceil(total / 4) * 4}), ajoutez {Math.ceil(total / 4) * 4 - total}{" "}
              page{Math.ceil(total / 4) * 4 - total > 1 ? "s" : ""}
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {(["free", "portraits", "signatures", "cover"] as AlbumPageKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => add(kind)}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
            >
              + {PAGE_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {blocks.map((block, index) => {
          const own = pages.filter((p) => p.blockId === block.id);
          return (
            <div key={block.id} className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">{PAGE_KIND_LABELS[block.kind]}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-pico-black">{summary(block)}</span>
                <span className="text-xs text-neutral-500">
                  {own.length} page{own.length > 1 ? "s" : ""}
                </span>
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Monter" className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30">
                  <ChevronUpIcon className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === blocks.length - 1} aria-label="Descendre" className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30">
                  <ChevronDownIcon className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setEditing(block)} aria-label="Modifier" title="Modifier" className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-pico-black">
                  <FilePenIcon className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => remove(block)} aria-label="Supprimer" title="Supprimer" className="rounded p-1 text-neutral-500 hover:bg-red-50 hover:text-red-600">
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {own.map((page, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setEditing(block)}
                    className="w-28 shrink-0 overflow-hidden rounded border border-neutral-200 shadow-sm hover:border-neutral-400"
                    title={`Page ${pages.indexOf(page) + 1}`}
                  >
                    <AlbumPagePreview page={page} geometry={geometry} thumbs={thumbs} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <Modal title={`${PAGE_KIND_LABELS[editing.kind]} — modifier`} onClose={() => setEditing(null)} full>
          <AlbumBlockForm
            albumId={albumId}
            block={editing}
            geometry={geometry}
            settings={settings}
            students={students}
            thumbs={thumbs}
            onSaved={() => {
              setEditing(null);
              onChanged();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
