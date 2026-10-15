"use client";

import { useState } from "react";
import { SpinnerIcon } from "@/components/icons";
import { FONT_OPTIONS } from "@/lib/design/fonts";
import { ALBUM_FORMATS, type Album, type AlbumSettings } from "@/lib/albums/types";

const inputClass = "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm";
const labelClass = "block text-sm font-medium";
const MM_PER_IN = 25.4;
// Trois décimales : 1/8 po (0,125) ne doit pas devenir 0,13.
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// Réglages de l'album : identité, format et style de toutes ses pages.
export default function AlbumSettingsForm({ album, onSaved }: { album: Album; onSaved: () => void }) {
  const [name, setName] = useState(album.name);
  const [school, setSchool] = useState(album.school);
  const [year, setYear] = useState(album.year);
  // Dimensions saisies en pouces (l'usage à l'atelier), enregistrées en mm.
  const [widthIn, setWidthIn] = useState(round3(Number(album.width_mm) / MM_PER_IN));
  const [heightIn, setHeightIn] = useState(round3(Number(album.height_mm) / MM_PER_IN));
  const [bleedIn, setBleedIn] = useState(round3(Number(album.bleed_mm) / MM_PER_IN));
  const [s, setS] = useState<AlbumSettings>(album.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<AlbumSettings>) => setS((cur) => ({ ...cur, ...patch }));
  const preset = ALBUM_FORMATS.find(
    (f) => Math.abs(f.widthMm - widthIn * MM_PER_IN) < 0.5 && Math.abs(f.heightMm - heightIn * MM_PER_IN) < 0.5
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
        width_mm: widthIn * MM_PER_IN,
        height_mm: heightIn * MM_PER_IN,
        bleed_mm: bleedIn * MM_PER_IN,
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
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {FONT_OPTIONS.map((f) => (
        <option key={f.id} value={f.id}>
          {f.label}
        </option>
      ))}
    </select>
  );
  const colorField = (label: string, value: string, onChange: (v: string) => void) => (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-neutral-300" />
        <span className="font-mono text-xs text-neutral-500">{value}</span>
      </div>
    </div>
  );

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-pico-black">Album</h3>
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
        <h3 className="text-sm font-semibold text-pico-black">Format (pouces)</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className={labelClass}>Format</label>
            <select
              value={preset?.id ?? "custom"}
              onChange={(e) => {
                const f = ALBUM_FORMATS.find((x) => x.id === e.target.value);
                if (f) {
                  setWidthIn(round3(f.widthMm / MM_PER_IN));
                  setHeightIn(round3(f.heightMm / MM_PER_IN));
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
            <input type="number" step="any" min={2} value={widthIn} onChange={(e) => setWidthIn(Number(e.target.value))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Hauteur</label>
            <input type="number" step="any" min={2} value={heightIn} onChange={(e) => setHeightIn(Number(e.target.value))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Fond perdu</label>
            <input type="number" step="any" min={0} max={0.75} value={bleedIn} onChange={(e) => setBleedIn(Number(e.target.value))} className={inputClass} />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-pico-black">Pages de portraits</h3>
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
        <h3 className="text-sm font-semibold text-pico-black">Style</h3>
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
            <label className={labelClass}>Marge (po)</label>
            <input
              type="number"
              step="any"
              min={0}
              max={2}
              value={round3(s.marginMm / MM_PER_IN)}
              onChange={(e) => set({ marginMm: Number(e.target.value) * MM_PER_IN })}
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

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="flex items-center gap-2 rounded-lg bg-pico-maroon px-4 py-2 text-sm font-medium text-white hover:bg-pico-maroon-dark disabled:opacity-60"
      >
        {busy && <SpinnerIcon className="h-4 w-4" />}
        Enregistrer les réglages
      </button>
    </form>
  );
}
