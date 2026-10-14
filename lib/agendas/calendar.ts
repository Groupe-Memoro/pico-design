import { dayKindInfo, type AgendaDay, type DayKind } from "./types";

/**
 * Le calendrier scolaire : les dates, les journées spéciales et les jours de
 * cycle. Les dates sont des chaînes AAAA-MM-JJ calculées en UTC : aucun
 * fuseau horaire ne peut faire glisser un jour.
 */

export const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

const DAY_MS = 86_400_000;

export function parseIso(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function toIso(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return toIso(parseIso(iso) + n * DAY_MS);
}

// 0 = lundi … 6 = dimanche.
export function weekdayIndex(iso: string): number {
  return (new Date(parseIso(iso)).getUTCDay() + 6) % 7;
}

export function mondayOf(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

export function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function monthIndex(iso: string): number {
  return Number(iso.slice(5, 7)) - 1;
}

export function year(iso: string): number {
  return Number(iso.slice(0, 4));
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let t = parseIso(from); t <= parseIso(to); t += DAY_MS) days.push(toIso(t));
  return days;
}

// Premier jour de chaque mois touché par la période.
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let y = year(from);
  let m = monthIndex(from);
  while (y < year(to) || (y === year(to) && m <= monthIndex(to))) {
    months.push(`${y}-${String(m + 1).padStart(2, "0")}-01`);
    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
  }
  return months;
}

export function lastDayOfMonth(firstIso: string): string {
  const y = year(firstIso);
  const m = monthIndex(firstIso);
  return toIso(Date.UTC(y, m + 1, 0));
}

export interface DayInfo {
  // Dans l'année scolaire (entre les dates de début et de fin).
  inYear: boolean;
  schoolDay: boolean;
  // Jour de cycle (1 à N), pour un jour de classe quand l'agenda a un cycle.
  cycle: number | null;
  kind: DayKind | null;
  // Libellé à imprimer : celui saisi, sinon le nom du type de journée.
  label: string;
}

/**
 * Infos de chaque date de l'année scolaire. Un jour de classe est un jour de
 * semaine sans congé, journée pédagogique ni férié ; les jours de cycle se
 * suivent sur les seuls jours de classe.
 */
export function schoolCalendar(start: string, end: string, days: AgendaDay[], cycleLength: number): Map<string, DayInfo> {
  const special = new Map(days.map((d) => [d.day, d]));
  const info = new Map<string, DayInfo>();
  let count = 0;
  for (const iso of eachDay(start, end)) {
    const s = special.get(iso);
    const noSchool = s ? dayKindInfo(s.kind).noSchool : false;
    const schoolDay = weekdayIndex(iso) < 5 && !noSchool;
    info.set(iso, {
      inYear: true,
      schoolDay,
      cycle: schoolDay && cycleLength > 0 ? (count % cycleLength) + 1 : null,
      kind: s?.kind ?? null,
      label: s ? s.label.trim() || dayKindInfo(s.kind).label : "",
    });
    if (schoolDay) count++;
  }
  return info;
}

export const OUTSIDE_YEAR: DayInfo = { inYear: false, schoolDay: false, cycle: null, kind: null, label: "" };

// Dimanche de Pâques (calcul grégorien de Meeus/Jones/Butcher).
function easter(y: number): number {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}

// n-ième lundi d'un mois (1 = le premier).
function nthMonday(y: number, m: number, n: number): string {
  const first = Date.UTC(y, m, 1);
  const offset = (8 - new Date(first).getUTCDay()) % 7;
  return toIso(first + (offset + (n - 1) * 7) * DAY_MS);
}

/** Jours fériés du Québec compris dans la période. */
export function quebecHolidays(from: string, to: string): { day: string; label: string }[] {
  const list: { day: string; label: string }[] = [];
  for (let y = year(from); y <= year(to); y++) {
    const e = easter(y);
    // Lundi qui précède le 25 mai.
    const may24 = Date.UTC(y, 4, 24);
    const patriotes = toIso(may24 - ((new Date(may24).getUTCDay() + 6) % 7) * DAY_MS);
    list.push(
      { day: `${y}-01-01`, label: "Jour de l'An" },
      { day: toIso(e - 2 * DAY_MS), label: "Vendredi saint" },
      { day: toIso(e + DAY_MS), label: "Lundi de Pâques" },
      { day: patriotes, label: "Journée nationale des patriotes" },
      { day: `${y}-06-24`, label: "Fête nationale" },
      { day: `${y}-07-01`, label: "Fête du Canada" },
      { day: nthMonday(y, 8, 1), label: "Fête du Travail" },
      { day: nthMonday(y, 9, 2), label: "Action de grâce" },
      { day: `${y}-12-25`, label: "Noël" }
    );
  }
  return list.filter((h) => h.day >= from && h.day <= to).sort((a, b) => a.day.localeCompare(b.day));
}

export function formatLongDate(iso: string): string {
  return `${WEEKDAYS[weekdayIndex(iso)]} ${dayOfMonth(iso)} ${MONTHS[monthIndex(iso)]} ${year(iso)}`;
}
