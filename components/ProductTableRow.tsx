"use client";

import { useState } from "react";
import type { Product } from "@/lib/types";
import { CheckIcon, DownloadIcon, FilePenIcon, LayersIcon, ShopifyIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { templateSizeLabel } from "@/lib/templateLabel";

export default function ProductTableRow({
  product,
  templateName,
  categoryLabel,
  collectionLabel,
  dimensions,
  imageUrl,
  hasMockup,
  selected,
  onToggleSelect,
  onEdit,
  onViewMockup,
  onRefresh,
}: {
  product: Product;
  templateName: string;
  categoryLabel: string;
  collectionLabel: string | null;
  dimensions: { width_mm: number; height_mm: number; fold?: unknown } | null;
  imageUrl: string | null;
  hasMockup: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: (product: Product) => void;
  onViewMockup: (product: Product) => void;
  onRefresh: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  // L'identifiant à coller dans le produit Shopify (champ « Produit Pico ») pour
  // vendre ce produit tel quel : la commande arrive avec son PDF.
  async function handleCopyId() {
    try {
      await navigator.clipboard.writeText(product.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
    } catch {
      // Presse-papiers indisponible (permissions navigateur) : l'id reste
      // lisible dans l'infobulle du bouton.
    }
  }

  async function handleDelete() {
    if (!confirm(`Supprimer le produit « ${product.name} » ?`)) return;
    setDeleting(true);
    const res = await fetch(`/api/products/${product.id}`, { method: "DELETE" });
    if (!res.ok) {
      setDeleting(false);
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Erreur lors de la suppression.");
      return;
    }
    // Ne pas repasser `deleting` à false ici : la ligne doit rester
    // grisée/en chargement jusqu'à sa disparition effective (données
    // rafraîchies), sinon elle "revient à la normale" un instant avant de
    // disparaître, ce qui donne l'impression que rien ne se passe puis que
    // ça plante.
    onRefresh();
  }

  return (
    <tr
      className={`border-t border-neutral-100 transition-opacity duration-300 hover:bg-neutral-50 ${
        deleting ? "opacity-40" : ""
      }`}
    >
      <td className="p-4">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} />
      </td>
      <td className="p-4">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={product.name} className="h-12 w-12 rounded-lg object-cover" />
        ) : (
          <div className="h-12 w-12 rounded-lg bg-neutral-100" />
        )}
      </td>
      <td className="p-4 font-semibold text-text">{product.name}</td>
      <td className="p-4 text-neutral-700">{templateName}</td>
      <td className="p-4 text-neutral-700">
        {dimensions ? templateSizeLabel(dimensions, false, "×") : "—"}
      </td>
      <td className="p-4 text-neutral-500">{categoryLabel}</td>
      <td className="p-4 text-neutral-500">{collectionLabel ?? "—"}</td>
      <td className="p-4 text-right">
        <div className="flex justify-end gap-1">
          {product.pdf_path ? (
            <a
              href={`/api/products/${product.id}/pdf`}
              title="Télécharger le PDF"
              aria-label="Télécharger le PDF"
              className="icon-btn"
            >
              <DownloadIcon className="h-4 w-4" />
            </a>
          ) : (
            <span
              title="PDF pas encore généré"
              aria-label="PDF pas encore généré"
              className="inline-flex rounded-lg p-1.5 text-neutral-300"
            >
              <DownloadIcon className="h-4 w-4" />
            </span>
          )}
          {hasMockup && (
            <button
              onClick={() => onViewMockup(product)}
              title="Voir le mockup"
              aria-label="Voir le mockup"
              className="icon-btn"
            >
              <LayersIcon className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={handleCopyId}
            title={copiedId ? "Id copié" : `Copier l'id pour Shopify (${product.id})`}
            aria-label="Copier l'id pour Shopify"
            className="icon-btn"
          >
            {copiedId ? <CheckIcon className="h-4 w-4 text-success-strong" /> : <ShopifyIcon className="h-4 w-4" />}
          </button>
          <button
            onClick={() => onEdit(product)}
            title="Modifier"
            aria-label="Modifier"
            className="icon-btn"
          >
            <FilePenIcon className="h-4 w-4" />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="Supprimer"
            aria-label="Supprimer"
            className="inline-flex rounded-lg p-1.5 text-neutral-500 hover:bg-danger-subtle hover:text-danger disabled:opacity-50"
          >
            {deleting ? <SpinnerIcon className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
          </button>
        </div>
      </td>
    </tr>
  );
}
