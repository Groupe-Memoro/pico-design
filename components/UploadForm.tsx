"use client";

import { useState } from "react";
import Link from "next/link";
import type { Category, Product } from "@/lib/types";
import { SpinnerIcon } from "@/components/icons";
import { templateOptionLabel } from "@/lib/templateLabel";

type ProductOption = Product & {
  imageUrl: string | null;
  template: { name: string; category_id: string; width_mm: number; height_mm: number; dpi: number; two_sided: boolean } | null;
};

export default function UploadForm({
  products,
  categories,
}: {
  products: ProductOption[];
  categories: Category[];
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const selected = products.find((p) => p.id === productId) ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) return;

    setLoading(true);
    setError(null);
    setDownloadUrl(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur lors de la génération.");
      setDownloadUrl(data.downloadUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  if (products.length === 0) {
    return (
      <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        Aucun produit configuré. Crée d&apos;abord un produit dans{" "}
        <Link href="/products" className="underline">
          Produits
        </Link>
        .
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium">Produit</label>
        <select
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            setDownloadUrl(null);
          }}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
        >
          {categories.map((category) => {
            const items = products.filter((p) => p.template?.category_id === category.id);
            if (items.length === 0) return null;
            return (
              <optgroup key={category.id} label={category.name}>
                {items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.template ? templateOptionLabel(p.template) : ""}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </div>

      {selected && (
        <div>
          {selected.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selected.imageUrl}
              alt={selected.name}
              className="max-h-64 rounded border"
            />
          )}
          {selected.template && (
            <p className="mt-2 text-sm text-neutral-500">
              {selected.template.width_mm}×{selected.template.height_mm}mm · {selected.template.dpi} dpi
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center gap-2 rounded bg-pico-black px-4 py-2 text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {loading && <SpinnerIcon className="h-4 w-4" />}
        {loading ? "Génération en cours..." : "Générer le PDF"}
      </button>

      {downloadUrl && (
        <div className="rounded border border-green-300 bg-green-50 p-4">
          <p className="mb-2 text-sm text-green-800">PDF généré avec succès.</p>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-pico-black underline"
          >
            Télécharger le PDF prêt pour impression
          </a>
        </div>
      )}
    </form>
  );
}
