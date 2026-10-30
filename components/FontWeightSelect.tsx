"use client";

import { WEIGHT_LABELS, fontOptionById, fontWeight, fontWeights } from "@/lib/design/fonts";

/**
 * Menu des graisses offertes par une police (Thin 100 … Black 900). Renvoie
 * la graisse choisie, et `bold` qui suit (600 et plus = gras) pour que le
 * bouton Gras reste juste.
 */
export default function FontWeightSelect({
  fontId,
  value,
  onChange,
  className,
}: {
  fontId: string;
  value: { bold?: boolean; weight?: number | null };
  onChange: (patch: { weight: number; bold: boolean }) => void;
  className?: string;
}) {
  const font = fontOptionById(fontId);
  const weights = fontWeights(font);
  return (
    <select
      value={fontWeight(font, value)}
      onChange={(e) => {
        const weight = Number(e.target.value);
        onChange({ weight, bold: weight >= 600 });
      }}
      disabled={weights.length < 2}
      aria-label="Graisse"
      title={weights.length < 2 ? "Une seule graisse pour cette police" : "Graisse"}
      className={className}
    >
      {weights.map((w) => (
        <option key={w} value={w}>
          {WEIGHT_LABELS[w] ?? w} ({w})
        </option>
      ))}
    </select>
  );
}
