"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

/**
 * Pagination d'une liste : « 101–200 sur 340 » et les boutons de page. Rien
 * ne s'affiche quand tout tient sur une page.
 */
export default function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) return null;

  // Première, dernière, et les pages autour de la courante ; « … » entre.
  const pages: (number | "gap")[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== "gap") pages.push("gap");
  }

  const button = "flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm";
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Pagination">
      <span className="text-neutral-500">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page === 1}
          aria-label="Page précédente"
          className={`${button} text-neutral-600 hover:bg-neutral-100 disabled:opacity-40`}
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        {pages.map((p, i) =>
          p === "gap" ? (
            <span key={`gap-${i}`} className="px-1 text-neutral-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              aria-current={p === page ? "page" : undefined}
              className={`${button} ${
                p === page ? "bg-pico-maroon font-medium text-white" : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page === pageCount}
          aria-label="Page suivante"
          className={`${button} text-neutral-600 hover:bg-neutral-100 disabled:opacity-40`}
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
