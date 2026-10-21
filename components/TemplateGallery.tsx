"use client";

import { useState } from "react";
import type { Category, Template } from "@/lib/types";
import { templateSizeLabel } from "@/lib/templateLabel";

/**
 * Écran « Choisir un modèle » de l'Outil Shopify : fusionne les anciennes
 * étapes séparées Catégorie puis Modèle (voir CategoryPicker.tsx/
 * TemplatePicker.tsx, supprimés) en un seul écran — chips de filtre par
 * catégorie (optionnel, « Toutes » par défaut) au-dessus d'une grille de
 * modèles groupés par catégorie. Cliquer une carte sélectionne et entre
 * directement dans l'éditeur (pas de bouton « Continuer » séparé — même
 * principe que les anciennes étapes).
 */
export default function TemplateGallery({
  templates,
  categories,
  onSelect,
}: {
  templates: Template[];
  categories: Category[];
  onSelect: (template: Template, category: Category) => void;
}) {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  const categoriesWithCounts = categories
    .map((category) => ({ category, count: templates.filter((t) => t.category_id === category.id).length }))
    .filter((c) => c.count > 0);

  if (categoriesWithCounts.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-text-muted">
        Aucun modèle disponible pour l&apos;instant.
      </p>
    );
  }

  const visibleCategories = activeCategoryId
    ? categoriesWithCounts.filter((c) => c.category.id === activeCategoryId)
    : categoriesWithCounts;

  function templateCard(t: Template, category: Category) {
    return (
      <button
        key={t.id}
        type="button"
        onClick={() => onSelect(t, category)}
        className="group flex flex-col items-start gap-1 rounded-2xl border border-border bg-surface p-4 text-left shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:border-transparent hover:shadow-lg"
      >
        <span className="font-heading text-base font-semibold text-text group-hover:text-primary">{t.name}</span>
        <span className="text-sm text-text-subtle">
          {templateSizeLabel(t, true, "×")}
        </span>
        {t.two_sided && (
          <span className="mt-1 inline-flex items-center rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary">
            Recto-verso
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-heading text-xl font-semibold text-text">Choisis un modèle</h2>
        <p className="mt-1 text-sm text-text-muted">Sélectionne le produit que tu veux personnaliser.</p>
      </div>

      {/* Chips de filtre — purement une commodité de navigation, la liste ci-
          dessous reste toujours groupée par catégorie (avec ou sans filtre). */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveCategoryId(null)}
          className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
            activeCategoryId === null
              ? "border-primary bg-primary text-text-on-brand"
              : "border-border text-text-muted hover:bg-surface-muted"
          }`}
        >
          Toutes
        </button>
        {categoriesWithCounts.map(({ category }) => (
          <button
            key={category.id}
            type="button"
            onClick={() => setActiveCategoryId(category.id)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
              activeCategoryId === category.id
                ? "border-primary bg-primary text-text-on-brand"
                : "border-border text-text-muted hover:bg-surface-muted"
            }`}
          >
            {category.name}
          </button>
        ))}
      </div>

      <div className="space-y-10">
        {visibleCategories.map(({ category }) => {
          const items = templates.filter((t) => t.category_id === category.id);
          return (
            <div key={category.id} className="space-y-4">
              <h3 className="font-heading text-lg font-semibold text-text">{category.name}</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((t) => templateCard(t, category))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
