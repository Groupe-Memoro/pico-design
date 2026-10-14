// Module Agendas scolaires : les données (voir
// supabase/migrations/0072_agendas.sql) et leurs valeurs par défaut. Sans
// dépendance serveur : chargé aussi par l'éditeur, dans le navigateur.

export const AGENDAS_BUCKET = "agendas";

export interface AgendaSettings {
  // Marge extérieure et marge de reliure (côté intérieur de chaque page).
  marginMm: number;
  gutterMm: number;
  headingFont: string;
  bodyFont: string;
  textColor: string;
  accentColor: string;
  backgroundColor: string;
  // Jours de cycle : 0 = pas de cycle ; sinon « Jour 1 » à « Jour N ».
  cycleLength: number;
  cycleLabel: string;
  // Lignes d'écriture dans les cases des jours.
  dayLines: boolean;
  showPageNumbers: boolean;
}

export const DEFAULT_AGENDA_SETTINGS: AgendaSettings = {
  marginMm: 10,
  gutterMm: 16,
  headingFont: "montserrat",
  bodyFont: "montserrat",
  textColor: "#1f1f1f",
  accentColor: "#1f5fa8",
  backgroundColor: "#ffffff",
  cycleLength: 9,
  cycleLabel: "Jour",
  dayLines: true,
  showPageNumbers: true,
};

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};
const color = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);

export function agendaSettings(raw: unknown): AgendaSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_AGENDA_SETTINGS;
  return {
    marginMm: clamp(s.marginMm, 0, 40, d.marginMm),
    gutterMm: clamp(s.gutterMm, 0, 50, d.gutterMm),
    headingFont: typeof s.headingFont === "string" ? s.headingFont : d.headingFont,
    bodyFont: typeof s.bodyFont === "string" ? s.bodyFont : d.bodyFont,
    textColor: color(s.textColor, d.textColor),
    accentColor: color(s.accentColor, d.accentColor),
    backgroundColor: color(s.backgroundColor, d.backgroundColor),
    cycleLength: Math.round(clamp(s.cycleLength, 0, 20, d.cycleLength)),
    cycleLabel: typeof s.cycleLabel === "string" && s.cycleLabel.trim() ? s.cycleLabel.trim().slice(0, 20) : d.cycleLabel,
    dayLines: s.dayLines !== false,
    showPageNumbers: s.showPageNumbers !== false,
  };
}

// Formats proposés à la création (fini, sans le fond perdu).
export const AGENDA_FORMATS: { id: string; label: string; widthMm: number; heightMm: number }[] = [
  { id: "half-letter", label: "5,5 × 8,5 po (demi-lettre)", widthMm: 139.7, heightMm: 215.9 },
  { id: "6x9", label: "6 × 9 po", widthMm: 152.4, heightMm: 228.6 },
  { id: "7x9", label: "7 × 9 po", widthMm: 177.8, heightMm: 228.6 },
  { id: "letter", label: "8,5 × 11 po (lettre)", widthMm: 215.9, heightMm: 279.4 },
];

export type DayKind = "conge" | "pedago" | "ferie" | "examen" | "evenement";

export const DAY_KINDS: { kind: DayKind; label: string; noSchool: boolean; color: string }[] = [
  { kind: "conge", label: "Congé", noSchool: true, color: "#e58e26" },
  { kind: "pedago", label: "Journée pédagogique", noSchool: true, color: "#8e44ad" },
  { kind: "ferie", label: "Férié", noSchool: true, color: "#c0392b" },
  { kind: "examen", label: "Examen", noSchool: false, color: "#16a085" },
  { kind: "evenement", label: "Événement", noSchool: false, color: "#2c7be5" },
];

export const dayKindInfo = (kind: DayKind) => DAY_KINDS.find((k) => k.kind === kind)!;

export interface AgendaDay {
  // Date au format AAAA-MM-JJ.
  day: string;
  kind: DayKind;
  label: string;
}

