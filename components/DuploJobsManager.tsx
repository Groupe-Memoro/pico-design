"use client";

import { useState } from "react";
import { SpinnerIcon } from "@/components/icons";
import { jobNoFromFileName } from "@/lib/imposition/barcodes";
import { parseAllJobs, type ParsedDuploJob } from "@/lib/imposition/duplo";
import { sheetLabel } from "@/lib/imposition/presets";
import type { ImpositionDuploJob } from "@/lib/types";
import { formatInMm } from "@/lib/pdf/units";

// Catalogue des jobs de la Duplo : import (ou mise à jour) depuis le fichier
// AllJobs exporté par la machine, et liste des jobs enregistrés.
export default function DuploJobsManager({
  jobs,
  barcodeJobNos,
  onChanged,
}: {
  jobs: ImpositionDuploJob[];
  // Numéros de job dont le code-barres (PDF) est importé.
  barcodeJobNos: number[];
  onChanged: () => void;
}) {
  const [parsed, setParsed] = useState<{ fileName: string; jobs: ParsedDuploJob[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [barcodes, setBarcodes] = useState<{ files: { file: File; no: number }[]; ignored: string[] } | null>(null);
  // Progression de l'import des codes-barres (fichiers envoyés / total).
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const withBarcode = new Set(barcodeJobNos);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setParsed({ fileName: file.name, jobs: parseAllJobs(await file.arrayBuffer()) });
    } catch (e) {
      setParsed(null);
      setError(e instanceof Error ? e.message : "Impossible de lire ce fichier.");
    }
  }

  async function request(method: "PUT" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/imposition/duplo-jobs", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Erreur lors de l'enregistrement.");
      return false;
    }
    onChanged();
    return true;
  }

  async function handleImport() {
    if (!parsed) return;
    const ok = await request("PUT", {
      jobs: parsed.jobs.map((j) => ({
        job_no: j.jobNo,
        name: j.name,
        width_mm: j.widthMm,
        length_mm: j.lengthMm,
        slits: j.slits,
        cuts: j.cuts,
        reg_mark: j.regMark,
        side_mark_mm: j.sideMarkMm,
        lead_mark_mm: j.leadMarkMm,
      })),
    });
    if (ok) setParsed(null);
  }

  function handleBarcodeFiles(list: FileList | null) {
    setBarcodeError(null);
    if (!list || list.length === 0) return;
    // Un même numéro ne peut venir que d'un fichier : le dernier gagne.
    const byNo = new Map<number, File>();
    const ignored: string[] = [];
    for (const file of Array.from(list)) {
      const no = jobNoFromFileName(file.name);
      if (no === null) ignored.push(file.name);
      else byNo.set(no, file);
    }
    setBarcodes({
      files: [...byNo].sort((a, b) => a[0] - b[0]).map(([no, file]) => ({ file, no })),
      ignored,
    });
  }

  // Envoie les codes-barres par lots (les requêtes restent petites).
  async function handleBarcodeImport() {
    if (!barcodes) return;
    const BATCH = 20;
    setBusy(true);
    setBarcodeError(null);
    setProgress({ done: 0, total: barcodes.files.length });
    for (let i = 0; i < barcodes.files.length; i += BATCH) {
      const batch = barcodes.files.slice(i, i + BATCH);
      const body = new FormData();
      for (const { file, no } of batch) {
        body.append("files", file);
        body.append("numbers", String(no));
      }
      const res = await fetch("/api/imposition/duplo-barcodes", { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBarcodeError(`${data.error ?? "Erreur lors de l'import."} (${i} fichiers déjà importés)`);
        setBusy(false);
        setProgress(null);
        onChanged();
        return;
      }
      setProgress({ done: Math.min(i + BATCH, barcodes.files.length), total: barcodes.files.length });
    }
    setBusy(false);
    setProgress(null);
    setBarcodes(null);
    onChanged();
  }

  async function handleClear() {
    if (!window.confirm(`Supprimer les ${jobs.length} jobs du catalogue ?`)) return;
    await request("DELETE");
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label className="label">Fichier AllJobs de la Duplo</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => handleFile(e.target.files?.[0])}
          className="block w-full text-sm"
        />
        <p className="text-xs text-neutral-500">
          Importer un fichier remplace le catalogue : les jobs déjà connus sont mis à jour, les nouveaux sont
          ajoutés, ceux qui ne sont plus dans le fichier sont retirés.
        </p>
        {parsed && (
          <button
            type="button"
            onClick={handleImport}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 btn-primary disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="h-4 w-4" />}
            Importer {parsed.jobs.length} jobs de « {parsed.fileName} »
          </button>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>

      <div className="space-y-2">
        <label className="label">
          Codes-barres des jobs (PDF) · {barcodeJobNos.length} importés
        </label>
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={(e) => handleBarcodeFiles(e.target.files)}
          className="block w-full text-sm"
        />
        <p className="text-xs text-neutral-500">
          Le numéro du job est lu dans le nom du fichier (« 004.pdf », « Job_4.pdf »…). Un code-barres déjà importé
          pour ce numéro est remplacé. Il est posé sur le PDF imposé quand ce job est choisi.
        </p>
        {barcodes && (
          <>
            <p className="text-xs text-neutral-600">
              {barcodes.files.length} codes-barres reconnus
              {barcodes.files.length > 0 &&
                ` (n° ${barcodes.files[0].no} à ${barcodes.files[barcodes.files.length - 1].no})`}
              {barcodes.ignored.length > 0 &&
                ` · ${barcodes.ignored.length} ignorés, sans numéro dans le nom : ${barcodes.ignored
                  .slice(0, 3)
                  .join(", ")}${barcodes.ignored.length > 3 ? "…" : ""}`}
            </p>
            {barcodes.files.length > 0 && (
              <button
                type="button"
                onClick={handleBarcodeImport}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 btn-primary disabled:opacity-50"
              >
                {busy && <SpinnerIcon className="h-4 w-4" />}
                {progress ? `Import… ${progress.done} / ${progress.total}` : `Importer ${barcodes.files.length} codes-barres`}
              </button>
            )}
          </>
        )}
        {barcodeError && <p className="text-sm text-danger">{barcodeError}</p>}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">Jobs enregistrés ({jobs.length})</h3>
          {jobs.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              disabled={busy}
              className="text-xs text-neutral-500 underline hover:text-danger disabled:opacity-40"
            >
              Vider le catalogue
            </button>
          )}
        </div>
        {jobs.length === 0 ? (
          <p className="text-sm text-neutral-500">Aucun job pour l&apos;instant.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200 text-sm">
            {jobs.map((job) => (
              <li key={job.id} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0 truncate">
                  <span className="text-neutral-400">N° {job.job_no}</span> {job.name}
                  {!withBarcode.has(job.job_no) && barcodeJobNos.length > 0 && (
                    <span className="ml-2 text-xs text-orange-600">sans code-barres</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-neutral-500">
                  {sheetLabel(job.width_mm, job.length_mm)} · {job.slits.length} refentes · {job.cuts.length} coupes
                  {job.reg_mark ? ` · REG ${formatInMm(job.side_mark_mm)} / ${formatInMm(job.lead_mark_mm)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
