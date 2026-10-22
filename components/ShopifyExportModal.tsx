"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { filenameFromDisposition } from "@/lib/contentDisposition";

// Mockups préparés en parallèle : assez pour aller vite sans saturer le serveur.
const CONCURRENCY = 3;

/**
 * Export des produits choisis vers un fichier d'import Shopify : les mockups
 * de chaque produit sont préparés un à un (progression affichée), puis le
 * CSV est assemblé et téléchargé.
 */
export default function ShopifyExportModal({
  productIds,
  onClose,
}: {
  productIds: string[];
  onClose: () => void;
}) {
  const [price, setPrice] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const busy = progress !== null;

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSkipped([]);
    const total = productIds.length;
    let done = 0;
    setProgress({ done, total });
    const images = new Map<string, string[]>();
    const failures: string[] = [];
    const queue = [...productIds];
    async function worker() {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const res = await fetch(`/api/products/${id}/shopify-images`, { method: "POST" }).catch(() => null);
        const json = res ? await res.json().catch(() => ({})) : {};
        if (res?.ok) images.set(id, json.images ?? []);
        else failures.push(json.error ?? "Mockup impossible (sans image dans l'export).");
        // Sans mockup, le produit part quand même — sans image.
        if (!images.has(id)) images.set(id, []);
        setProgress({ done: ++done, total });
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));

    const res = await fetch("/api/products/shopify-export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price, items: productIds.map((id) => ({ id, images: images.get(id) ?? [] })) }),
    });
    setProgress(null);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "L'export a échoué.");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filenameFromDisposition(res.headers.get("Content-Disposition")) ?? "shopify-produits.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    if (failures.length) setSkipped(failures);
    else onClose();
  }

  return (
    <Modal
      title="Exporter pour Shopify"
      onClose={onClose}
      busy={busy}
      busyDetail={progress ? `Mockups ${progress.done}/${progress.total}` : null}
    >
      <form onSubmit={run} className="space-y-4 text-sm">
        <p className="text-neutral-600">
          {productIds.length} produit{productIds.length > 1 ? "s" : ""}. Chaque collection devient un produit Shopify, avec
          une variante « Format » par produit ; un produit sans collection reste seul. Les images sont les mockups. Les
          produits arrivent en brouillon.
        </p>
        <div>
          <label className="block text-xs font-medium text-neutral-500">Prix de chaque variante ($)</label>
          <input
            required
            inputMode="decimal"
            pattern="[0-9]+([.,][0-9]{1,2})?"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="24,99"
            autoFocus
            className="mt-1 w-40 rounded-lg border border-neutral-300 bg-white px-3 py-2"
          />
        </div>
        {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
        {skipped.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-amber-800">
            <p className="font-medium">Fichier téléchargé, mais certains produits sont sans image :</p>
            <ul className="mt-1 list-disc pl-5">
              {skipped.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-neutral-600 hover:bg-neutral-50"
          >
            Fermer
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-pico-maroon px-4 py-2 font-medium text-white hover:bg-pico-maroon-dark disabled:opacity-50"
          >
            Exporter le fichier CSV
          </button>
        </div>
      </form>
    </Modal>
  );
}
