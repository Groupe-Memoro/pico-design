"use client";

import { useState } from "react";
import { inToMm, mmToIn } from "@/lib/pdf/units";

export type Unit = "mm" | "in";

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function toDisplayValue(mm: number, unit: Unit): number {
  return unit === "mm" ? round(mm, 2) : round(mmToIn(mm), 3);
}

export function UnitToggle({ unit, onChange }: { unit: Unit; onChange: (unit: Unit) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-neutral-300 text-xs">
      {(["in", "mm"] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          className={`px-2.5 py-1 ${unit === u ? "bg-pico-maroon text-white" : "bg-surface text-neutral-600 hover:bg-neutral-50"}`}
        >
          {u === "in" ? "po" : "mm"}
        </button>
      ))}
    </div>
  );
}

// Champ de dimension : la valeur est toujours stockée en mm par le parent, et
// seulement affichée/saisie dans l'unité choisie. Le texte saisi est gardé
// localement pour ne pas être reformaté pendant la frappe ; le parent doit
// donc lui donner une `key` qui change avec l'unité pour le réinitialiser.
export default function MeasureField({
  label,
  valueMm,
  unit,
  onChange,
  allowNegative,
}: {
  label: string;
  valueMm: number;
  unit: Unit;
  onChange: (mm: number) => void;
  allowNegative?: boolean;
}) {
  const [text, setText] = useState(String(toDisplayValue(valueMm, unit)));
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        step="any"
        min={allowNegative ? undefined : 0}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(unit === "mm" ? n : inToMm(n));
        }}
        className="mt-1 w-full input"
      />
    </div>
  );
}
