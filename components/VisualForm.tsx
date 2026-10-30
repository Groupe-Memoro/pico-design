"use client";

import { useEffect, useState } from "react";
import type { Visual, VisualCollection } from "@/lib/types";
import { SpinnerIcon } from "@/components/icons";

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx > 0 ? filename.slice(0, idx) : filename;
}

export default function VisualForm({
  visual,
  currentFileUrl,
  collections,
  onSuccess,
}: {
  visual?: Visual;
  currentFileUrl?: string | null;
  collections: VisualCollection[];
  onSuccess: () => void;
}) {
  const isEditing = Boolean(visual);
  const [name, setName] = useState(visual?.name ?? "");
  const [nameTouched, setNameTouched] = useState(isEditing);
  const [collectionId, setCollectionId] = useState(visual?.collection_id ?? "");
  // "auto" : deviné d'après l'image à l'enregistrement (voir lib/visualPattern.ts).
  const [isPattern, setIsPattern] = useState<"auto" | "true" | "false">(visual ? String(visual.is_pattern) as "true" | "false" : "auto");
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Nom pré-rempli à partir du nom du fichier (sans l'extension) quand un
  // seul fichier est sélectionné, tant qu'il n'a pas été modifié à la main.
  useEffect(() => {
    if (nameTouched || files.length !== 1) return;
    setName(stripExtension(files[0].name));
  }, [files, nameTouched]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    setFiles(list);
    // Un PDF ne peut pas s'afficher dans une balise <img> — pas d'aperçu
    // local dans ce cas (il sera converti en PNG côté serveur à l'envoi).
    const single = list.length === 1 ? list[0] : null;
    setPreview(single && single.type !== "application/pdf" ? URL.createObjectURL(single) : null);
  }

  const singlePdfSelected = files.length === 1 && files[0].type === "application/pdf";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isEditing && files.length === 0) {
      setError("Au moins un fichier est requis.");
      return;
    }
    setLoading(true);
    setError(null);

    if (isEditing || files.length <= 1) {
      const formData = new FormData();
      formData.append("name", name);
      formData.append("collectionId", collectionId);
      formData.append("isPattern", isPattern);
      if (files[0]) formData.append("file", files[0]);

      const res = await fetch(isEditing ? `/api/visuals/${visual!.id}` : "/api/visuals", {
        method: isEditing ? "PATCH" : "POST",
        body: formData,
      });
      const data = await res.json();

      setLoading(false);
      if (!res.ok) {
        setError(data.error ?? "Erreur lors de l'enregistrement.");
        return;
      }
      onSuccess();
      return;
    }

    // Plusieurs fichiers : un visuel par fichier, nommé d'après son nom.
    const failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setProgress({ done: i, total: files.length });
      const f = files[i];
      const formData = new FormData();
      formData.append("name", stripExtension(f.name));
      formData.append("collectionId", collectionId);
      formData.append("isPattern", isPattern);
      formData.append("file", f);
      const res = await fetch("/api/visuals", { method: "POST", body: formData });
      if (!res.ok) failed.push(f.name);
    }
    setProgress(null);
    setLoading(false);

    if (failed.length > 0) {
      setError(`Échec pour : ${failed.join(", ")}`);
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {files.length <= 1 && (
        <div>
          <label className="block text-sm font-medium">Nom du visuel</label>
          <input
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            placeholder="Ex. Motif pois orange"
            className="mt-1 w-full input"
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium">
          Fichier{!isEditing ? "s" : ""} (SVG, PNG, JPG, PDF){" "}
          {isEditing ? "(laisser vide pour garder l'actuel)" : ""}
        </label>
        <input
          type="file"
          accept="image/svg+xml,image/png,image/jpeg,application/pdf"
          multiple={!isEditing}
          onChange={handleFileChange}
          className="mt-1 w-full text-sm"
        />
        {files.length > 1 ? (
          <p className="mt-2 text-sm text-neutral-600">
            {files.length} fichiers sélectionnés — chacun sera ajouté comme un visuel séparé,
            nommé d&apos;après son nom de fichier.
          </p>
        ) : singlePdfSelected ? (
          <p className="mt-2 text-sm text-neutral-600">
            📄 {files[0].name} — sera converti en image (PNG) à l&apos;enregistrement.
          </p>
        ) : /* eslint-disable-next-line @next/next/no-img-element */
        preview ? (
          <img src={preview} alt="Aperçu" className="mt-3 max-h-48 rounded border" />
        ) : currentFileUrl ? (
          <img src={currentFileUrl} alt="Fichier actuel" className="mt-3 max-h-48 rounded border" />
        ) : null}
      </div>

      <div>
        <label className="block text-sm font-medium">Collection</label>
        <select
          value={collectionId}
          onChange={(e) => setCollectionId(e.target.value)}
          className="mt-1 w-full input"
        >
          <option value="">— Aucune —</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium">Motif répétable</label>
        <select
          value={isPattern}
          onChange={(e) => setIsPattern(e.target.value as typeof isPattern)}
          className="mt-1 w-full input"
        >
          <option value="auto">Détecter automatiquement</option>
          <option value="true">Oui, motif répétable</option>
          <option value="false">Non, visuel simple</option>
        </select>
        <p className="mt-1 text-xs text-neutral-500">
          Un motif se répète sans raccord visible (mosaïque). La détection compare les bords opposés de
          l&apos;image{files.length > 1 ? ", fichier par fichier" : ""}.
        </p>
      </div>

      {progress && (
        <p className="flex items-center gap-2 text-sm text-neutral-600">
          <SpinnerIcon className="h-4 w-4" />
          Envoi {progress.done + 1}/{progress.total}...
        </p>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg bg-pico-maroon px-4 py-2 text-white hover:bg-pico-maroon-dark disabled:opacity-50"
      >
        {loading && <SpinnerIcon className="h-4 w-4" />}
        {loading
          ? "Enregistrement..."
          : isEditing
          ? "Enregistrer"
          : files.length > 1
          ? `Ajouter ${files.length} visuels`
          : "Ajouter le visuel"}
      </button>
    </form>
  );
}
