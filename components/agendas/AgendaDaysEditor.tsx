"use client";

import { useMemo, useState } from "react";
import { SpinnerIcon } from "@/components/icons";
import {
  MONTHS,
  WEEKDAYS,
  addDays,
  dayOfMonth,
  eachDay,
  lastDayOfMonth,
  monthIndex,
  monthsBetween,
  quebecHolidays,
  schoolCalendar,
  weekdayIndex,
  year,
} from "@/lib/agendas/calendar";
import { DAY_KINDS, dayKindInfo, type Agenda, type AgendaDay, type DayKind } from "@/lib/agendas/types";

/**
 * Le calendrier scolaire de l'agenda : un clic choisit une date, Maj+clic
 * étend le choix jusqu'à elle (une semaine de relâche), puis on applique un
 * type de journée ou on la remet en jour normal. Les jours de cycle se
 * recalculent à mesure.
 */
export default function AgendaDaysEditor({ agenda, days, onChanged }: { agenda: Agenda; days: AgendaDay[]; onChanged: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [kind, setKind] = useState<DayKind>("conge");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cal = useMemo(
    () => schoolCalendar(agenda.start_date, agenda.end_date, days, agenda.settings.cycleLength),
    [agenda.start_date, agenda.end_date, days, agenda.settings.cycleLength]
  );
  const special = useMemo(() => new Map(days.map((d) => [d.day, d])), [days]);
  const schoolDays = useMemo(() => [...cal.values()].filter((i) => i.schoolDay).length, [cal]);
  const selectedSet = new Set(selected);

  function pick(iso: string, extend: boolean) {
    if (extend && anchor) {
      const [a, b] = anchor < iso ? [anchor, iso] : [iso, anchor];
      setSelected(eachDay(a, b));
    } else {
      setSelected([iso]);
      setAnchor(iso);
      const s = special.get(iso);
      if (s) {
        setKind(s.kind);
        setLabel(s.label);
      }
    }
  }

  async function save(body: { set?: AgendaDay[]; clear?: string[] }) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/agendas/${agenda.id}/days`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Enregistrement impossible.");
      return;
    }
    setSelected([]);
    onChanged();
  }

  function apply() {
    // Une plage ne marque que les jours de semaine : la relâche n'a pas besoin
    // de ses samedis et dimanches.
    const targets = selected.length > 1 ? selected.filter((d) => weekdayIndex(d) < 5) : selected;
    save({ set: targets.map((day) => ({ day, kind, label })) });
  }

  function addHolidays() {
    const missing = quebecHolidays(agenda.start_date, agenda.end_date).filter((h) => !special.has(h.day));
    if (missing.length === 0) {
      setError("Tous les fériés du Québec de l'année sont déjà marqués.");
      return;
    }
    save({ set: missing.map((h) => ({ day: h.day, kind: "ferie", label: h.label })) });
  }

  const months = monthsBetween(agenda.start_date, agenda.end_date);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        <p className="mb-3 text-sm text-neutral-600">
          Du {agenda.start_date} au {agenda.end_date} · <strong>{schoolDays}</strong> jours de classe
          {agenda.settings.cycleLength > 0 && ` · cycle de ${agenda.settings.cycleLength} jours`}
        </p>
        <div className="mb-3 flex flex-wrap gap-3 text-xs">
          {DAY_KINDS.map((k) => (
            <span key={k.kind} className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm" style={{ background: k.color }} />
              {k.label}
            </span>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {months.map((first) => {
            const offset = weekdayIndex(first);
            const count = dayOfMonth(lastDayOfMonth(first));
            return (
              <div key={first} className="rounded-xl border border-neutral-200 bg-white p-2">
                <p className="mb-1 text-sm font-medium capitalize">
                  {MONTHS[monthIndex(first)]} {year(first)}
                </p>
                <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-neutral-400">
                  {WEEKDAYS.map((w) => (
                    <span key={w}>{w.charAt(0).toUpperCase()}</span>
                  ))}
                </div>
                <div className="mt-0.5 grid grid-cols-7 gap-0.5">
                  {Array.from({ length: offset }, (_, i) => (
                    <span key={`v${i}`} />
                  ))}
                  {Array.from({ length: count }, (_, i) => {
                    const iso = addDays(first, i);
                    const info = cal.get(iso);
                    const s = special.get(iso);
                    const color = s ? dayKindInfo(s.kind).color : null;
                    return (
                      <button
                        key={iso}
                        type="button"
                        onClick={(e) => pick(iso, e.shiftKey)}
                        title={s ? `${dayKindInfo(s.kind).label}${s.label ? ` — ${s.label}` : ""}` : info?.cycle ? `${agenda.settings.cycleLabel} ${info.cycle}` : undefined}
                        className={`relative flex h-9 flex-col items-center justify-center rounded text-xs ${
                          selectedSet.has(iso) ? "ring-2 ring-pico-maroon" : ""
                        } ${!info ? "text-neutral-300" : weekdayIndex(iso) >= 5 ? "text-neutral-400" : "text-pico-black"}`}
                        style={color ? { background: `${color}26`, boxShadow: `inset 0 -3px 0 ${color}` } : undefined}
                      >
                        <span className="font-medium">{i + 1}</span>
                        {info?.cycle && <span className="text-[9px] leading-none text-neutral-500">{info.cycle}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          {selected.length === 0 ? (
            <p className="text-sm text-neutral-500">Cliquez sur une date ; Maj+clic pour choisir une plage (ex. la relâche).</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium">
                {selected.length === 1 ? selected[0] : `Du ${selected[0]} au ${selected[selected.length - 1]}`}
              </p>
              <div>
                <label className="block text-sm font-medium">Type</label>
                <select value={kind} onChange={(e) => setKind(e.target.value as DayKind)} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm">
                  {DAY_KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                      {k.noSchool ? " (pas de classe)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium">Libellé imprimé (facultatif)</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={dayKindInfo(kind).label}
                  maxLength={80}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={apply}
                  disabled={busy}
                  className="flex items-center gap-2 rounded-lg bg-pico-maroon px-3 py-2 text-sm font-medium text-white hover:bg-pico-maroon-dark disabled:opacity-60"
                >
                  {busy && <SpinnerIcon className="h-4 w-4" />}
                  Appliquer
                </button>
                <button
                  type="button"
                  onClick={() => save({ clear: selected })}
                  disabled={busy}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-60"
                >
                  Jour normal
                </button>
              </div>
              {selected.length > 1 && <p className="text-xs text-neutral-500">Les samedis et dimanches de la plage restent normaux.</p>}
            </div>
          )}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>

        <button
          type="button"
          onClick={addHolidays}
          disabled={busy}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-60"
        >
          Ajouter les fériés du Québec
        </button>

        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <p className="mb-2 text-sm font-medium">Journées spéciales ({days.length})</p>
          <ul className="max-h-80 space-y-1 overflow-y-auto text-xs">
            {days.map((d) => (
              <li key={d.day}>
                <button type="button" onClick={() => pick(d.day, false)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-neutral-50">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: dayKindInfo(d.kind).color }} />
                  <span className="w-20 shrink-0 text-neutral-500">{d.day}</span>
                  <span className="truncate">{d.label || dayKindInfo(d.kind).label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
