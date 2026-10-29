"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import UpdatingBadge from "@/components/UpdatingBadge";
import { CheckIcon, FilePenIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import type { IllustrationWithUrl } from "@/lib/types";

// Fond en damier sous chaque vignette : une illustration a souvent de la
// transparence, qu'un fond blanc uni ferait passer pour du blanc imprimé.
const CHECKERBOARD: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, #eee 25%, transparent 25%), linear-gradient(-45deg, #eee 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #eee 75%), linear-gradient(-45deg, transparent 75%, #eee 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
};

function IllustrationCard({ illustration, onChanged }: { illustration: IllustrationWithUrl; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(illustration.name);
  const [busy, setBusy] = useState(false);

  async function rename() {
    if (!name.trim() || name.trim() === illustration.name) {
      setEditing(false);
      setName(illustration.name);
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/illustrations/${illustration.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Le renommage a échoué.");
      return;
    }
    setEditing(false);
    onChanged();
  }

  async function remove() {
    if (!confirm(`Supprimer l'illustration « ${illustration.name} » ?`)) return;
    setBusy(true);
    const res = await fetch(`/api/illustrations/${illustration.id}`, { method: "DELETE" });
    if (!res.ok) {
      setBusy(false);
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "La suppression a échoué.");
      return;
    }
    // Reste grisée jusqu'à sa disparition, comme les autres listes.
    onChanged();
  }

  return (
    <div className={`overflow-hidden card shadow-sm ${busy ? "opacity-50" : ""}`}>
      <div className="flex aspect-square items-center justify-center p-3" style={CHECKERBOARD}>
        {illustration.fileUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={illustration.fileUrl} alt={illustration.name} loading="lazy" decoding="async" className="max-h-full max-w-full object-contain" />
        )}
      </div>
      <div className="flex items-center gap-1 border-t border-neutral-100 p-2">
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              rename();
            }}
          >
            <input
              autoFocus
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setEditing(false);
                  setName(illustration.name);
                }
              }}
              aria-label="Nom de l'illustration"
              className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
            />
            <button
              type="submit"
              aria-label="Enregistrer le nom"
              className="icon-btn"
            >
              <CheckIcon className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <>
            <p className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-text" title={illustration.name}>
              {illustration.name}
            </p>
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Renommer"
              aria-label="Renommer"
              className="icon-btn"
            >
              <FilePenIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              title="Supprimer"
              aria-label="Supprimer"
              className="rounded-lg p-1.5 text-neutral-500 hover:bg-danger-subtle hover:text-danger disabled:opacity-50"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Module Illustrations : téléversement (plusieurs fichiers à la fois),
// recherche par nom, renommage et suppression.
export default function IllustrationsManager({ illustrations }: { illustrations: IllustrationWithUrl[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setMessage(null);
    const body = new FormData();
    for (const f of Array.from(files)) body.append("files", f);
    const res = await fetch("/api/illustrations", { method: "POST", body }).catch(() => null);
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    const data = res ? await res.json().catch(() => ({})) : {};
    const refused: { name: string; reason: string }[] = data.refused ?? [];
    if (!res) setMessage({ tone: "error", text: "Impossible de joindre le serveur." });
    else if (refused.length > 0) {
      setMessage({
        tone: res.ok ? "info" : "error",
        text: `${refused.length} fichier${refused.length > 1 ? "s" : ""} refusé${refused.length > 1 ? "s" : ""} : ${refused
          .map((r) => `${r.name} (${r.reason})`)
          .join(", ")}.`,
      });
    } else if (!res.ok) setMessage({ tone: "error", text: data.error ?? "Le téléversement a échoué." });
    if (data.created?.length) refresh();
  }

  const q = search.trim().toLowerCase();
  const visibles = q ? illustrations.filter((i) => i.name.toLowerCase().includes(q)) : illustrations;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-page-title font-semibold text-text">
            Banque d&apos;illustrations
            <UpdatingBadge show={isPending} />
          </h1>
          <p className="text-sm text-neutral-500">
            {illustrations.length} illustration{illustrations.length > 1 ? "s" : ""}, que le client pose sur son design
            dans l&apos;Outil Shopify.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="flex shrink-0 items-center gap-2 btn-primary disabled:opacity-50"
        >
          {uploading && <SpinnerIcon className="h-4 w-4" />}
          {uploading ? "Envoi en cours..." : "Ajouter des illustrations"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          multiple
          onChange={(e) => upload(e.target.files)}
          className="hidden"
        />
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (nom)..."
          aria-label="Rechercher une illustration"
          className="w-full input sm:max-w-xs"
        />
        <p className="text-xs text-neutral-500">PNG, JPEG, WebP ou SVG, 15 Mo au maximum. Imprimées telles quelles.</p>
      </div>

      {message && (
        <p className={`mb-4 text-sm ${message.tone === "error" ? "text-danger" : "text-neutral-600"}`}>{message.text}</p>
      )}

      {illustrations.length === 0 ? (
        <p className="card p-6 text-center text-sm text-neutral-500">
          Aucune illustration pour l&apos;instant. Ajoutez-en : elles apparaîtront dans l&apos;Outil Shopify, sous
          « Illustration ».
        </p>
      ) : visibles.length === 0 ? (
        <p className="text-sm text-neutral-500">Aucune illustration ne correspond à « {search} ».</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {visibles.map((illustration) => (
            <IllustrationCard key={illustration.id} illustration={illustration} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
