"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import UpdatingBadge from "@/components/UpdatingBadge";
import { FilePenIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { CARD_FORMATS, type StudentCardTemplate } from "@/lib/studentCards/types";

const formatLabel = (w: number, h: number) =>
  `${String(Number(w)).replace(".", ",")} × ${String(Number(h)).replace(".", ",")} mm`;

// Vignette du recto, rendue comme à la production avec l'élève d'exemple
// (voir thumbnailVariableData). L'URL change à chaque enregistrement.
function CardThumbnail({ template: t }: { template: StudentCardTemplate }) {
  const [failed, setFailed] = useState(false);
  const W = Number(t.width_mm);
  const H = Number(t.height_mm);
  const empty = !t.front_path && t.zones.length === 0;
  return (
    <div
      className="flex h-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-100 shadow-sm ring-1 ring-neutral-200"
      style={{ aspectRatio: `${W} / ${H}` }}
    >
      {empty || failed ? (
        <span className="px-1 text-center text-[10px] leading-tight text-neutral-400">Aucun aperçu</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/student-cards/${t.id}/thumbnail?v=${encodeURIComponent(t.updated_at)}`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  );
}

// Nouveau modèle : nom, école, format et recto-verso. Le reste se règle dans l'éditeur.
function NewCardForm({ schools, onCancel }: { schools: string[]; onCancel: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [format, setFormat] = useState(0);
  const [twoSided, setTwoSided] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { width, height } = CARD_FORMATS[format];
    const res = await fetch("/api/student-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, school, width_mm: width, height_mm: height, two_sided: twoSided }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setBusy(false);
      setError(data.error ?? "La création a échoué.");
      return;
    }
    router.push(`/cartes-etudiantes/${data.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">École</label>
        <input
          autoFocus
          list="student-card-schools"
          value={school}
          maxLength={120}
          onChange={(e) => setSchool(e.target.value)}
          placeholder="Ex. École secondaire Notre-Dame"
          className="mt-1 w-full input"
          required
        />
        <datalist id="student-card-schools">
          {schools.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <div>
        <label className="label">Nom du modèle</label>
        <input
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex. Carte étudiante 2026-2027"
          className="mt-1 w-full input"
          required
        />
      </div>
      <div>
        <span className="label">Format</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {CARD_FORMATS.map((f, i) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setFormat(i)}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                format === i ? "border-pico-maroon bg-pico-maroon text-white" : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={twoSided} onChange={(e) => setTwoSided(e.target.checked)} />
        Recto-verso
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-2 btn-primary disabled:opacity-50"
        >
          {busy && <SpinnerIcon className="h-4 w-4" />}
          Créer et ouvrir le modèle
        </button>
      </div>
    </form>
  );
}

// Module Cartes étudiantes : les modèles, regroupés par école.
export default function StudentCardsList({ templates }: { templates: StudentCardTemplate[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const schools = useMemo(
    () => Array.from(new Set(templates.map((t) => t.school).filter(Boolean))).sort((a, b) => a.localeCompare(b, "fr")),
    [templates]
  );
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const shown = templates.filter((t) => !q || `${t.school} ${t.name}`.toLowerCase().includes(q));
    const map = new Map<string, StudentCardTemplate[]>();
    for (const t of shown) {
      const key = t.school || "Sans école";
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return Array.from(map.entries());
  }, [templates, search]);

  async function remove(t: StudentCardTemplate) {
    if (!confirm(`Supprimer le modèle « ${t.name} » et ses fonds ?`)) return;
    setDeletingId(t.id);
    const res = await fetch(`/api/student-cards/${t.id}`, { method: "DELETE" });
    if (!res.ok) {
      setDeletingId(null);
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "La suppression a échoué.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-page-title font-semibold text-text">
            Cartes étudiantes
            <UpdatingBadge show={isPending} />
          </h1>
          <p className="text-sm text-neutral-500">
            Un modèle par école : on dépose la liste des élèves (Excel ou CSV) et leurs photos, les cartes sortent prêtes pour
            l&apos;imprimante à cartes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="shrink-0 btn-primary"
        >
          Nouveau modèle
        </button>
      </div>

      {templates.length > 0 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (école, modèle)..."
          className="mb-4 w-full input sm:max-w-xs"
        />
      )}

      {templates.length === 0 ? (
        <p className="card p-6 text-center text-sm text-neutral-500">
          Aucun modèle pour l&apos;instant. Créez-en un pour une école, ajoutez le fond de la carte, puis dessinez les
          zones : textes, photo et code-barres.
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map(([school, items]) => (
            <section key={school}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{school}</h2>
              <ul className="divide-y divide-neutral-100 card">
                {items.map((t) => {
                  const missing = [!t.front_path && "fond du recto", t.two_sided && !t.back_path && "fond du verso", t.zones.length === 0 && "zones"]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <li
                      key={t.id}
                      className={`flex items-center justify-between gap-3 px-4 py-3 ${deletingId === t.id ? "opacity-40" : ""}`}
                    >
                      <Link href={`/cartes-etudiantes/${t.id}`} className="shrink-0" tabIndex={-1}>
                        <CardThumbnail template={t} />
                      </Link>
                      <Link href={`/cartes-etudiantes/${t.id}`} className="min-w-0 flex-1">
                        <p className="truncate font-medium text-text hover:underline">{t.name}</p>
                        <p className="text-xs text-neutral-500">
                          {formatLabel(t.width_mm, t.height_mm)} · {t.two_sided ? "recto-verso" : "recto"} · {t.zones.length}{" "}
                          zone{t.zones.length > 1 ? "s" : ""}
                          {missing && <span className="text-warning-strong"> · à compléter : {missing}</span>}
                        </p>
                      </Link>
                      <div className="flex shrink-0 items-center gap-1">
                        <Link
                          href={`/cartes-etudiantes/${t.id}`}
                          title="Ouvrir"
                          aria-label="Ouvrir"
                          className="icon-btn"
                        >
                          <FilePenIcon className="h-4 w-4" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => remove(t)}
                          disabled={deletingId === t.id}
                          title="Supprimer"
                          aria-label="Supprimer"
                          className="rounded-lg p-1.5 text-neutral-500 hover:bg-danger-subtle hover:text-danger disabled:opacity-50"
                        >
                          {deletingId === t.id ? <SpinnerIcon className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {groups.length === 0 && <p className="text-sm text-neutral-500">Aucun modèle ne correspond.</p>}
        </div>
      )}

      {creating && (
        <Modal title="Nouveau modèle de carte étudiante" onClose={() => setCreating(false)}>
          <NewCardForm schools={schools} onCancel={() => setCreating(false)} />
        </Modal>
      )}
    </div>
  );
}
