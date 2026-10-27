"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fontOptionById, fontPickerGroups, type FontOption } from "@/lib/design/fonts";
import { ensureFontCss } from "@/lib/design/fontLoader";

/**
 * Choix d'une police avec recherche : les 25 plus populaires de Google Fonts,
 * puis toutes les autres (voir fontPickerGroups). Taper filtre la liste (sans
 * tenir compte des accents ni des majuscules) ; flèches et Entrée au clavier.
 * Les polices affichées en tête de liste sont montrées dans leur propre style.
 */

// Polices dont on charge l'aperçu : assez pour l'écran visible, pas les 1 200.
const PREVIEW_COUNT = 40;

let cachedGroups: ReturnType<typeof fontPickerGroups> | null = null;
const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function FontPicker({
  value,
  onChange,
  className = "",
  ariaLabel = "Police",
}: {
  value: string;
  onChange: (fontId: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  cachedGroups ??= fontPickerGroups();
  const groups = cachedGroups;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = fontOptionById(value);

  useEffect(() => {
    void ensureFontCss(value);
  }, [value]);

  // Résultats : par groupe sans recherche ; sinon une seule liste, les noms qui
  // commencent par la recherche d'abord.
  const sections = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return groups;
    const all = [...groups[0].options, ...groups[1].options];
    const hits = all.filter((f) => normalize(f.label).includes(q));
    hits.sort((a, b) => Number(!normalize(a.family).startsWith(q)) - Number(!normalize(b.family).startsWith(q)));
    return [{ label: `${hits.length} police${hits.length > 1 ? "s" : ""}`, options: hits }];
  }, [query, groups]);
  const flat = useMemo(() => sections.flatMap((s) => s.options), [sections]);

  // Aperçu dans leur style des premières polices affichées.
  useEffect(() => {
    if (!open) return;
    flat.slice(0, PREVIEW_COUNT).forEach((f) => void ensureFontCss(f.id));
  }, [open, flat]);

  // Liste posée sous le bouton (au-dessus s'il manque de place), en position
  // fixe : une fenêtre ou une barre d'outils qui défile ne la coupe pas.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, 288);
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 260 && above > below;
      const maxHeight = Math.min(420, up ? above : below);
      setPosition({
        left: Math.min(r.left, window.innerWidth - width - 8),
        top: up ? r.top - maxHeight - 4 : r.bottom + 4,
        width,
        maxHeight,
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Clic à côté : fermer.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // L'élément actif reste visible quand on navigue au clavier.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function openPicker() {
    setQuery("");
    const index = groups.flatMap((g) => g.options).findIndex((f) => f.id === value);
    setActive(Math.max(0, index));
    setOpen(true);
  }

  function choose(font: FontOption) {
    onChange(font.id);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[active]) choose(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  let index = -1;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPicker())}
        className={`flex items-center justify-between gap-2 text-left ${className}`}
      >
        <span className="truncate" style={{ fontFamily: `"${selected.family}"` }}>
          {selected.family}
        </span>
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true">
          <path d="M5.25 7.5 10 12.25 14.75 7.5z" />
        </svg>
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[100] flex flex-col overflow-hidden card text-sm text-neutral-900 shadow-xl"
            style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
            onKeyDown={onKeyDown}
          >
            <div className="border-b border-neutral-200 p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="Rechercher une police…"
                aria-label="Rechercher une police"
                className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500"
              />
            </div>
            <div ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
              {flat.length === 0 && <p className="px-3 py-4 text-center text-neutral-500">Aucune police trouvée.</p>}
              {sections.map((section) =>
                section.options.length === 0 ? null : (
                  <div key={section.label}>
                    <p className="sticky top-0 bg-surface px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      {section.label}
                    </p>
                    {section.options.map((font) => {
                      index += 1;
                      const i = index;
                      const isActive = i === active;
                      const category = font.label.match(/\(([^)]+)\)$/)?.[1];
                      return (
                        <button
                          key={font.id}
                          type="button"
                          role="option"
                          aria-selected={font.id === value}
                          data-index={i}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => choose(font)}
                          className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left ${
                            isActive ? "bg-neutral-100" : ""
                          } ${font.id === value ? "font-semibold" : ""}`}
                        >
                          <span className="truncate text-[15px]" style={i < PREVIEW_COUNT ? { fontFamily: `"${font.family}"` } : undefined}>
                            {font.family}
                          </span>
                          {category && <span className="shrink-0 text-[11px] text-neutral-400">{category}</span>}
                        </button>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
