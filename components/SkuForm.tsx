"use client";

import { useState } from "react";
import type { Sku, SkuGroup } from "@/lib/types";
import { SpinnerIcon } from "@/components/icons";

export default function SkuForm({
  sku,
  skuGroups,
  onSuccess,
}: {
  sku?: Sku;
  skuGroups: SkuGroup[];
  onSuccess: () => void;
}) {
  const isEditing = Boolean(sku);
  const [form, setForm] = useState({
    sku: sku?.sku ?? "",
    name: sku?.name ?? "",
    sku_group_id: sku?.sku_group_id ?? skuGroups[0]?.id ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(isEditing ? `/api/skus/${sku!.id}` : "/api/skus", {
      method: isEditing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();

    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Erreur lors de l'enregistrement.");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium">SKU</label>
        <input
          required
          value={form.sku}
          onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
          placeholder="Ex. imp-4x6-1side"
          className="mt-1 w-full input font-mono"
        />
      </div>
      <div>
        <label className="block text-sm font-medium">Nom / descriptif</label>
        <input
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Ex. Papeterie - 4 x 6 pouces / 1 côté"
          className="mt-1 w-full input"
        />
      </div>
      <div>
        <label className="block text-sm font-medium">Groupe</label>
        <select
          required
          value={form.sku_group_id}
          onChange={(e) => setForm((f) => ({ ...f, sku_group_id: e.target.value }))}
          className="mt-1 w-full input"
        >
          {skuGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        {skuGroups.length === 0 && (
          <p className="mt-1 text-xs text-warning-strong">
            Aucun groupe disponible — crée-en un d&apos;abord.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 btn-primary disabled:opacity-50"
      >
        {loading && <SpinnerIcon className="h-4 w-4" />}
        {isEditing ? "Enregistrer" : "Créer le SKU"}
      </button>
    </form>
  );
}
