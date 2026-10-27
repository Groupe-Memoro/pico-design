"use client";

import { useState } from "react";
import type { SkuGroup } from "@/lib/types";
import { FilePenIcon, SpinnerIcon, TrashIcon } from "@/components/icons";

export default function SkuGroupsManager({
  skuGroups,
  onChanged,
}: {
  skuGroups: SkuGroup[];
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    const res = await fetch("/api/sku-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) {
      setError(data.error ?? "Erreur lors de la création.");
      return;
    }
    setNewName("");
    onChanged();
  }

  function startEdit(group: SkuGroup) {
    setEditingId(group.id);
    setEditingName(group.name);
    setError(null);
  }

  async function saveEdit(id: string) {
    if (!editingName.trim()) return;
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/sku-groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingName.trim() }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setError(data.error ?? "Erreur lors de l'enregistrement.");
      return;
    }
    setEditingId(null);
    onChanged();
  }

  async function handleDelete(group: SkuGroup) {
    if (!confirm(`Supprimer le groupe « ${group.name} » ?`)) return;
    setBusyId(group.id);
    setError(null);
    const res = await fetch(`/api/sku-groups/${group.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      setError(data.error ?? "Erreur lors de la suppression.");
      return;
    }
    onChanged();
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
        {skuGroups.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-2 p-3">
            {editingId === g.id ? (
              <input
                autoFocus
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit(g.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
              />
            ) : (
              <span className="text-sm text-text">{g.name}</span>
            )}
            <div className="flex shrink-0 gap-1">
              {editingId === g.id ? (
                <button
                  onClick={() => saveEdit(g.id)}
                  disabled={busyId === g.id}
                  title="Enregistrer"
                  aria-label="Enregistrer"
                  className="icon-btn disabled:opacity-50"
                >
                  {busyId === g.id ? (
                    <SpinnerIcon className="h-4 w-4" />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ) : (
                <button
                  onClick={() => startEdit(g)}
                  title="Modifier"
                  aria-label="Modifier"
                  className="icon-btn"
                >
                  <FilePenIcon className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => handleDelete(g)}
                disabled={busyId === g.id}
                title="Supprimer"
                aria-label="Supprimer"
                className="inline-flex rounded-lg p-1.5 text-neutral-500 hover:bg-danger-subtle hover:text-danger disabled:opacity-50"
              >
                {busyId === g.id ? <SpinnerIcon className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
              </button>
            </div>
          </li>
        ))}
        {skuGroups.length === 0 && (
          <li className="p-3 text-sm text-neutral-500">Aucun groupe pour l&apos;instant.</li>
        )}
      </ul>

      {error && <p className="text-sm text-danger">{error}</p>}

      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nouveau groupe..."
          className="flex-1 input"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="inline-flex items-center gap-2 btn-primary disabled:opacity-50"
        >
          {creating && <SpinnerIcon className="h-4 w-4" />}
          Ajouter
        </button>
      </form>
    </div>
  );
}
