"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ThemeForm from "@/components/ThemeForm";
import Modal from "@/components/Modal";
import UpdatingBadge from "@/components/UpdatingBadge";
import { FilePenIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import type { Template, Theme } from "@/lib/types";
import { templateOptionLabel } from "@/lib/templateLabel";

// URL signées du graphisme et du fond (null sans fond, voir Theme.background_path).
export type ThemeWithOverlayUrl = Theme & { overlayUrl: string | null; backgroundUrl: string | null };

type ModalState = { mode: "create" } | { mode: "edit"; theme: ThemeWithOverlayUrl } | null;

/**
 * Admin des Thèmes (voir supabase/migrations/0046_themes.sql) : grille de
 * cartes (comme la Banque de visuels), filtrable par modèle — un thème est
 * toujours attribué à un seul modèle (voir ThemeForm), contrairement aux
 * visuels qui sont réutilisables partout.
 */
export default function ThemesTable({
  themes,
  templates,
}: {
  themes: ThemeWithOverlayUrl[];
  templates: Template[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  const templateName = useMemo(() => {
    const map = new Map(templates.map((t) => [t.id, t.name]));
    return (id: string) => map.get(id) ?? "—";
  }, [templates]);

  const filtered = useMemo(
    () =>
      themes
        .filter((t) => (templateId ? t.template_id === templateId : true))
        .filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase())),
    [themes, search, templateId]
  );

  function handleSuccess() {
    setModal(null);
    refresh();
  }

  async function handleDelete(theme: ThemeWithOverlayUrl) {
    if (!confirm(`Supprimer le thème « ${theme.name} » ?`)) return;
    setDeletingId(theme.id);
    const res = await fetch(`/api/themes/${theme.id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Erreur lors de la suppression.");
      return;
    }
    refresh();
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-page-title font-semibold text-pico-black">
            Thèmes
            <UpdatingBadge show={isPending} />
          </h1>
          <p className="text-sm text-neutral-500">
            {themes.length} thème{themes.length > 1 ? "s" : ""} — visuels préfaits par-dessus les photos
            du client, attribués à un modèle.
          </p>
        </div>
        <button
          onClick={() => setModal({ mode: "create" })}
          disabled={templates.length === 0}
          className="flex items-center gap-2 rounded-lg bg-pico-maroon px-4 py-2 text-sm font-medium text-white hover:bg-pico-maroon-dark disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
          </svg>
          Nouveau thème
        </button>
      </div>

      {templates.length === 0 && (
        <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Aucun modèle disponible — crée-en un d&apos;abord dans{" "}
          <a href="/templates" className="underline">
            Modèles
          </a>
          .
        </p>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
            />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (nom)..."
            className="w-full rounded-lg border border-neutral-300 bg-white py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500">Modèle</label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="mt-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">— Tous —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {templateOptionLabel(t)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
          Aucun thème ne correspond.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {filtered.map((t) => (
            <div
              key={t.id}
              className={`overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition-opacity duration-300 ${
                deletingId === t.id ? "opacity-40" : ""
              }`}
            >
              <div className="flex h-32 items-center justify-center bg-neutral-50 p-3">
                {t.overlayUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.overlayUrl} alt={t.name} className="max-h-full max-w-full object-contain" />
                ) : (
                  <div className="h-full w-full rounded bg-neutral-100" />
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-pico-black">{t.name}</span>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => setModal({ mode: "edit", theme: t })}
                      title="Modifier"
                      aria-label="Modifier"
                      className="inline-flex rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-pico-black"
                    >
                      <FilePenIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(t)}
                      disabled={deletingId === t.id}
                      title="Supprimer"
                      aria-label="Supprimer"
                      className="inline-flex rounded-lg p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      {deletingId === t.id ? <SpinnerIcon className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <p className="mt-0.5 truncate text-xs text-neutral-500">{templateName(t.template_id)}</p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {t.slots.length} emplacement{t.slots.length > 1 ? "s" : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {(modal?.mode === "create" || modal?.mode === "edit") && (
        <Modal
          title={modal.mode === "create" ? "Nouveau thème" : `Modifier « ${modal.theme.name} »`}
          onClose={() => setModal(null)}
          full
          busy={formBusy}
        >
          <ThemeForm
            theme={modal.mode === "edit" ? modal.theme : undefined}
            templates={templates}
            currentOverlayUrl={modal.mode === "edit" ? modal.theme.overlayUrl : null}
            onSuccess={handleSuccess}
            onBusyChange={setFormBusy}
          />
        </Modal>
      )}
    </div>
  );
}