export interface Agenda {
  id: string;
  name: string;
  school: string;
  year_label: string;
  width_mm: number;
  height_mm: number;
  bleed_mm: number;
  start_date: string;
  end_date: string;
  settings: AgendaSettings;
  pdf_path: string | null;
  pdf_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AgendaPageKind = "cover" | "calendar" | "info" | "pdf" | "sponsors" | "notes";

export type CalendarLayout = "week2" | "week1" | "day" | "month1" | "month2";

export const CALENDAR_LAYOUTS: { id: CalendarLayout; label: string; help: string }[] = [
  { id: "week2", label: "Semaine sur 2 pages", help: "Lundi à mercredi à gauche, jeudi à dimanche à droite." },
  { id: "week1", label: "Semaine sur 1 page", help: "Lundi à vendredi, et la fin de semaine partagée." },
  { id: "day", label: "Un jour par page", help: "Chaque jour de semaine sur sa page ; samedi et dimanche partagent la leur." },
  { id: "month1", label: "Mois sur 1 page", help: "La grille du mois." },
  { id: "month2", label: "Mois sur 2 pages", help: "La grille du mois à gauche, une page de notes du mois à droite." },
];

export interface CoverContent {
  title: string;
  subtitle: string;
  photo: string | null;
  photoMode: "full" | "top";
}

export interface CalendarContent {
  layout: CalendarLayout;
  // Période (AAAA-MM-JJ) ; vide = les dates de l'agenda.
  from: string;
  to: string;
  // Une vue du mois avant les semaines (ou les jours) de chaque mois.
  monthOverview: boolean;
  // Bandeaux de commanditaires, en bas des pages, à tour de rôle.
  banners: string[];
}

export interface InfoContent {
  title: string;
  text: string;
  photo: string | null;
}

export interface PdfContent {
  path: string | null;
  name: string;
  pageCount: number;
}

export type SponsorsLayout = "1" | "2" | "4" | "6";

export interface SponsorsContent {
  title: string;
  layout: SponsorsLayout;
  photos: string[];
}

export interface NotesContent {
  title: string;
  count: number;
  style: "lined" | "blank";
}

export type AgendaPageContent = CoverContent | CalendarContent | InfoContent | PdfContent | SponsorsContent | NotesContent;

export interface AgendaPage {
  id: string;
  agenda_id: string;
  position: number;
  kind: AgendaPageKind;
  content: AgendaPageContent;
}

export const AGENDA_PAGE_LABELS: Record<AgendaPageKind, string> = {
  cover: "Couverture",
  calendar: "Calendrier",
  info: "Page d'info",
  pdf: "PDF de l'école",
  sponsors: "Commanditaires",
  notes: "Notes",
};

export const SPONSOR_SLOTS: Record<SponsorsLayout, number> = { "1": 1, "2": 2, "4": 4, "6": 6 };

export function defaultAgendaContent(kind: AgendaPageKind): AgendaPageContent {
  switch (kind) {
    case "cover":
      return { title: "", subtitle: "", photo: null, photoMode: "top" };
    case "calendar":
      return { layout: "week2", from: "", to: "", monthOverview: true, banners: [] };
    case "info":
      return { title: "", text: "", photo: null };
    case "pdf":
      return { path: null, name: "", pageCount: 0 };
    case "sponsors":
      return { title: "Merci à nos commanditaires", layout: "4", photos: [] };
    case "notes":
      return { title: "Notes", count: 2, style: "lined" };
  }
}

const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const text = (v: unknown) => (typeof v === "string" ? v : "");
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : []);

// Contenu enregistré (jsonb), complété : une valeur absente reprend son défaut.
export function agendaPageContent(kind: AgendaPageKind, raw: unknown): AgendaPageContent {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  switch (kind) {
    case "cover":
      return {
        title: text(c.title),
        subtitle: text(c.subtitle),
        photo: typeof c.photo === "string" && c.photo ? c.photo : null,
        photoMode: c.photoMode === "full" ? "full" : "top",
      };
    case "calendar":
      return {
        layout: CALENDAR_LAYOUTS.find((l) => l.id === c.layout)?.id ?? "week2",
        from: isoDate(c.from),
        to: isoDate(c.to),
        monthOverview: c.monthOverview !== false,
        banners: strings(c.banners).slice(0, 30),
      };
    case "info":
      return { title: text(c.title), text: text(c.text), photo: typeof c.photo === "string" && c.photo ? c.photo : null };
    case "pdf":
      return {
        path: typeof c.path === "string" && c.path ? c.path : null,
        name: text(c.name),
        pageCount: Math.round(clamp(c.pageCount, 0, 200, 0)),
      };
    case "sponsors": {
      const layout = (["1", "2", "4", "6"] as const).find((l) => l === c.layout) ?? "4";
      return { title: text(c.title), layout, photos: strings(c.photos).slice(0, SPONSOR_SLOTS[layout]) };
    }
    case "notes":
      return { title: text(c.title), count: Math.round(clamp(c.count, 1, 40, 2)), style: c.style === "blank" ? "blank" : "lined" };
  }
}

// Fichiers (photos, PDF) d'un bloc, pour vérifier et nettoyer le stockage.
export function agendaPageFiles(kind: AgendaPageKind, content: AgendaPageContent): string[] {
  if (kind === "cover") return (content as CoverContent).photo ? [(content as CoverContent).photo!] : [];
  if (kind === "info") return (content as InfoContent).photo ? [(content as InfoContent).photo!] : [];
  if (kind === "calendar") return (content as CalendarContent).banners;
  if (kind === "sponsors") return (content as SponsorsContent).photos;
  if (kind === "pdf") return (content as PdfContent).path ? [(content as PdfContent).path!] : [];
  return [];
}
