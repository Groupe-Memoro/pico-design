"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import SearchSelect from "@/components/SearchSelect";
import UpdatingBadge from "@/components/UpdatingBadge";
import { FilePenIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { templateLabel } from "@/lib/templateLabel";
import type { CardZone } from "@/lib/studentCards/types";
import type { Category, Template } from "@/lib/types";

export interface DataTemplateListItem {
  id: string;
  name: string;
  template_id: string;
  two_sided: boolean;
  front_path: string | null;
  back_path: string | null;
  zones: CardZone[];
}

const labelOf = (t: Template) =>
  templateLabel(t.name, t.two_sided, { widthMm: Number(t.width_mm), heightMm: Number(t.height_mm) });

// Nouveau gabarit : un nom et le modèle dont il reprend le format.
function NewDataTemplateForm({
  templates,
  categories,
  onCancel,
}: {
  templates: Template[];
  categories: Category[];
  onCancel: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const order = new Map(categories.map((c, i) => [c.id, i]));
  const options = [...templates]
    .sort((a, b) => (order.get(a.category_id) ?? 99) - (order.get(b.category_id) ?? 99) || a.name.localeCompare(b.name, "fr"))
    .map((t) => ({ value: t.id, label: labelOf(t), group: categoryName.get(t.category_id) ?? "Autres" }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId) return setError("Choisissez un modèle.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/data-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, template_id: templateId }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setBusy(false);
      setError(data.error ?? "La création a échoué.");
      return;
    }
    router.push(`/donnees-variables/${data.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-500">Modèle</label>
        <SearchSelect
          options={options}
          value={templateId}
          onChange={(id) => {
            setTemplateId(id);
            const t = templates.find((tt) => tt.id === id);
            if (t && !name.trim()) setName(t.name);
          }}
          placeholder="Rechercher un modèle…"
          ariaLabel="Modèle"
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-neutral-500">Le gabarit reprend son format et son fond perdu.</p>
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-500">Nom du gabarit</label>
        <input
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex. Cartes de remerciement — mariage Tremblay"
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          required
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-pico-maroon px-4 py-2 text-sm font-medium text-white hover:bg-pico-maroon-dark disabled:opacity-50"
        >
          {busy && <SpinnerIcon className="h-4 w-4" />}
          Créer et ouvrir le gabarit
        </button>
      </div>
    </form>
  );
}

// Les gabarits à données variables, avec le modèle de chacun.
export default function DataTemplatesList({
  items,
  templates,
  categories,
}: {
  items: DataTemplateListItem[];
  templates: Template[];
  categories: Category[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const templateById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const shown = items.filter((d) => {
    const q = search.trim().toLowerCase();
    return !q || `${d.name} ${templateById.get(d.template_id)?.name ?? ""}`.toLowerCase().includes(q);
  });

  async function remove(d: DataTemplateListItem) {
    if (!confirm(`Supprimer le gabarit « ${d.name} » et ses fonds ?`)) return;
    setDeletingId(d.id);
    const res = await fetch(`/api/data-templates/${d.id}`, { method: "DELETE" });
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
          <h1 className="flex items-center gap-2 text-page-title font-semibold text-pico-black">
            Données variables
            <UpdatingBadge show={isPending} />
          </h1>
          <p className="text-sm text-neutral-500">
            Des produits bâtis sur un modèle, dont les textes, photos et codes-barres viennent d&apos;un fichier Excel ou
            CSV : une page par ligne, prête à imposer.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-lg bg-pico-maroon px-4 py-2 text-sm font-medium text-white hover:bg-pico-maroon-dark"
        >
          Nouveau gabarit
        </button>
      </div>

      {items.length > 0 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (gabarit, modèle)..."
          className="mb-4 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm sm:max-w-xs"
        />
      )}

      {items.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">
          Aucun gabarit pour l&apos;instant. Créez-en un à partir d&apos;un modèle, ajoutez le fond du graphiste, puis
          dessinez les zones : textes, photo et code-barres.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
          {shown.map((d) => {
            const t = templateById.get(d.template_id);
            const missing = [!d.front_path && "fond du recto", d.two_sided && !d.back_path && "fond du verso", d.zones.length === 0 && "zones"]
              .filter(Boolean)
              .join(", ");
            return (
              <li key={d.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${deletingId === d.id ? "opacity-40" : ""}`}>
                <Link href={`/donnees-variables/${d.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium text-pico-black hover:underline">{d.name}</p>
                  <p className="text-xs text-neutral-500">
                    {t ? labelOf(t) : "Modèle supprimé"} · {d.zones.length} zone{d.zones.length > 1 ? "s" : ""}
                    {missing && <span className="text-amber-700"> · à compléter : {missing}</span>}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    href={`/donnees-variables/${d.id}`}
                    title="Ouvrir"
                    aria-label="Ouvrir"
                    className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-pico-black"
                  >
                    <FilePenIcon className="h-4 w-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(d)}
                    disabled={deletingId === d.id}
                    title="Supprimer"
                    aria-label="Supprimer"
                    className="rounded-lg p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    {deletingId === d.id ? <SpinnerIcon className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
                  </button>
                </div>
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-4 py-3 text-sm text-neutral-500">Aucun gabarit ne correspond.</li>}
        </ul>
      )}

      {creating && (
        <Modal title="Nouveau gabarit à données variables" onClose={() => setCreating(false)}>
          <NewDataTemplateForm templates={templates} categories={categories} onCancel={() => setCreating(false)} />
        </Modal>
      )}
    </div>
  );
}
