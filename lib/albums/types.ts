// Module Albums des finissants : les données (voir
// supabase/migrations/0071_albums.sql) et leurs valeurs par défaut. Sans
// dépendance serveur : chargé aussi par l'éditeur, dans le navigateur.

export const ALBUMS_BUCKET = "albums";

export interface AlbumSettings {
  // Grille des pages de portraits.
  columns: number;
  rows: number;
  // Marge intérieure de chaque page, depuis le bord de coupe.
  marginMm: number;
  // Polices (identifiants de lib/design/fonts.ts).
  headingFont: string;
  bodyFont: string;
  textColor: string;
  accentColor: string;
  backgroundColor: string;
  // « Prénom Nom » ou « Nom, Prénom » sous chaque portrait.
  nameFormat: "first_last" | "last_first";
  showPageNumbers: boolean;
}

export const DEFAULT_ALBUM_SETTINGS: AlbumSettings = {
  columns: 4,
  rows: 5,
  marginMm: 12.7,
  headingFont: "playfair",
  bodyFont: "montserrat",
  textColor: "#1f1f1f",
  accentColor: "#7a1f3d",
  backgroundColor: "#ffffff",
  nameFormat: "first_last",
  showPageNumbers: true,
};

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};
const color = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);

// Réglages enregistrés (jsonb), complétés et bornés : une valeur absente ou
// invalide reprend sa valeur par défaut plutôt que de casser la mise en page.
export function albumSettings(raw: unknown): AlbumSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_ALBUM_SETTINGS;
  return {
    columns: Math.round(clamp(s.columns, 1, 8, d.columns)),
    rows: Math.round(clamp(s.rows, 1, 10, d.rows)),
    marginMm: clamp(s.marginMm, 0, 50, d.marginMm),
    headingFont: typeof s.headingFont === "string" ? s.headingFont : d.headingFont,
    bodyFont: typeof s.bodyFont === "string" ? s.bodyFont : d.bodyFont,
    textColor: color(s.textColor, d.textColor),
    accentColor: color(s.accentColor, d.accentColor),
    backgroundColor: color(s.backgroundColor, d.backgroundColor),
    nameFormat: s.nameFormat === "last_first" ? "last_first" : "first_last",
    showPageNumbers: s.showPageNumbers !== false,
  };
}

// Formats proposés à la création (fini, sans le fond perdu).
export const ALBUM_FORMATS: { id: string; label: string; widthMm: number; heightMm: number }[] = [
  { id: "letter", label: "8,5 × 11 po (lettre)", widthMm: 215.9, heightMm: 279.4 },
  { id: "9x12", label: "9 × 12 po", widthMm: 228.6, heightMm: 304.8 },
  { id: "8x10", label: "8 × 10 po", widthMm: 203.2, heightMm: 254 },
  { id: "8x8", label: "8 × 8 po (carré)", widthMm: 203.2, heightMm: 203.2 },
  { id: "11x8.5", label: "11 × 8,5 po (paysage)", widthMm: 279.4, heightMm: 215.9 },
];

export interface Album {
  id: string;
  name: string;
  school: string;
  year: string;
  width_mm: number;
  height_mm: number;
  bleed_mm: number;
  settings: AlbumSettings;
  pdf_path: string | null;
  pdf_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlbumStudent {
  id: string;
  album_id: string;
  first_name: string;
  last_name: string;
  group_name: string;
  photo_path: string | null;
  thumb_path: string | null;
}

export type AlbumPageKind = "cover" | "portraits" | "free" | "signatures";

export interface CoverContent {
  title: string;
  subtitle: string;
  photo: string | null;
  // La photo couvre toute la page (fond perdu compris), ou le haut seulement.
  photoMode: "full" | "top";
}

export interface PortraitsContent {
  // Titre de la première page (« Nos finissants »). Vide = le nom du groupe.
  title: string;
  // Un seul groupe, ou tous ("") : chaque groupe commence alors une page.
  group: string;
}

export type FreeLayout = "1" | "2" | "4" | "6";

export interface FreeContent {
  title: string;
  text: string;
  layout: FreeLayout;
  photos: string[];
}

export interface SignaturesContent {
  title: string;
  count: number;
  style: "lined" | "blank";
}

export type AlbumPageContent = CoverContent | PortraitsContent | FreeContent | SignaturesContent;

export interface AlbumPage {
  id: string;
  album_id: string;
  position: number;
  kind: AlbumPageKind;
  content: AlbumPageContent;
}

export const PAGE_KIND_LABELS: Record<AlbumPageKind, string> = {
  cover: "Couverture",
  portraits: "Portraits",
  free: "Page libre",
  signatures: "Signatures",
};

export const FREE_LAYOUT_SLOTS: Record<FreeLayout, number> = { "1": 1, "2": 2, "4": 4, "6": 6 };

export function defaultContent(kind: AlbumPageKind): AlbumPageContent {
  switch (kind) {
    case "cover":
      return { title: "", subtitle: "", photo: null, photoMode: "top" };
    case "portraits":
      return { title: "Nos finissants", group: "" };
    case "free":
      return { title: "", text: "", layout: "4", photos: [] };
    case "signatures":
      return { title: "Signatures", count: 2, style: "lined" };
  }
}

// Contenu enregistré (jsonb), complété : même principe que albumSettings.
export function pageContent(kind: AlbumPageKind, raw: unknown): AlbumPageContent {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  switch (kind) {
    case "cover":
      return {
        title: text(c.title),
        subtitle: text(c.subtitle),
        photo: typeof c.photo === "string" && c.photo ? c.photo : null,
        photoMode: c.photoMode === "full" ? "full" : "top",
      };
    case "portraits":
      return { title: text(c.title), group: text(c.group) };
    case "free": {
      const layout = (["1", "2", "4", "6"] as const).find((l) => l === c.layout) ?? "4";
      const photos = Array.isArray(c.photos) ? c.photos.filter((p): p is string => typeof p === "string") : [];
      return { title: text(c.title), text: text(c.text), layout, photos: photos.slice(0, FREE_LAYOUT_SLOTS[layout]) };
    }
    case "signatures":
      return {
        title: text(c.title),
        count: Math.round(clamp(c.count, 1, 20, 2)),
        style: c.style === "blank" ? "blank" : "lined",
      };
  }
}

export function studentDisplayName(s: Pick<AlbumStudent, "first_name" | "last_name">, format: AlbumSettings["nameFormat"]): string {
  const first = s.first_name.trim();
  const last = s.last_name.trim();
  if (format === "last_first") return [last, first].filter(Boolean).join(", ");
  return [first, last].filter(Boolean).join(" ");
}

// Ordre des portraits : par groupe, puis nom, puis prénom (ordre français).
export function sortStudents<T extends Pick<AlbumStudent, "first_name" | "last_name" | "group_name">>(students: T[]): T[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, "fr", { sensitivity: "base" });
  return [...students].sort(
    (a, b) => cmp(a.group_name, b.group_name) || cmp(a.last_name, b.last_name) || cmp(a.first_name, b.first_name)
  );
}
