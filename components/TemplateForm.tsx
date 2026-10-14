"use client";

import { useEffect, useState } from "react";
import type { Category, LogoHAlign, LogoVAlign, Sku, Template } from "@/lib/types";
import { inToMm, mmToIn } from "@/lib/pdf/units";
import { SpinnerIcon } from "@/components/icons";
import SkuPicker from "@/components/SkuPicker";
import { FOLD_TYPES, foldAxisLength, foldPanels, parseFold, type FoldConfig, type FoldDirection, type FoldType } from "@/lib/folds";

type Unit = "mm" | "in";

const H_ALIGNS: { value: LogoHAlign; label: string }[] = [
  { value: "left", label: "Gauche" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Droite" },
];

const V_ALIGNS: { value: LogoVAlign; label: string }[] = [
  { value: "top", label: "Haut" },
  { value: "bottom", label: "Bas" },
];

export default function TemplateForm({
  template,
  categories,
  skus,
  currentOverlayUrl,
  onSuccess,
  onBusyChange,
}: {
  template?: Template;
  categories: Category[];
  skus: Sku[];
  currentOverlayUrl?: string | null;
  onSuccess: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const isEditing = Boolean(template);
  const [form, setForm] = useState({
    name: template?.name ?? "",
    category_id: template?.category_id ?? categories[0]?.id ?? "",
    sku_id: template?.sku_id ?? "",
    width_mm: template?.width_mm ?? 90,
    height_mm: template?.height_mm ?? 50,
    bleed_mm: template?.bleed_mm ?? 3.175,
    safety_margin_x_mm: template?.safety_margin_x_mm ?? 3.175,
    safety_margin_y_mm: template?.safety_margin_y_mm ?? 3.175,
    print_margin_x_mm: template?.print_margin_x_mm ?? 0,
    print_margin_y_mm: template?.print_margin_y_mm ?? 0,
    dpi: template?.dpi ?? 300,
    logo_h_align: template?.logo_h_align ?? ("right" as LogoHAlign),
    logo_v_align: template?.logo_v_align ?? ("bottom" as LogoVAlign),
    logo_width_mm: template?.logo_width_mm ?? 20,
    logo_margin_x_mm: template?.logo_margin_x_mm ?? 5,
    logo_margin_y_mm: template?.logo_margin_y_mm ?? 5,
    two_sided: template?.two_sided ?? false,
    logo_on_front: template?.logo_on_front ?? true,
    logo_on_back: template?.logo_on_back ?? false,
    allow_orientation_change: template?.allow_orientation_change ?? false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unit, setUnit] = useState<Unit>("in");

  useEffect(() => {
    onBusyChange?.(loading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
  const [overlayFile, setOverlayFile] = useState<File | null>(null);
  const [overlayPreview, setOverlayPreview] = useState<string | null>(null);
  const [removeOverlay, setRemoveOverlay] = useState(false);
  // Marques de pli (aperçu écran seulement, voir generateTemplatePreviewPng)
  // — distances en mm depuis le bord de coupe, une par pli, position
  // réglable individuellement (pas de répartition automatique).
  const [foldMarksVertical, setFoldMarksVertical] = useState<number[]>(
    template?.fold_marks_vertical_mm ?? []
  );
  const [foldMarksHorizontal, setFoldMarksHorizontal] = useState<number[]>(
    template?.fold_marks_horizontal_mm ?? []
  );
  // Produit plié (dépliant, carte) : ses volets se calculent (voir lib/folds.ts).
  const [fold, setFold] = useState<FoldConfig | null>(parseFold(template?.fold));

  function handleOverlayChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setOverlayFile(f);
    setOverlayPreview(f ? URL.createObjectURL(f) : null);
    if (f) setRemoveOverlay(false);
  }

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Marques de pli : chaque pli a sa propre distance (mm), réglable
  // individuellement — pas de répartition automatique par simple compte.
  function addFold(axis: "vertical" | "horizontal") {
    const setter = axis === "vertical" ? setFoldMarksVertical : setFoldMarksHorizontal;
    // Position de départ raisonnable (milieu de la page) — à ajuster ensuite.
    const defaultMm = (axis === "vertical" ? form.width_mm : form.height_mm) / 2;
    setter((marks) => [...marks, defaultMm]);
  }
  function removeFold(axis: "vertical" | "horizontal", index: number) {
    const setter = axis === "vertical" ? setFoldMarksVertical : setFoldMarksHorizontal;
    setter((marks) => marks.filter((_, i) => i !== index));
  }
  function updateFold(axis: "vertical" | "horizontal", index: number, displayValue: number) {
    const setter = axis === "vertical" ? setFoldMarksVertical : setFoldMarksHorizontal;
    const mm = unit === "mm" ? displayValue : inToMm(displayValue);
    setter((marks) => marks.map((v, i) => (i === index ? mm : v)));
  }

  // Les dimensions sont toujours stockées en mm ; ces helpers ne font que
  // convertir l'affichage/la saisie selon l'unité choisie.
  function toDisplay(mm: number): number {
    if (unit === "mm") return mm;
    return Math.round(mmToIn(mm) * 1000) / 1000;
  }

  function updateFromDisplay(
    key:
      | "width_mm"
      | "height_mm"
      | "bleed_mm"
      | "safety_margin_x_mm"
      | "safety_margin_y_mm"
      | "print_margin_x_mm"
      | "print_margin_y_mm"
      | "logo_width_mm"
      | "logo_margin_x_mm"
      | "logo_margin_y_mm",
    value: number
  ) {
    update(key, unit === "mm" ? value : inToMm(value));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData();
    for (const [key, value] of Object.entries(form)) {
      formData.append(key, String(value));
    }
    if (overlayFile) formData.append("overlay", overlayFile);
    if (removeOverlay) formData.append("removeOverlay", "true");
    // Toujours envoyés (même vides) : un tableau vide efface les marques
    // existantes côté serveur (voir parseFoldMarksField) — les omettre
    // laisserait d'anciennes marques en place après les avoir toutes retirées.
    formData.append("foldMarksVertical", JSON.stringify(foldMarksVertical));
    formData.append("foldMarksHorizontal", JSON.stringify(foldMarksHorizontal));
    formData.append("fold", fold ? JSON.stringify(fold) : "");

    const res = await fetch(isEditing ? `/api/templates/${template!.id}` : "/api/templates", {
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
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium">Nom du produit</label>
        <input
          required
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="Ex. Cartes d'affaires 90×50mm"
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Catégorie</label>
        <select
          value={form.category_id}
          onChange={(e) => update("category_id", e.target.value)}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {categories.length === 0 && (
          <p className="mt-1 text-xs text-amber-700">
            Aucune catégorie disponible — crée-en une d&apos;abord.
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium">SKU</label>
        <SkuPicker value={form.sku_id} onChange={(id) => update("sku_id", id)} skus={skus} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="block text-sm font-medium">Dimensions</label>
          <div className="flex rounded-lg border border-neutral-300 p-0.5 text-xs">
            {(["mm", "in"] as Unit[]).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                className={`rounded-md px-2 py-1 ${
                  unit === u ? "bg-pico-black text-white" : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {u === "mm" ? "mm" : "po"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">Largeur ({unit === "mm" ? "mm" : "po"})</label>
            <input
              type="number"
              step={unit === "mm" ? "0.1" : "0.01"}
              value={toDisplay(form.width_mm)}
              onChange={(e) => updateFromDisplay("width_mm", parseFloat(e.target.value) || 0)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Hauteur ({unit === "mm" ? "mm" : "po"})</label>
            <input
              type="number"
              step={unit === "mm" ? "0.1" : "0.01"}
              value={toDisplay(form.height_mm)}
              onChange={(e) => updateFromDisplay("height_mm", parseFloat(e.target.value) || 0)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">
              Fond perdu / bleed ({unit === "mm" ? "mm" : "po"})
            </label>
            <input
              type="number"
              step={unit === "mm" ? "0.1" : "0.01"}
              value={toDisplay(form.bleed_mm)}
              onChange={(e) => updateFromDisplay("bleed_mm", parseFloat(e.target.value) || 0)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Résolution (dpi)</label>
            <input
              type="number"
              value={form.dpi}
              onChange={(e) => update("dpi", parseInt(e.target.value, 10))}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">
              Marge de protection horizontale ({unit === "mm" ? "mm" : "po"})
            </label>
            <input
              type="number"
              step={unit === "mm" ? "0.1" : "0.01"}
              value={toDisplay(form.safety_margin_x_mm)}
              onChange={(e) =>
                updateFromDisplay("safety_margin_x_mm", parseFloat(e.target.value) || 0)
              }
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">
              Marge de protection verticale ({unit === "mm" ? "mm" : "po"})
            </label>
            <input
              type="number"
              step={unit === "mm" ? "0.1" : "0.01"}
              value={toDisplay(form.safety_margin_y_mm)}
              onChange={(e) =>
                updateFromDisplay("safety_margin_y_mm", parseFloat(e.target.value) || 0)
              }
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">
              Marge d&apos;impression horizontale ({unit === "mm" ? "mm" : "po"})
            </label>
            <input
              type="number"
              step={unit === "mm" ? "0.1" : "0.01"}
              value={toDisplay(form.print_margin_x_mm)}
              onChange={(e) =>
                updateFromDisplay("print_margin_x_mm", parseFloat(e.target.value) || 0)
              }
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">
              Marge d&apos;impression verticale ({unit === "mm" ? "mm" : "po"})
            </label>
            <input
              type="number"
              step={unit === "mm" ? "0.1" : "0.01"}
              value={toDisplay(form.print_margin_y_mm)}
              onChange={(e) =>
                updateFromDisplay("print_margin_y_mm", parseFloat(e.target.value) || 0)
              }
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Agrandit la page du PDF final d&apos;une bande blanche en plus (l&apos;image
              imprimée garde sa taille normale) — distinct de la marge de protection, qui reste
              un simple guide à l&apos;écran.
            </p>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-pico-black">
          <input
            type="checkbox"
            checked={form.allow_orientation_change}
            onChange={(e) => update("allow_orientation_change", e.target.checked)}
          />
          Permettre de basculer les produits en portrait/paysage
        </label>
        {!form.allow_orientation_change && (
          <p className="mt-1 text-xs text-neutral-500">
            Le bouton d&apos;orientation sera masqué dans le formulaire produit pour ce modèle.
          </p>
        )}
      </div>

      <FoldSection
        fold={fold}
        widthMm={form.width_mm}
        heightMm={form.height_mm}
        unit={unit}
        onChange={(next) => {
          setFold(next);
          // Un produit plié s'imprime des deux côtés (l'extérieur et l'intérieur).
          if (next) update("two_sided", true);
        }}
      />

      {!fold && (
      <div>
        <label className="block text-sm font-medium">Marques de pli</label>
        <p className="mt-1 text-xs text-neutral-500">
          Repères affichés dans l&apos;aperçu pour indiquer où le produit sera plié — jamais
          imprimés sur le PDF final. Chaque pli a sa propre distance depuis le bord de coupe.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Plis verticaux
            </p>
            {foldMarksVertical.map((mm, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs text-neutral-500">Pli {i + 1}</span>
                <input
                  type="number"
                  step={unit === "mm" ? "0.1" : "0.01"}
                  value={toDisplay(mm)}
                  onChange={(e) => updateFold("vertical", i, parseFloat(e.target.value) || 0)}
                  aria-label={`Distance du pli vertical ${i + 1} depuis le bord gauche`}
                  className="w-full min-w-0 rounded border border-neutral-300 px-3 py-2 text-sm"
                />
                <span className="shrink-0 text-xs text-neutral-500">{unit === "mm" ? "mm" : "po"}</span>
                <button
                  type="button"
                  onClick={() => removeFold("vertical", i)}
                  className="shrink-0 text-xs text-neutral-500 underline hover:text-pico-black"
                >
                  Retirer
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addFold("vertical")}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
            >
              + Ajouter un pli vertical
            </button>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Plis horizontaux
            </p>
            {foldMarksHorizontal.map((mm, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs text-neutral-500">Pli {i + 1}</span>
                <input
                  type="number"
                  step={unit === "mm" ? "0.1" : "0.01"}
                  value={toDisplay(mm)}
                  onChange={(e) => updateFold("horizontal", i, parseFloat(e.target.value) || 0)}
                  aria-label={`Distance du pli horizontal ${i + 1} depuis le bord du haut`}
                  className="w-full min-w-0 rounded border border-neutral-300 px-3 py-2 text-sm"
                />
                <span className="shrink-0 text-xs text-neutral-500">{unit === "mm" ? "mm" : "po"}</span>
                <button
                  type="button"
                  onClick={() => removeFold("horizontal", i)}
                  className="shrink-0 text-xs text-neutral-500 underline hover:text-pico-black"
                >
                  Retirer
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addFold("horizontal")}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
            >
              + Ajouter un pli horizontal
            </button>
          </div>
        </div>
      </div>
      )}

      <div>
        <label className="mb-2 block text-sm font-medium">Impression</label>
        <div className="flex rounded-lg border border-neutral-300 p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, two_sided: false, logo_on_back: false }))}
            className={`flex-1 rounded-md px-2 py-1.5 ${
              !form.two_sided ? "bg-pico-black text-white" : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            Recto
          </button>
          <button
            type="button"
            onClick={() => update("two_sided", true)}
            className={`flex-1 rounded-md px-2 py-1.5 ${
              form.two_sided ? "bg-pico-black text-white" : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            Recto-verso
          </button>
        </div>
        {form.two_sided && (
          <p className="mt-1 text-xs text-neutral-500">
            Les produits basés sur ce modèle pourront configurer une image de verso, ajoutée comme
            deuxième page du PDF.
          </p>
        )}
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">Logo Pico</label>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-pico-black">
            <input
              type="checkbox"
              checked={form.logo_on_front}
              onChange={(e) => update("logo_on_front", e.target.checked)}
            />
            Sur le recto
          </label>
          {form.two_sided && (
            <label className="flex items-center gap-2 text-sm text-pico-black">
              <input
                type="checkbox"
                checked={form.logo_on_back}
                onChange={(e) => update("logo_on_back", e.target.checked)}
              />
              Sur le verso
            </label>
          )}
        </div>
        {!form.logo_on_front && !form.logo_on_back && (
          <p className="mt-1 text-xs text-neutral-500">
            Les produits basés sur ce modèle n&apos;auront pas de logo Pico.
          </p>
        )}
      </div>

      {(form.logo_on_front || form.logo_on_back) && (
        <div>
          <label className="mb-2 block text-sm font-medium">Position du logo</label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-neutral-500">Alignement horizontal</label>
              <div className="mt-1 flex rounded-lg border border-neutral-300 p-0.5 text-sm">
                {H_ALIGNS.map((h) => (
                  <button
                    key={h.value}
                    type="button"
                    onClick={() => update("logo_h_align", h.value)}
                    className={`flex-1 rounded-md px-2 py-1.5 ${
                      form.logo_h_align === h.value
                        ? "bg-pico-black text-white"
                        : "text-neutral-600 hover:bg-neutral-100"
                    }`}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-neutral-500">Alignement vertical</label>
              <div className="mt-1 flex rounded-lg border border-neutral-300 p-0.5 text-sm">
                {V_ALIGNS.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => update("logo_v_align", v.value)}
                    className={`flex-1 rounded-md px-2 py-1.5 ${
                      form.logo_v_align === v.value
                        ? "bg-pico-black text-white"
                        : "text-neutral-600 hover:bg-neutral-100"
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium">Largeur logo ({unit === "mm" ? "mm" : "po"})</label>
              <input
                type="number"
                step={unit === "mm" ? "0.1" : "0.01"}
                value={toDisplay(form.logo_width_mm)}
                onChange={(e) => updateFromDisplay("logo_width_mm", parseFloat(e.target.value) || 0)}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Marge côtés ({unit === "mm" ? "mm" : "po"})</label>
              <input
                type="number"
                step={unit === "mm" ? "0.1" : "0.01"}
                value={toDisplay(form.logo_margin_x_mm)}
                onChange={(e) => updateFromDisplay("logo_margin_x_mm", parseFloat(e.target.value) || 0)}
                disabled={form.logo_h_align === "center"}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 disabled:bg-neutral-100 disabled:text-neutral-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Marge hauteur ({unit === "mm" ? "mm" : "po"})</label>
              <input
                type="number"
                step={unit === "mm" ? "0.1" : "0.01"}
                value={toDisplay(form.logo_margin_y_mm)}
                onChange={(e) => updateFromDisplay("logo_margin_y_mm", parseFloat(e.target.value) || 0)}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
              />
            </div>
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium">
          Gabarit de guidage (ex. position des caméras) — optionnel
        </label>
        <p className="mt-1 text-xs text-neutral-500">
          Affiché uniquement dans les aperçus, jamais inclus dans le PDF imprimé.
        </p>
        <input
          type="file"
          accept="image/svg+xml,image/png,image/jpeg"
          onChange={handleOverlayChange}
          className="mt-2 w-full text-sm"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {overlayPreview ? (
          <img src={overlayPreview} alt="Aperçu du gabarit" className="mt-3 max-h-48 rounded border" />
        ) : !removeOverlay && currentOverlayUrl ? (
          <div className="mt-3">
            <img src={currentOverlayUrl} alt="Gabarit actuel" className="max-h-48 rounded border" />
            <button
              type="button"
              onClick={() => setRemoveOverlay(true)}
              className="mt-2 text-sm text-red-600 hover:underline"
            >
              Retirer le gabarit
            </button>
          </div>
        ) : null}
      </div>

      {/* Les mockups ne se configurent plus ici : un modèle peut en avoir
          plusieurs (voir TemplateMockupsManager et
          supabase/migrations/0049_template_mockups.sql), ce qui se prête mal
          à ce formulaire envoyé d'un seul bloc. */}
      <p className="rounded-xl border border-border bg-surface-muted p-3 text-xs text-text-muted">
        Mockups : gérés séparément — bouton « Mockups » sur la ligne du modèle, dans la liste. Un modèle peut en avoir
        plusieurs (le même produit sous différents angles).
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg bg-pico-maroon px-4 py-2 text-white hover:bg-pico-maroon-dark disabled:opacity-50"
      >
        {loading && <SpinnerIcon className="h-4 w-4" />}
        {loading ? "Enregistrement..." : isEditing ? "Enregistrer" : "Créer le modèle"}
      </button>
    </form>
  );
}

// Produit plié : type de pli, direction, volets et zone de sécurité ; les
// volets calculés s'affichent au recto (extérieur) et au verso (intérieur).
function FoldSection({
  fold,
  widthMm,
  heightMm,
  unit,
  onChange,
}: {
  fold: FoldConfig | null;
  widthMm: number;
  heightMm: number;
  unit: Unit;
  onChange: (fold: FoldConfig | null) => void;
}) {
  const fmt = (mm: number) => (unit === "mm" ? `${Math.round(mm * 10) / 10} mm` : `${Math.round(mmToIn(mm) * 1000) / 1000} po`);
  const set = (patch: Partial<FoldConfig>) => onChange(parseFold({ ...(fold ?? {}), ...patch }));
  const length = fold ? foldAxisLength(fold, widthMm, heightMm) : 0;

  return (
    <div>
      <label className="block text-sm font-medium">Produit plié</label>
      <p className="mt-1 text-xs text-neutral-500">
        Dépliant ou carte pliée : l&apos;outil montre les plis, le nom de chaque volet et une zone de sécurité autour des
        plis — jamais imprimés.
      </p>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <select
          value={fold?.type ?? ""}
          onChange={(e) => (e.target.value ? set({ type: e.target.value as FoldType }) : onChange(null))}
          className="rounded border border-neutral-300 px-3 py-2 text-sm sm:col-span-2"
          aria-label="Type de pli"
        >
          <option value="">Aucun pli (à plat)</option>
          {FOLD_TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        {fold && (
          <select
            value={fold.direction}
            onChange={(e) => set({ direction: e.target.value as FoldDirection })}
            className="rounded border border-neutral-300 px-3 py-2 text-sm"
            aria-label="Direction des plis"
          >
            <option value="vertical">Plis verticaux (volets côte à côte)</option>
            <option value="horizontal">Plis horizontaux (volets empilés)</option>
          </select>
        )}
        {fold?.type === "accordion" && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="number"
              min={3}
              max={8}
              value={fold.panels}
              onChange={(e) => set({ panels: Number(e.target.value) })}
              className="w-16 rounded border border-neutral-300 px-2 py-2"
            />
            volets
          </label>
        )}
      </div>
      {fold && (
        <>
          <label className="mt-3 flex items-center gap-2 text-sm">
            Zone de sécurité de chaque côté d&apos;un pli :
            <input
              type="number"
              step={unit === "mm" ? "0.1" : "0.01"}
              min={0}
              value={unit === "mm" ? fold.safetyMm : Math.round(mmToIn(fold.safetyMm) * 1000) / 1000}
              onChange={(e) => set({ safetyMm: unit === "mm" ? Number(e.target.value) : inToMm(Number(e.target.value)) })}
              className="w-24 rounded border border-neutral-300 px-2 py-1.5"
            />
            {unit === "mm" ? "mm" : "po"}
          </label>
          <div className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
            {(["front", "back"] as const).map((side) => (
              <div key={side} className="rounded-lg bg-neutral-50 p-3">
                <p className="mb-1 font-semibold uppercase tracking-wide text-neutral-500">
                  {side === "front" ? "Recto (extérieur)" : "Verso (intérieur)"}
                </p>
                <ol className="space-y-0.5">
                  {foldPanels(fold, length, side).map((p, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>{p.label}</span>
                      <span className="text-neutral-500">{fmt(p.size)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          {fold.type === "roll" && (
            <p className="mt-2 text-xs text-neutral-500">
              Le volet rabattu est plus étroit de 1/16 po, pour bien rentrer à l&apos;intérieur.
            </p>
          )}
        </>
      )}
    </div>
  );
}
