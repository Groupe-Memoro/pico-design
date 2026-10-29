"use client";

import { ChevronLeftIcon, ChevronRightIcon, ExpandIcon, SpinnerIcon } from "@/components/icons";

export interface MockupView {
  // Clé stable (id de mockup, ou "front"/"back" pour les modèles sans bundle).
  key: string;
  label: string;
  loading: boolean;
  url: string | null;
}

/**
 * Affiche les mockups d'un design : un seul en grand à la fois, avec des
 * vignettes (et des flèches) pour passer de l'un à l'autre dès qu'il y en a
 * plusieurs — un modèle peut avoir plusieurs mockups (le même produit sous
 * plusieurs angles, voir supabase/migrations/0049_template_mockups.sql), et
 * la papeterie a son recto/verso.
 *
 * Avec une seule vue, ni vignettes ni flèches : l'affichage est alors
 * exactement celui d'avant.
 */
export default function MockupGallery({
  views,
  activeKey,
  onActiveKeyChange,
  onZoom,
  imageMaxHeight = "55vh",
}: {
  views: MockupView[];
  activeKey: string;
  onActiveKeyChange: (key: string) => void;
  // Absent = pas de vue agrandie au clic.
  onZoom?: (view: MockupView) => void;
  // Hauteur maximale du mockup affiché (valeur CSS) : l'aperçu final de
  // l'Outil Shopify lui donne toute la hauteur libre de l'écran.
  imageMaxHeight?: string;
}) {
  if (views.length === 0) return null;

  const activeIndex = Math.max(
    0,
    views.findIndex((v) => v.key === activeKey)
  );
  const active = views[activeIndex];
  const many = views.length > 1;

  function go(delta: number) {
    const next = (activeIndex + delta + views.length) % views.length;
    onActiveKeyChange(views[next].key);
  }

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center gap-2">
        {many && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Mockup précédent"
            className="shrink-0 rounded-full border border-border p-2 text-text-muted hover:bg-surface-muted"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
        )}

        <figure className="min-w-0 flex-1">
          <figcaption className="mb-1 text-center text-sm font-medium text-text">{active.label}</figcaption>
          {active.loading ? (
            <div className="flex aspect-square items-center justify-center rounded-2xl border border-border bg-surface-muted p-8 text-text-muted">
              <SpinnerIcon className="h-5 w-5" />
            </div>
          ) : active.url ? (
            <button
              type="button"
              onClick={() => onZoom?.(active)}
              disabled={!onZoom}
              aria-label={onZoom ? `Agrandir « ${active.label} »` : undefined}
              className={`group relative mx-auto block ${onZoom ? "cursor-zoom-in" : "cursor-default"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={active.url}
                alt={active.label}
                className="mx-auto w-auto max-w-full rounded-2xl border border-border bg-surface-muted shadow-sm"
                style={{ maxHeight: imageMaxHeight }}
              />
              {onZoom && (
                <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <ExpandIcon className="h-3.5 w-3.5" />
                  Agrandir
                </span>
              )}
            </button>
          ) : (
            <p className="rounded-2xl border border-border bg-surface-muted p-8 text-center text-sm text-text-subtle">
              Aperçu indisponible.
            </p>
          )}
        </figure>

        {many && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Mockup suivant"
            className="shrink-0 rounded-full border border-border p-2 text-text-muted hover:bg-surface-muted"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {many && (
        <div className="flex flex-wrap justify-center gap-2">
          {views.map((view) => (
            <button
              key={view.key}
              type="button"
              onClick={() => onActiveKeyChange(view.key)}
              aria-current={view.key === active.key}
              className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border ${
                view.key === active.key ? "border-primary" : "border-border hover:border-border-strong"
              }`}
              title={view.label}
            >
              {view.loading ? (
                <SpinnerIcon className="h-4 w-4 text-text-subtle" />
              ) : view.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={view.url} alt={view.label} loading="lazy" decoding="async" className="h-full w-full object-cover" />
              ) : (
                <span className="px-1 text-[10px] leading-tight text-text-subtle">—</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
