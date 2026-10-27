"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { DownloadIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import type { CsvData } from "@/lib/studentCards/csv";
import { parseDataFile } from "@/lib/studentCards/dataFile";
import { PhotoIndex, collectPhotos, shrinkPhoto } from "@/lib/studentCards/photos";
import { zoneText, type CardZone, type DataVocab } from "@/lib/studentCards/types";
import { MAX_SORT_KEYS, sortedRowIndexes, type SortKey } from "@/lib/studentCards/sort";

// Un lot envoyé au rendu : sous la limite de taille d'une requête (4,5 Mo),
// photos allégées comprises.
const MAX_BATCH_BYTES = 3_200_000;
const MAX_BATCH_CARDS = 60;

interface Result {
  url: string;
  filename: string;
  count: number;
  warnings: string[];
}

/**
 * Production : le fichier des lignes (élèves, clients…), leurs photos (ZIP
 * ou fichiers, en plusieurs fois au besoin), puis le PDF — une page par face, recto et
 * verso à la suite. Le rendu se fait par lots ; le navigateur assemble.
 */
export default function CardProduction({
  templateId,
  apiBase,
  templateName,
  vocab,
  zones,
  data,
  onData,
  dataFile,
  onRemoveData,
  loadingData,
  photos,
  onPhotos,
  photoColumn,
  onPhotoColumn,
  previewIndex,
  missingColumns,
  beforeGenerate,
}: {
  templateId: string;
  // « /api/student-cards » ou « /api/data-templates ».
  apiBase: string;
  templateName: string;
  vocab: DataVocab;
  zones: CardZone[];
  data: CsvData | null;
  // Nouveau fichier déposé : ses données, et le fichier (enregistré avec le document).
  onData: (data: CsvData, file: File) => void;
  // Fichier conservé avec le document : son nom, s'il est déjà enregistré ou
  // le sera au prochain enregistrement, et de quoi le retirer.
  dataFile: { name: string; pending: boolean } | null;
  onRemoveData: () => void;
  loadingData: boolean;
  photos: PhotoIndex;
  onPhotos: (photos: PhotoIndex) => void;
  photoColumn: string;
  onPhotoColumn: (column: string) => void;
  previewIndex: number;
  missingColumns: string[];
  beforeGenerate: () => Promise<boolean>;
}) {
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // Ordre de production : jusqu'à trois colonnes (vide = ordre du fichier).
  const [sortKeys, setSortKeys] = useState<SortKey[]>([]);
  // Une colonne disparue (autre fichier chargé) ne trie plus rien.
  const activeSort = useMemo(
    () => sortKeys.filter((k) => k.column && data?.columns.includes(k.column)),
    [sortKeys, data]
  );
  const order = useMemo(() => (data ? sortedRowIndexes(data.rows, activeSort) : []), [data, activeSort]);
  const updateSortKey = (index: number, patch: Partial<SortKey>) =>
    setSortKeys((keys) => keys.map((k, i) => (i === index ? { ...k, ...patch } : k)));

  const needsPhoto = zones.some((z) => z.kind === "photo");
  const firstText = zones.find((z) => z.kind === "text" && z.content);
  const labelOf = (row: Record<string, string>, i: number) => {
    const name = firstText ? zoneText(firstText, row) : "";
    // Ligne du fichier : l'en-tête est la ligne 1.
    return `Ligne ${i + 2}${name ? ` (${name})` : ""}`;
  };

  // Lignes sans photo jumelée.
  const missingPhotos = useMemo(() => {
    if (!data || !needsPhoto) return [];
    return data.rows.flatMap((row, i) => (photos.find(row, photoColumn || null) ? [] : [labelOf(row, i)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, photos, photoColumn, needsPhoto, zones]);

  async function loadCsv(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      onData(parseDataFile(await file.arrayBuffer(), file.name), file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fichier illisible.");
    }
  }

  async function addPhotos(files: File[]) {
    if (files.length === 0) return;
    setLoadingPhotos(true);
    setError(null);
    try {
      const found = await collectPhotos(files);
      if (found.length === 0) setError("Aucune image trouvée (JPEG, PNG ou WebP, ou un ZIP qui en contient).");
      const all = [...photoFiles, ...found];
      setPhotoFiles(all);
      onPhotos(new PhotoIndex(all));
    } catch {
      setError("Impossible d'ouvrir ce ZIP.");
    } finally {
      setLoadingPhotos(false);
    }
  }

  async function generate(onlyPreview: boolean) {
    if (!data) return;
    setError(null);
    if (!(await beforeGenerate())) return;
    const indexes = onlyPreview ? [previewIndex] : order;
    setProgress({ done: 0, total: indexes.length });
    const chunks: ArrayBuffer[] = [];
    const warnings: string[] = [];
    try {
      let batch: { form: FormData; cards: unknown[]; bytes: number } = { form: new FormData(), cards: [], bytes: 0 };
      let done = 0;
      const flush = async () => {
        if (batch.cards.length === 0) return;
        batch.form.append("cards", JSON.stringify(batch.cards));
        const res = await fetch(`${apiBase}/${templateId}/render`, { method: "POST", body: batch.form });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Le rendu a échoué.");
        }
        const header = res.headers.get("X-Card-Warnings");
        const shown = header ? (JSON.parse(decodeURIComponent(header)) as string[]) : [];
        warnings.push(...shown);
        const total = Number(res.headers.get("X-Card-Warning-Count") ?? 0);
        if (total > shown.length) warnings.push(`… et ${total - shown.length} autre(s) avertissement(s) dans ce lot.`);
        chunks.push(await res.arrayBuffer());
        done += batch.cards.length;
        setProgress({ done, total: indexes.length });
        batch = { form: new FormData(), cards: [], bytes: 0 };
      };
      for (const i of indexes) {
        const row = data.rows[i];
        const label = labelOf(row, i);
        const file = needsPhoto ? photos.find(row, photoColumn || null) : null;
        let photoField: string | null = null;
        if (file) {
          try {
            const small = await shrinkPhoto(file);
            if (batch.bytes + small.size > MAX_BATCH_BYTES) await flush();
            photoField = `photo${batch.cards.length}`;
            batch.form.append(photoField, small, `${photoField}.jpg`);
            batch.bytes += small.size;
          } catch {
            warnings.push(`${label} : photo illisible (${file.name}).`);
          }
        }
        batch.cards.push({ row, photo: photoField, label });
        if (batch.cards.length >= MAX_BATCH_CARDS) await flush();
      }
      await flush();

      // Les lots en un seul PDF, dans l'ordre choisi (celui du fichier par défaut).
      const { PDFDocument } = await import("pdf-lib");
      const merged = await PDFDocument.create();
      for (const bytes of chunks) {
        const doc = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      }
      const blob = new Blob([new Uint8Array(await merged.save())], { type: "application/pdf" });
      const first = data.rows[indexes[0]];
      const suffix = onlyPreview ? `essai ${firstText ? zoneText(firstText, first) : indexes[0] + 2}` : `${indexes.length} ${vocab.pages}`;
      if (result) URL.revokeObjectURL(result.url);
      setResult({
        url: URL.createObjectURL(blob),
        filename: `${templateName} - ${suffix}.pdf`.replace(/[\\/:*?"<>|]+/g, " "),
        count: indexes.length,
        warnings,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "La production a échoué.");
    } finally {
      setProgress(null);
    }
  }

  const busy = progress !== null;
  return (
    <section className="space-y-3 card p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-text">Produire les {vocab.pages}</h2>

      <div className="space-y-1">
        <span className="label">1. Fichier des {vocab.rows} (Excel ou CSV)</span>
        <input
          type="file"
          accept=".csv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={busy}
          onChange={(e) => {
            loadCsv(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
          className="w-full text-xs"
        />
        {loadingData && <p className="text-xs text-neutral-600">Lecture du fichier enregistré…</p>}
        {dataFile && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-2 py-1.5 text-xs">
            <span className="min-w-0 truncate text-neutral-700">
              {dataFile.name}{" "}
              <span className={dataFile.pending ? "text-warning-strong" : "text-success-strong"}>
                {dataFile.pending ? "· sera conservé à l'enregistrement" : "· conservé avec le modèle"}
              </span>
            </span>
            <button
              type="button"
              onClick={onRemoveData}
              disabled={busy}
              className="shrink-0 text-neutral-500 underline hover:text-danger"
            >
              Retirer
            </button>
          </div>
        )}
        {data ? (
          <p className="text-xs text-neutral-600">
            {data.rows.length} {data.rows.length > 1 ? vocab.rows : vocab.row} · colonnes : {data.columns.join(", ")}
          </p>
        ) : (
          <p className="text-xs text-neutral-500">
            Un classeur Excel (.xlsx, première feuille) ou un CSV (« ; » ou « , »). La première ligne donne les noms
            des colonnes.
          </p>
        )}
        {missingColumns.length > 0 && (
          <p className="text-xs text-warning-strong">
            Colonnes utilisées par les zones mais absentes du fichier : {missingColumns.join(", ")}.
          </p>
        )}
      </div>

      {needsPhoto && (
        <div className="space-y-1 border-t border-neutral-100 pt-3">
          <span className="label">2. Photos</span>
          <label className="block text-xs text-neutral-600">
            Colonne qui désigne la photo
            <select
              value={photoColumn}
              onChange={(e) => onPhotoColumn(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="">— Choisir —</option>
              {(data?.columns ?? (photoColumn ? [photoColumn] : [])).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,.zip,application/zip"
            disabled={busy || loadingPhotos}
            onChange={(e) => {
              addPhotos(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
            className="w-full text-xs"
          />
          <p className="text-xs text-neutral-500">
            Un ZIP, des photos, ou les deux, en plusieurs fois au besoin. Chaque photo est jumelée par son nom de
            fichier : un numéro (123456.jpg) ou le nom donné dans la colonne choisie.
          </p>
          {loadingPhotos && <p className="text-xs text-neutral-600">Ouverture des photos…</p>}
          {photos.size > 0 && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-neutral-600">
                {photos.size} photo{photos.size > 1 ? "s" : ""}
                {data && ` · ${data.rows.length - missingPhotos.length} / ${data.rows.length} ${vocab.rows} avec photo`}
              </span>
              <button
                type="button"
                onClick={() => {
                  setPhotoFiles([]);
                  onPhotos(new PhotoIndex([]));
                }}
                className="text-neutral-500 underline hover:text-text"
              >
                Retirer les photos
              </button>
            </div>
          )}
          {data && missingPhotos.length > 0 && (photos.size > 0 || photoColumn) && (
            <details className="text-xs text-warning-strong">
              <summary className="cursor-pointer">
                {missingPhotos.length} {missingPhotos.length > 1 ? vocab.rows : vocab.row} sans photo (zone photo laissée vide)
              </summary>
              <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5">
                {missingPhotos.slice(0, 100).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {data && (
        <div className="space-y-2 border-t border-neutral-100 pt-3">
          <span className="label">
            {needsPhoto ? "3" : "2"}. Ordre des {vocab.pages}
          </span>
          {sortKeys.length === 0 && <p className="text-xs text-neutral-500">Dans l&apos;ordre du fichier.</p>}
          {sortKeys.map((key, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-xs text-neutral-500">{i === 0 ? "Trier par" : "puis par"}</span>
              <select
                value={key.column}
                onChange={(e) => updateSortKey(i, { column: e.target.value })}
                disabled={busy}
                aria-label={`Critère ${i + 1}`}
                className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
              >
                <option value="">— Colonne —</option>
                {data.columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <div className="flex shrink-0 overflow-hidden rounded-lg border border-neutral-300 text-xs">
                {[false, true].map((descending) => (
                  <button
                    key={String(descending)}
                    type="button"
                    onClick={() => updateSortKey(i, { descending })}
                    disabled={busy}
                    title={descending ? "Décroissant (Z → A, 9 → 1)" : "Croissant (A → Z, 1 → 9)"}
                    className={`px-2 py-1.5 ${
                      key.descending === descending ? "bg-pico-black text-white" : "bg-surface text-neutral-600 hover:bg-neutral-50"
                    }`}
                  >
                    {descending ? "Z → A" : "A → Z"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSortKeys((keys) => keys.filter((_, j) => j !== i))}
                disabled={busy}
                aria-label={`Retirer le critère ${i + 1}`}
                className="shrink-0 rounded-lg p-1 text-neutral-400 hover:bg-danger-subtle hover:text-danger"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2 text-xs">
            {sortKeys.length < MAX_SORT_KEYS ? (
              <button
                type="button"
                onClick={() => setSortKeys((keys) => [...keys, { column: "", descending: false }])}
                disabled={busy}
                className="text-neutral-600 underline hover:text-text"
              >
                {sortKeys.length === 0 ? "Trier selon une colonne" : "Ajouter un critère"}
              </button>
            ) : (
              <span />
            )}
            {activeSort.length > 0 && data.rows.length > 0 && (
              <span className="min-w-0 truncate text-neutral-500" title={labelOf(data.rows[order[0]], order[0])}>
                1re : {labelOf(data.rows[order[0]], order[0])}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-neutral-100 pt-3">
        {error && <p className="text-xs text-danger">{error}</p>}
        <button
          type="button"
          onClick={() => generate(false)}
          disabled={busy || !data || zones.length === 0}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-pico-maroon px-4 py-2.5 text-sm font-medium text-white hover:bg-pico-maroon-dark disabled:opacity-50"
        >
          {busy && <SpinnerIcon className="h-4 w-4" />}
          {busy
            ? `${vocab.pages.charAt(0).toUpperCase()}${vocab.pages.slice(1)} ${progress.done} / ${progress.total}…`
            : data
              ? `Produire ${data.rows.length} ${data.rows.length > 1 ? vocab.pages : vocab.page}`
              : `Produire les ${vocab.pages}`}
        </button>
        <button
          type="button"
          onClick={() => generate(true)}
          disabled={busy || !data || zones.length === 0}
          className="w-full btn-secondary disabled:opacity-50"
        >
          Essai : {vocab.Row.toLowerCase()} {previewIndex + 1} seulement
        </button>
        {!data && <p className="text-xs text-neutral-500">Chargez d&apos;abord le fichier des {vocab.rows} (Excel ou CSV).</p>}
      </div>

      {result && (
        <Modal
          title={`${result.count} ${result.count > 1 ? vocab.pages : vocab.page} prête${result.count > 1 ? "s" : ""}`}
          onClose={() => {
            URL.revokeObjectURL(result.url);
            setResult(null);
          }}
          wide
        >
          <iframe src={result.url} title="Cartes" className="h-[60vh] w-full rounded border border-neutral-200" />
          {result.warnings.length > 0 && (
            <details className="mt-3 text-sm text-warning-strong" open={result.warnings.length <= 5}>
              <summary className="cursor-pointer">
                {result.warnings.length} avertissement{result.warnings.length > 1 ? "s" : ""}
              </summary>
              <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-xs">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <a
            href={result.url}
            download={result.filename}
            className="mt-4 flex items-center justify-center gap-2 btn-primary"
          >
            <DownloadIcon className="h-4 w-4" />
            Télécharger le PDF
          </a>
        </Modal>
      )}
    </section>
  );
}
