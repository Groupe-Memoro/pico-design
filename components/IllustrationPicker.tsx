"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { SpinnerIcon } from "@/components/icons";
import { ILLUSTRATION_TYPES } from "@/lib/illustrations";
import type { IllustrationWithUrl } from "@/lib/types";

// Même damier que le module Illustrations : la transparence reste visible.
const CHECKERBOARD: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, #eee 25%, transparent 25%), linear-gradient(-45deg, #eee 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #eee 75%), linear-gradient(-45deg, transparent 75%, #eee 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
};

/**
 * Choix d'une illustration de la banque, dans l'Outil Shopify. L'illustration
 * choisie est téléchargée puis remise à l'appelant comme un FICHIER : elle
 * devient un calque image ordinaire (voir LayersPanel), qui suit tout le
 * parcours existant (aperçu, PDF, mockup, design enregistré) sans rien de
 * particulier côté serveur.
 */
export default function IllustrationPicker({
  illustrations,
  onPick,
  onClose,
}: {
  illustrations: IllustrationWithUrl[];
  onPick: (file: File) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(illustration: IllustrationWithUrl) {
    if (!illustration.fileUrl || loadingId) return;
    setLoadingId(illustration.id);
    setError(null);
    try {
      const res = await fetch(illustration.fileUrl);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const extension = ILLUSTRATION_TYPES[illustration.mime_type];
      onPick(new File([blob], `${illustration.name}.${extension}`, { type: illustration.mime_type }));
    } catch {
      // Adresse signée expirée (page ouverte depuis plus d'une heure) ou réseau.
      setError("Impossible de charger cette illustration. Recharge la page et réessaie.");
      setLoadingId(null);
    }
  }

  const q = search.trim().toLowerCase();
  const visibles = q ? illustrations.filter((i) => i.name.toLowerCase().includes(q)) : illustrations;

  return (
    <Modal title="Ajouter une illustration" onClose={onClose} wide>
      <input
        type="search"
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher une illustration..."
        aria-label="Rechercher une illustration"
        className="mb-4 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
      />
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {visibles.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-subtle">Aucune illustration ne correspond à « {search} ».</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {visibles.map((illustration) => (
            <button
              key={illustration.id}
              type="button"
              onClick={() => pick(illustration)}
              disabled={Boolean(loadingId)}
              title={illustration.name}
              className="group overflow-hidden rounded-xl border border-border text-left hover:border-primary disabled:cursor-wait"
            >
              <span className="relative flex aspect-square items-center justify-center p-2" style={CHECKERBOARD}>
                {illustration.fileUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={illustration.fileUrl}
                    alt=""
                    loading="lazy"
                    className="max-h-full max-w-full object-contain transition-transform duration-150 group-hover:scale-105"
                  />
                )}
                {loadingId === illustration.id && (
                  <span className="absolute inset-0 flex items-center justify-center bg-neutral-50/60">
                    <SpinnerIcon className="h-5 w-5" />
                  </span>
                )}
              </span>
              <span className="block truncate px-2 py-1.5 text-xs text-text-muted">{illustration.name}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
