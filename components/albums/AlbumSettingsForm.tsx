"use client";

import { useState } from "react";
import { SpinnerIcon } from "@/components/icons";
import { ALBUM_FORMATS, type Album, type AlbumSettings } from "@/lib/albums/types";
import FontPicker from "@/components/FontPicker";
import ColorPickerButton from "@/components/ColorPickerButton";
import { LengthInput, LengthUnitToggle } from "@/components/UnitInputs";

const inputClass = "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm";
const labelClass = "block text-sm font-medium";
const MM_PER_IN = 25.4;

// Réglages de l'album : identité, format et style de toutes ses pages.
export default function AlbumSettingsForm({ album, onSaved }: { album: Album; onSaved: () => void }) {
  const [name, setName] = useState(album.name);
  const [school, setSchool] = useState(album.school);
  const [year, setYear] = useState(album.year);
  // Dimensions enregistrées en mm, saisies en po ou en mm (voir UnitInputs).
  const [widthMm, setWidthMm] = useState(Number(album.width_mm));
  const [heightMm, setHeightMm] = useState(Number(album.height_mm));
  const [bleedMm, setBleedMm] = useState(Number(album.bleed_mm));
  const [s, setS] = useState<AlbumSettings>(album.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<AlbumSettings>) => setS((cur) => ({ ...cur, ...patch }));
  const preset = ALBUM_FORMATS.find(
    (f) => Math.abs(f.widthMm - widthMm) < 0.5 && Math.abs(f.heightMm - heightMm) < 0.5
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/albums/${album.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        school,
        year,
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

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-text">Album</h3>
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
            <input value={year} onChange={(e) => setYear(e.target.value)} className={inputClass} />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text">Format</h3>
          <LengthUnitToggle />
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className={labelClass}>Format</label>
            <select
              value={preset?.id ?? "custom"}
              onChange={(e) => {
                const f = ALBUM_FORMATS.find((x) => x.id === e.target.value);
                if (f) {
                  setWidthMm(f.widthMm);
                  setHeightMm(f.heightMm);
                }
              }}
              className={inputClass}
            >
              {ALBUM_FORMATS.map((f) => (
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
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-text">Pages de portraits</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className={labelClass}>Colonnes</label>
            <input type="number" min={1} max={8} value={s.columns} onChange={(e) => set({ columns: Math.min(8, Math.max(1, Number(e.target.value) || 1)) })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Rangées</label>
            <input type="number" min={1} max={10} value={s.rows} onChange={(e) => set({ rows: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Nom sous la photo</label>
            <select value={s.nameFormat} onChange={(e) => set({ nameFormat: e.target.value as AlbumSettings["nameFormat"] })} className={inputClass}>
              <option value="first_last">Prénom Nom</option>
              <option value="last_first">Nom, Prénom</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          {s.columns * s.rows} portraits par page.
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-text">Style</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Police des titres</label>
            {fontSelect(s.headingFont, (v) => set({ headingFont: v }))}
          </div>
          <div>
            <label className={labelClass}>Police du texte</label>
            {fontSelect(s.bodyFont, (v) => set({ bodyFont: v }))}
          </div>
          <div>
            <label className={labelClass}>Marge</label>
            <LengthInput
              valueMm={s.marginMm}
              minMm={0}
              maxMm={2 * MM_PER_IN}
              onChange={(marginMm) => set({ marginMm })}
              className={inputClass}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {colorField("Titres", s.accentColor, (v) => set({ accentColor: v }))}
          {colorField("Texte", s.textColor, (v) => set({ textColor: v }))}
          {colorField("Fond des pages", s.backgroundColor, (v) => set({ backgroundColor: v }))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.showPageNumbers} onChange={(e) => set({ showPageNumbers: e.target.checked })} />
          Numéros de page (sauf la couverture)
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
