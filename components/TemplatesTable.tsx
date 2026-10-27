"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import TemplateRow from "@/components/TemplateRow";
import TemplateForm from "@/components/TemplateForm";
import CollectionsManager from "@/components/CollectionsManager";
import TemplateMockupsManager from "@/components/TemplateMockupsManager";
import Modal from "@/components/Modal";
import BulkActionsBar from "@/components/BulkActionsBar";
import UpdatingBadge from "@/components/UpdatingBadge";
import { useSelection } from "@/components/useSelection";
import type { Category, Sku, Template } from "@/lib/types";

export type TemplateWithOverlayUrl = Template & {
  overlayUrl: string | null;
};

function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3.5 w-3.5">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-5 4 5M8 15l4 5 4-5" />
    </svg>
  );
}

type ModalState =
  | { mode: "create" }
  | { mode: "edit"; template: TemplateWithOverlayUrl }
  | { mode: "preview"; template: Template; nonce: number }
  | { mode: "mockups"; template: Template }
  | { mode: "categories" }
  | null;

export default function TemplatesTable({
  templates,
  categories,
  skus,
  impositionProfiles = [],
}: {
  templates: TemplateWithOverlayUrl[];
  categories: Category[];
  skus: Sku[];
  impositionProfiles?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [modal, setModal] = useState<ModalState>(null);
  const [formBusy, setFormBusy] = useState(false);
  const selection = useSelection();
  const [bulkDeleting, setBulkDeleting] = useState(false);

  function refresh() {
    startTransition(() => router.refresh());
  }

  const skuCode = useMemo(() => {
    const map = new Map(skus.map((s) => [s.id, s.sku]));
    return (id: string | null) => (id ? map.get(id) ?? null : null);
  }, [skus]);

  const filtered = useMemo(() => {
    return templates
      .filter((t) => (categoryId ? t.category_id === categoryId : true))
      .filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => (sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)));
  }, [templates, search, categoryId, sortDir]);

  function handleSuccess() {
    setModal(null);
    refresh();
  }

  async function handleBulkDelete() {
    const ids = [...selection.selected];
    if (ids.length === 0) return;
    if (!confirm(`Supprimer ${ids.length} modèle(s) ?`)) return;
    setBulkDeleting(true);
    const results = await Promise.all(
      ids.map((id) => fetch(`/api/templates/${id}`, { method: "DELETE" }))
    );
    const failed = results.filter((r) => !r.ok).length;
    // Regroupés dans la même transition que le refresh : la barre reste
    // visible (avec son spinner) jusqu'à ce que les données rafraîchies
    // soient prêtes, au lieu de disparaître aussitôt en laissant les lignes
    // encore affichées un instant, sans indicateur.
    startTransition(() => {
      router.refresh();
      selection.clear();
      setBulkDeleting(false);
    });
    if (failed > 0) alert(`${failed} suppression(s) ont échoué.`);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-page-title font-semibold text-text">
            Modèles
            <UpdatingBadge show={isPending} />
          </h1>
          <p className="text-sm text-neutral-500">
            {templates.length} modèle{templates.length > 1 ? "s" : ""} au catalogue.
          </p>
        </div>
        <button
          onClick={() => setModal({ mode: "create" })}
          className="flex items-center gap-2 btn-primary"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
          </svg>
          Nouveau modèle
        </button>
      </div>

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
            className="w-full rounded-lg border border-neutral-300 bg-surface py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="label">Catégorie</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="mt-1 input"
            >
              <option value="">— Toutes —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setModal({ mode: "categories" })}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            Gérer les catégories
          </button>
        </div>
      </div>

      <BulkActionsBar
        count={selection.selected.size}
        label="modèle"
        deleting={bulkDeleting}
        onDelete={handleBulkDelete}
        onClear={selection.clear}
      />

      {filtered.length === 0 ? (
        <p className="card p-4 text-sm text-neutral-500">
          Aucun modèle ne correspond.
        </p>
      ) : (
        <div className="overflow-x-auto card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-sm font-semibold text-neutral-700">
                <th className="w-10 p-4">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((t) => selection.selected.has(t.id))}
                    onChange={() => selection.toggleAll(filtered.map((t) => t.id))}
                  />
                </th>
                <th className="p-4">
                  <button
                    type="button"
                    onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                    className="flex items-center gap-1 hover:text-text"
                  >
                    Nom <SortIcon />
                  </button>
                </th>
                <th className="p-4">Impression</th>
                <th className="p-4">SKU</th>
                <th className="p-4">Dimensions</th>
                <th className="p-4 text-center">Imposition</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  skuCode={skuCode(t.sku_id)}
                  impositionProfileName={impositionProfiles.find((p) => p.id === t.imposition_profile_id)?.name ?? null}
                  selected={selection.selected.has(t.id)}
                  onToggleSelect={() => selection.toggle(t.id)}
                  onPreview={(tpl) => setModal({ mode: "preview", template: tpl, nonce: Date.now() })}
                  onEdit={(tpl) => setModal({ mode: "edit", template: tpl })}
                  onManageMockups={(tpl) => setModal({ mode: "mockups", template: tpl })}
                  onRefresh={refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.mode === "categories" && (
        <Modal title="Gérer les catégories" onClose={() => setModal(null)}>
          <CollectionsManager
            items={categories}
            apiBasePath="/api/categories"
            itemLabel="catégorie"
            onChanged={() => {
              refresh();
            }}
          />
        </Modal>
      )}

      {modal?.mode === "preview" && (
        <Modal title={`Aperçu — ${modal.template.name}`} onClose={() => setModal(null)} wide>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/templates/${modal.template.id}/preview?t=${modal.nonce}`}
            alt={`Aperçu du modèle ${modal.template.name}`}
            className="mx-auto max-h-[70vh] w-auto rounded border border-neutral-200"
          />
          <p className="mt-3 text-center text-xs text-neutral-500">
            Fond gris = image du produit · ligne magenta = ligne de coupe (fond perdu) · pointillés
            bleus = marge de protection. Le logo Pico est affiché à sa position réelle.
          </p>
        </Modal>
      )}

      {modal?.mode === "mockups" && (
        <Modal title={`Mockups — ${modal.template.name}`} onClose={() => setModal(null)}>
          <TemplateMockupsManager templateId={modal.template.id} />
        </Modal>
      )}

      {(modal?.mode === "create" || modal?.mode === "edit") && (
        <Modal
          title={modal.mode === "create" ? "Nouveau modèle" : `Modifier « ${modal.template.name} »`}
          onClose={() => setModal(null)}
          wide
          busy={formBusy}
        >
          <TemplateForm
            template={modal.mode === "edit" ? modal.template : undefined}
            categories={categories}
            skus={skus}
            impositionProfiles={impositionProfiles}
            currentOverlayUrl={modal.mode === "edit" ? modal.template.overlayUrl : null}
            onSuccess={handleSuccess}
            onBusyChange={setFormBusy}
          />
        </Modal>
      )}
    </div>
  );
}
