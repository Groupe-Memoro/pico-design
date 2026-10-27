"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SkuForm from "@/components/SkuForm";
import SkuGroupsManager from "@/components/SkuGroupsManager";
import Modal from "@/components/Modal";
import BulkActionsBar from "@/components/BulkActionsBar";
import UpdatingBadge from "@/components/UpdatingBadge";
import { useSelection } from "@/components/useSelection";
import { FilePenIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import type { Sku, SkuGroup } from "@/lib/types";

type ModalState =
  | { mode: "create" }
  | { mode: "edit"; sku: Sku }
  | { mode: "groups" }
  | null;

export default function SkusTable({ skus, skuGroups }: { skus: Sku[]; skuGroups: SkuGroup[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selection = useSelection();
  const [bulkDeleting, setBulkDeleting] = useState(false);

  function refresh() {
    startTransition(() => router.refresh());
  }

  const groupName = useMemo(() => {
    const map = new Map(skuGroups.map((g) => [g.id, g.name]));
    return (id: string) => map.get(id) ?? "—";
  }, [skuGroups]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skus
      .filter((s) => (groupId ? s.sku_group_id === groupId : true))
      .filter((s) => (q ? s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) : true));
  }, [skus, search, groupId]);

  function handleSuccess() {
    setModal(null);
    refresh();
  }

  async function handleDelete(sku: Sku) {
    if (!confirm(`Supprimer le SKU « ${sku.sku} » ?`)) return;
    setBusyId(sku.id);
    setError(null);
    const res = await fetch(`/api/skus/${sku.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      setError(data.error ?? "Erreur lors de la suppression.");
      return;
    }
    refresh();
  }

  async function handleBulkDelete() {
    const ids = [...selection.selected];
    if (ids.length === 0) return;
    if (!confirm(`Supprimer ${ids.length} SKU ?`)) return;
    setBulkDeleting(true);
    setError(null);
    const results = await Promise.all(ids.map((id) => fetch(`/api/skus/${id}`, { method: "DELETE" })));
    setBulkDeleting(false);
    selection.clear();
    refresh();
    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) setError(`${failed} suppression(s) ont échoué.`);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-page-title font-semibold text-text">
            SKU
            <UpdatingBadge show={isPending} />
          </h1>
          <p className="text-sm text-neutral-500">
            {skus.length} SKU{skus.length > 1 ? "s" : ""} au référentiel.
          </p>
        </div>
        <button
          onClick={() => setModal({ mode: "create" })}
          className="flex items-center gap-2 btn-primary"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
          </svg>
          Nouveau SKU
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
            placeholder="Rechercher (SKU ou nom)..."
            className="w-full rounded-lg border border-neutral-300 bg-surface py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="label">Groupe</label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="mt-1 input"
            >
              <option value="">— Tous —</option>
              {skuGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setModal({ mode: "groups" })}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            Gérer les groupes
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-danger">{error}</p>}

      <BulkActionsBar
        count={selection.selected.size}
        label="SKU"
        deleting={bulkDeleting}
        onDelete={handleBulkDelete}
        onClear={selection.clear}
      />

      {filtered.length === 0 ? (
        <p className="card p-4 text-sm text-neutral-500">
          Aucun SKU ne correspond.
        </p>
      ) : (
        <div className="overflow-x-auto card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-sm font-semibold text-neutral-700">
                <th className="w-10 p-4">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((s) => selection.selected.has(s.id))}
                    onChange={() => selection.toggleAll(filtered.map((s) => s.id))}
                  />
                </th>
                <th className="p-4">SKU</th>
                <th className="p-4">Nom / descriptif</th>
                <th className="p-4">Groupe</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className={`border-t border-neutral-100 transition-opacity duration-300 ${
                    busyId === s.id ? "opacity-40" : ""
                  }`}
                >
                  <td className="p-4">
                    <input
                      type="checkbox"
                      checked={selection.selected.has(s.id)}
                      onChange={() => selection.toggle(s.id)}
                    />
                  </td>
                  <td className="p-4 font-mono text-xs text-neutral-700">{s.sku}</td>
                  <td className="p-4">{s.name}</td>
                  <td className="p-4 text-neutral-500">{groupName(s.sku_group_id)}</td>
                  <td className="p-4">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setModal({ mode: "edit", sku: s })}
                        title="Modifier"
                        aria-label="Modifier"
                        className="icon-btn"
                      >
                        <FilePenIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        disabled={busyId === s.id}
                        title="Supprimer"
                        aria-label="Supprimer"
                        className="inline-flex rounded-lg p-1.5 text-neutral-500 hover:bg-danger-subtle hover:text-danger disabled:opacity-50"
                      >
                        {busyId === s.id ? <SpinnerIcon className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.mode === "groups" && (
        <Modal title="Gérer les groupes" onClose={() => setModal(null)}>
          <SkuGroupsManager
            skuGroups={skuGroups}
            onChanged={() => {
              refresh();
            }}
          />
        </Modal>
      )}

      {(modal?.mode === "create" || modal?.mode === "edit") && (
        <Modal
          title={modal.mode === "create" ? "Nouveau SKU" : `Modifier « ${modal.sku.sku} »`}
          onClose={() => setModal(null)}
        >
          <SkuForm
            sku={modal.mode === "edit" ? modal.sku : undefined}
            skuGroups={skuGroups}
            onSuccess={handleSuccess}
          />
        </Modal>
      )}
    </div>
  );
}
