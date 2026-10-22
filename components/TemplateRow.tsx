"use client";

import { useState } from "react";
import type { Template } from "@/lib/types";
import type { TemplateWithOverlayUrl } from "@/components/TemplatesTable";
import { CheckIcon, CopyIcon, LinkIcon, EyeIcon, FilePenIcon, LayersIcon, ShopifyIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { templateSizeLabel } from "@/lib/templateLabel";

export default function TemplateRow({
  template,
  skuCode,
  impositionProfileName = null,
  selected,
  onToggleSelect,
  onPreview,
  onEdit,
  onManageMockups,
  onRefresh,
}: {
  template: TemplateWithOverlayUrl;
  skuCode: string | null;
  // Profil d'imposition du modèle (mise en production automatique), s'il en a un.
  impositionProfileName?: string | null;
  selected: boolean;
  onToggleSelect: () => void;
  onPreview: (template: Template) => void;
  onEdit: (template: TemplateWithOverlayUrl) => void;
  onManageMockups: (template: Template) => void;
  onRefresh: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  // L'identifiant à coller dans le produit Shopify pour le lier à ce modèle.
  async function handleCopyId() {
    try {
      await navigator.clipboard.writeText(template.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
    } catch {
      // Presse-papiers indisponible (permissions navigateur) : l'id reste
      // lisible dans l'infobulle du bouton.
    }
  }

  async function handleDelete() {
    if (!confirm(`Supprimer le modèle « ${template.name} » ?`)) return;
    setDeleting(true);
    const res = await fetch(`/api/templates/${template.id}`, { method: "DELETE" });
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

  async function handleDuplicate() {
    setDuplicating(true);
    const res = await fetch(`/api/templates/${template.id}/duplicate`, { method: "POST" });
    setDuplicating(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Erreur lors de la duplication.");
      return;
    }
    onRefresh();
  }

  return (
    <tr
      className={`border-t border-neutral-100 transition-opacity duration-300 hover:bg-neutral-50 ${
        deleting || duplicating ? "opacity-40" : ""
      }`}
    >
      <td className="p-4">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} />
      </td>
      <td className="p-4 font-semibold text-pico-black">{template.name}</td>
      <td className="p-4 text-neutral-500">
        {template.two_sided ? "Recto-verso" : "Recto"}
      </td>
      <td className="p-4 font-mono text-xs text-neutral-500">{skuCode ?? "—"}</td>
      <td className="p-4 text-neutral-700">
        {templateSizeLabel(template, true, "×")}
      </td>
      {/* Profil d'imposition associé (mise en production automatique). */}
      <td className="p-4 text-center">
        {impositionProfileName ? (
          <span
            className="inline-flex"
            title={`Profil d'imposition : ${impositionProfileName}`}
            aria-label={`Profil d'imposition : ${impositionProfileName}`}
          >
            <LinkIcon className="h-4 w-4 text-green-600" />
          </span>
        ) : (
          <span className="text-neutral-300" aria-label="Aucun profil d'imposition">—</span>
        )}
      </td>
      <td className="p-4 text-right">
        <div className="flex justify-end gap-1">
          <button
            onClick={() => onPreview(template)}
            title="Visualiser"
            aria-label="Visualiser"
            className="inline-flex rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-pico-black"
          >
            <EyeIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => onManageMockups(template)}
            title="Mockups"
            aria-label="Mockups"
            className="inline-flex rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-pico-black"
          >
            {/* Même icône que le mockup d'un produit (ProductTableRow) : un
                mockup se reconnaît partout au même symbole. */}
            <LayersIcon className="h-4 w-4" />
          </button>
          {/* Pas l'icône « copier » : elle sert déjà à Dupliquer, juste à côté. */}
          <button
            onClick={handleCopyId}
            title={copiedId ? "Id copié" : `Copier l'id pour Shopify (${template.id})`}
            aria-label="Copier l'id pour Shopify"
            className="inline-flex rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-pico-black"
          >
            {copiedId ? <CheckIcon className="h-4 w-4 text-green-600" /> : <ShopifyIcon className="h-4 w-4" />}
          </button>
          <button
            onClick={handleDuplicate}
            disabled={duplicating}
            title="Dupliquer"
            aria-label="Dupliquer"
            className="inline-flex rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-pico-black disabled:opacity-50"
          >
            {duplicating ? <SpinnerIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
          </button>
          <button
            onClick={() => onEdit(template)}
            title="Modifier"
            aria-label="Modifier"
            className="inline-flex rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-pico-black"
          >
            <FilePenIcon className="h-4 w-4" />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="Supprimer"
            aria-label="Supprimer"
            className="inline-flex rounded-lg p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            {deleting ? <SpinnerIcon className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
          </button>
        </div>
      </td>
    </tr>
  );
}
