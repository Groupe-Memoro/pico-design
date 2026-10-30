"use client";

import { useState, useSyncExternalStore } from "react";
import { mmToIn, MM_TO_PT } from "@/lib/pdf/units";
import type { Unit } from "@/components/MeasureField";

export type FontUnit = "pt" | "mm";

// Trois décimales au plus, sans zéros inutiles : 1/8 po s'affiche 0.125
// (pas 0.13), 3.5 reste 3.5 (pas 3.500).
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Préférence d'unité partagée par tous les champs de l'outil et gardée d'une
// visite à l'autre (localStorage) : changer d'unité à un endroit la change
// partout. Côté serveur et au premier rendu, la valeur par défaut.
function createPreference<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  const listeners = new Set<() => void>();
  function read(): T {
    try {
      const v = localStorage.getItem(key) as T | null;
      return v && allowed.includes(v) ? v : fallback;
    } catch {
      return fallback;
    }
  }
  function subscribe(cb: () => void) {
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => e.key === key && cb();
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  }
  function write(v: T) {
    try {
      localStorage.setItem(key, v);
    } catch {
      // Stockage bloqué (navigation privée) : le choix vaut pour la page.
    }
    listeners.forEach((cb) => cb());
  }
  return function usePreference(): [T, (v: T) => void] {
    return [useSyncExternalStore(subscribe, read, () => fallback), write];
  };
}

// « -v2 » : les pouces sont devenus la règle partout ; les choix faits avant
// sont ignorés une fois, pour que tout le monde reparte en pouces.
export const useLengthUnit = createPreference<Unit>("pico-length-unit-v2", "in", ["in", "mm"]);
export const useFontUnit = createPreference<FontUnit>("pico-font-unit", "pt", ["pt", "mm"]);

export const unitLabel = (unit: Unit | FontUnit) => (unit === "in" ? "po" : unit);

// Longueur stockée en mm, affichée dans l'unité choisie (ex. « 2.125 po »).
export function formatLength(mm: number, unit: Unit): string {
  const v = unit === "mm" ? round3(mm) : round3(mmToIn(mm));
  return `${String(v).replace(".", ",")} ${unitLabel(unit)}`;
}

function Segmented<T extends Unit | FontUnit>({
  value,
  options,
  onChange,
  title,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  title: string;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-neutral-300 text-xs" role="group" aria-label={title} title={title}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          aria-pressed={value === o}
          className={`px-2.5 py-1 ${value === o ? "bg-pico-maroon text-white" : "bg-surface text-neutral-600 hover:bg-neutral-50"}`}
        >
          {unitLabel(o)}
        </button>
      ))}
    </div>
  );
}

export function LengthUnitToggle() {
  const [unit, setUnit] = useLengthUnit();
  return <Segmented value={unit} options={["in", "mm"] as const} onChange={setUnit} title="Unité des mesures" />;
}

export function FontUnitToggle() {
  const [unit, setUnit] = useFontUnit();
  return <Segmented value={unit} options={["pt", "mm"] as const} onChange={setUnit} title="Unité des tailles de police" />;
}

// Barre « Mesures po | mm · Police pt | mm » au-dessus d'un groupe de champs.
export function UnitsBar({ font = false }: { font?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
      <span className="flex items-center gap-1.5">
        Mesures <LengthUnitToggle />
      </span>
      {font && (
        <span className="flex items-center gap-1.5">
          Police <FontUnitToggle />
        </span>
      )}
    </div>
  );
}

// Champ numérique converti : la valeur reste en mm chez le parent. Pendant la
// saisie, le texte tapé est gardé tel quel (pas de reformatage sous le
// curseur) ; il redevient la valeur arrondie à 3 décimales en quittant le champ.
function ConvertedInput({
  valueMm,
  onChange,
  factor,
  minMm,
  maxMm,
  className,
  ariaLabel,
  required,
}: {
  valueMm: number;
  onChange: (mm: number) => void;
  // Unités affichées par mm.
  factor: number;
  minMm?: number;
  maxMm?: number;
  className?: string;
  ariaLabel?: string;
  required?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = String(round3(valueMm * factor));
  return (
    <input
      type="number"
      step="any"
      min={minMm !== undefined ? round3(minMm * factor) : undefined}
      max={maxMm !== undefined ? round3(maxMm * factor) : undefined}
      value={draft ?? shown}
      required={required}
      aria-label={ariaLabel}
      onFocus={() => setDraft(shown)}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parseFloat(e.target.value);
        if (!Number.isFinite(n)) return;
        let mm = n / factor;
        if (minMm !== undefined) mm = Math.max(minMm, mm);
        if (maxMm !== undefined) mm = Math.min(maxMm, mm);
        onChange(mm);
      }}
      className={className}
    />
  );
}

type FieldProps = {
  valueMm: number;
  onChange: (mm: number) => void;
  minMm?: number;
  maxMm?: number;
  className?: string;
  ariaLabel?: string;
  required?: boolean;
};

// Longueur (position, dimension, marge…) en po ou en mm selon la préférence.
export function LengthInput(props: FieldProps) {
  const [unit] = useLengthUnit();
  return <ConvertedInput {...props} factor={unit === "mm" ? 1 : mmToIn(1)} />;
}

// Taille de police en pt ou en mm selon la préférence (1 pt = 1/72 po).
export function FontSizeInput(props: FieldProps) {
  const [unit] = useFontUnit();
  return <ConvertedInput {...props} factor={unit === "mm" ? 1 : MM_TO_PT} />;
}

// Taille de police en texte (ex. « 12 pt »), pour les affichages.
export function formatFontSize(mm: number, unit: FontUnit, decimals = 3): string {
  const f = 10 ** decimals;
  const v = Math.round((unit === "mm" ? mm : mm * MM_TO_PT) * f) / f;
  return `${String(v).replace(".", ",")} ${unit}`;
}
