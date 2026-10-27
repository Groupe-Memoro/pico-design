"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Sku } from "@/lib/types";

export default function SkuPicker({
  value,
  onChange,
  skus,
}: {
  value: string;
  onChange: (skuId: string) => void;
  skus: Sku[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => skus.find((s) => s.id === value) ?? null, [skus, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skus;
    return skus.filter(
      (s) => s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [skus, query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function select(skuId: string) {
    onChange(skuId);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        value={open ? query : selected ? `${selected.sku} — ${selected.name}` : ""}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        placeholder="— Aucun — (rechercher un SKU ou un nom...)"
        className="mt-1 w-full input"
      />
      {open && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-surface shadow-lg">
          <button
            type="button"
            onClick={() => select("")}
            className="block w-full px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-50"
          >
            — Aucun —
          </button>
          {filtered.length === 0 && (
            <p className="px-3 py-2 text-sm text-neutral-400">Aucun SKU ne correspond.</p>
          )}
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => select(s.id)}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 ${
                s.id === value ? "bg-primary-subtle" : ""
              }`}
            >
              <span className="font-mono text-xs text-neutral-500">{s.sku}</span>
              <span className="ml-2 text-text">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
