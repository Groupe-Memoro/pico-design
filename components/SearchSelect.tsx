"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Liste déroulante avec recherche, pour les longues listes (formats de
 * l'imposition…) : taper filtre les choix sans tenir compte des accents ni des
 * majuscules (le libellé et le groupe sont cherchés) ; flèches et Entrée au
 * clavier. Les groupes restent affichés comme des intertitres.
 */

export interface SearchSelectOption {
  value: string;
  label: string;
  // Intertitre (ex. catégorie) ; les options d'un même groupe se suivent.
  group?: string;
}

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function SearchSelect({
  options,
  value,
  onChange,
  className = "",
  placeholder = "Rechercher…",
  ariaLabel,
}: {
  options: SearchSelectOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? null;

  // Chaque mot tapé doit se retrouver dans le libellé ou le groupe.
  const filtered = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return options;
    return options.filter((o) => {
      const text = normalize(`${o.group ?? ""} ${o.label}`);
      return words.every((w) => text.includes(w));
    });
  }, [options, query]);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, 300);
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 260 && above > below;
      const maxHeight = Math.min(440, up ? above : below);
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

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function openList() {
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function choose(option: SearchSelectOption) {
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) choose(filtered[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openList())}
        className={`flex items-center justify-between gap-2 text-left ${className}`}
      >
        <span className="truncate">{selected?.label ?? "—"}</span>
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
                placeholder={placeholder}
                aria-label={placeholder}
                className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500"
              />
            </div>
            <div ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
              {filtered.length === 0 && <p className="px-3 py-4 text-center text-neutral-500">Aucun résultat.</p>}
              {filtered.map((option, i) => (
                <div key={option.value}>
                  {option.group && option.group !== filtered[i - 1]?.group && (
                    <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{option.group}</p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    data-index={i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(option)}
                    className={`block w-full truncate px-3 py-1.5 text-left ${i === active ? "bg-neutral-100" : ""} ${
                      option.value === value ? "font-semibold" : ""
                    }`}
                  >
                    {option.label}
                  </button>
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
