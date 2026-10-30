"use client";

import { useState } from "react";
import { SpinnerIcon } from "@/components/icons";
import { AGENDA_FORMATS, type Agenda, type AgendaSettings } from "@/lib/agendas/types";
import FontPicker from "@/components/FontPicker";
import ColorPickerButton from "@/components/ColorPickerButton";
import { LengthInput, LengthUnitToggle } from "@/components/UnitInputs";

const inputClass = "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm";
const labelClass = "block text-sm font-medium";
const MM_PER_IN = 25.4;

// Réglages de l'agenda : identité, année scolaire, format et style.
export default function AgendaSettingsForm({ agenda, onSaved }: { agenda: Agenda; onSaved: () => void }) {
  const [name, setName] = useState(agenda.name);
  const [school, setSchool] = useState(agenda.school);
  const [yearLabel, setYearLabel] = useState(agenda.year_label);
  const [start, setStart] = useState(agenda.start_date);
  const [end, setEnd] = useState(agenda.end_date);
  const [widthMm, setWidthMm] = useState(Number(agenda.width_mm));
  const [heightMm, setHeightMm] = useState(Number(agenda.height_mm));
  const [bleedMm, setBleedMm] = useState(Number(agenda.bleed_mm));
  const [s, setS] = useState<AgendaSettings>(agenda.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<AgendaSettings>) => setS((cur) => ({ ...cur, ...patch }));
  const preset = AGENDA_FORMATS.find(
    (f) => Math.abs(f.widthMm - widthMm) < 0.5 && Math.abs(f.heightMm - heightMm) < 0.5
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/agendas/${agenda.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        school,
        year_label: yearLabel,
        start_date: start,
        end_date: end,
        width_mm: widthMm,
        height_mm: heightMm,
        bleed_mm: bleedMm,
        settings: s,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Enregistrement impossible.");
      return;
    }
    onSaved();
  }

  const fontSelect = (value: string, onChange: (v: string) => void) => (
    <FontPicker value={value} onChange={onChange} className={inputClass} />
  );
  const colorField = (label: string, value: string, onChange: (v: string) => void) => (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <ColorPickerButton value={value} onChange={onChange} label={label} />
        <span className="font-mono text-xs uppercase text-neutral-500">{value}</span>
      </div>
    </div>
  );
  const length = (label: string, valueMm: number, onChange: (mm: number) => void, maxIn = 2) => (
    <div>
      <label className={labelClass}>{label}</label>
      <LengthInput valueMm={valueMm} minMm={0} maxMm={maxIn * MM_PER_IN} onChange={onChange} className={inputClass} />
    </div>
  );

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-text">Agenda</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Nom</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>École</label>
            <input value={school} onChange={(e) => setSchool(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Année</label>
            <input value={yearLabel} onChange={(e) => setYearLabel(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Premier jour de l&apos;année</label>
            <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Dernier jour</label>
            <input type="date" required value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-text">Jours de cycle</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Longueur du cycle</label>
            <input
              type="number"
              min={0}
              max={20}
              value={s.cycleLength}
              onChange={(e) => set({ cycleLength: Math.min(20, Math.max(0, Math.floor(Number(e.target.value)) || 0)) })}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-neutral-500">0 = pas de jours de cycle.</p>
          </div>
          <div>
            <label className={labelClass}>Libellé</label>
            <input value={s.cycleLabel} onChange={(e) => set({ cycleLabel: e.target.value })} className={inputClass} />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text">Format et marges</h3>
          <LengthUnitToggle />
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className={labelClass}>Format</label>
            <select
              value={preset?.id ?? "custom"}
              onChange={(e) => {
                const f = AGENDA_FORMATS.find((x) => x.id === e.target.value);
                if (f) {
                  setWidthMm(f.widthMm);
                  setHeightMm(f.heightMm);
                }
              }}
              className={inputClass}
            >
              {AGENDA_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
              <option value="custom">Personnalisé</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Largeur</label>
            <LengthInput valueMm={widthMm} minMm={2 * MM_PER_IN} onChange={setWidthMm} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Hauteur</label>
            <LengthInput valueMm={heightMm} minMm={2 * MM_PER_IN} onChange={setHeightMm} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Fond perdu</label>
            <LengthInput valueMm={bleedMm} minMm={0} maxMm={0.75 * MM_PER_IN} onChange={setBleedMm} className={inputClass} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {length("Marge extérieure", s.marginMm, (mm) => set({ marginMm: mm }))}
          {length("Marge de reliure", s.gutterMm, (mm) => set({ gutterMm: mm }))}
        </div>
        <p className="text-xs text-neutral-500">La marge de reliure est du côté intérieur (spirale, boudin) : à droite des pages de gauche, à gauche des pages de droite.</p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-text">Style</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Police des titres</label>
            {fontSelect(s.headingFont, (v) => set({ headingFont: v }))}
          </div>
          <div>
            <label className={labelClass}>Police du texte</label>
            {fontSelect(s.bodyFont, (v) => set({ bodyFont: v }))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {colorField("Couleur de l'école", s.accentColor, (v) => set({ accentColor: v }))}
          {colorField("Texte", s.textColor, (v) => set({ textColor: v }))}
          {colorField("Fond des pages", s.backgroundColor, (v) => set({ backgroundColor: v }))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.dayLines} onChange={(e) => set({ dayLines: e.target.checked })} />
          Lignes d&apos;écriture dans les jours
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.showPageNumbers} onChange={(e) => set({ showPageNumbers: e.target.checked })} />
          Numéros de page (coin extérieur)
        </label>
      </section>

      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="flex items-center gap-2 btn-primary disabled:opacity-60"
      >
        {busy && <SpinnerIcon className="h-4 w-4" />}
        Enregistrer les réglages
      </button>
    </form>
  );
}
