"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { DownloadIcon, EyeIcon, FilePenIcon, SendIcon, SpinnerIcon, TrashIcon } from "@/components/icons";

// « 21 septembre 2026 à 17:39 »
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" });
  const time = date.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit", hour12: false });
  // fr-CA écrit « 17 h 39 » : on veut « 17:39 ».
  return `${day} à ${time.replace(/\s*h\s*/, ":")}`;
}

export interface ImpositionRow {
  id: string;
  name: string;
  // Date du dernier enregistrement (création ou modification).
  updated_at: string;
}

// Boutons d'action : icône seule (le libellé est dans l'info-bulle et pour les lecteurs d'écran).
const actionClass =
  "rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-text disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-400";

export default function ImpositionsTable({ rows }: { rows: ImpositionRow[] }) {
  const router = useRouter();
  const [viewing, setViewing] = useState<ImpositionRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Aperçu : le PDF est lu (la route redirige vers le stockage) puis affiché via
  // une adresse blob:, car la CSP n'autorise dans un cadre que 'self' et blob:.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  useEffect(() => {
    if (!viewing) return;
    let url: string | null = null;
    let cancelled = false;
    fetch(`/api/impositions/${viewing.id}/pdf`)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (cancelled) return;
        if (!blob) return setPreviewFailed(true);
        url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewFailed(true);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setPreviewUrl(null);
      setPreviewFailed(false);
    };
  }, [viewing]);

  async function handleDelete(row: ImpositionRow) {
    if (!confirm(`Supprimer l'imposition « ${row.name} » ? Son PDF sera supprimé aussi.`)) return;
    setDeletingId(row.id);
    const res = await fetch(`/api/impositions/${row.id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "La suppression a échoué.");
      return;
    }
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <p className="card p-4 text-sm text-neutral-500">
        Aucune imposition enregistrée pour l&apos;instant. Cliquez sur « Nouvelle imposition » pour commencer.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-sm font-semibold text-neutral-700">
              <th className="p-4">Nom</th>
              <th className="p-4">Date</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                <td className="p-4 font-semibold text-text">{row.name}</td>
                <td className="whitespace-nowrap p-4 text-neutral-500">
                  {formatDateTime(row.updated_at)}
                </td>
                <td className="p-4">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setViewing(row)}
                      title="Voir le PDF"
                      aria-label="Voir le PDF"
                      className={actionClass}
                    >
                      <EyeIcon className="h-4 w-4" />
                    </button>
                    {/* La suite (commande, mise en production) viendra plus tard. */}
                    <button
                      type="button"
                      disabled
                      title="Envoyer en commande (bientôt disponible)"
                      aria-label="Envoyer en commande (bientôt disponible)"
                      className={actionClass}
                    >
                      <SendIcon className="h-4 w-4" />
                    </button>
                    <Link
                      href={`/imposition/${row.id}`}
                      title="Modifier"
                      aria-label="Modifier"
                      className={actionClass}
                    >
                      <FilePenIcon className="h-4 w-4" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(row)}
                      disabled={deletingId === row.id}
                      title="Supprimer"
                      aria-label="Supprimer"
                      className={`${actionClass} hover:bg-danger-subtle hover:text-danger`}
                    >
                      {deletingId === row.id ? <SpinnerIcon className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewing && (
        <Modal title={viewing.name} onClose={() => setViewing(null)} wide>
          {previewUrl ? (
            <iframe
              src={previewUrl}
              title={viewing.name}
              className="h-[65vh] w-full rounded border border-neutral-200"
            />
          ) : (
            <div className="flex h-[65vh] w-full items-center justify-center rounded border border-neutral-200">
              {previewFailed ? (
                <p className="text-sm text-text-subtle">Aperçu indisponible. Le téléchargement reste possible.</p>
              ) : (
                <SpinnerIcon className="h-5 w-5 animate-spin" />
              )}
            </div>
          )}
          <a
            href={`/api/impositions/${viewing.id}/pdf?download=1`}
            className="mt-4 flex items-center justify-center gap-2 btn-primary"
          >
            <DownloadIcon className="h-4 w-4" />
            Télécharger le PDF
          </a>
        </Modal>
      )}
    </>
  );
}
