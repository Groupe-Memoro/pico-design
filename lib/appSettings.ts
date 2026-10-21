import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Identité visuelle réglable (module Paramètres, voir
 * supabase/migrations/0054_app_settings.sql). Deux jeux indépendants :
 * l'administration interne et l'Outil Shopify vu par les clients.
 *
 * Module sans dépendance serveur (ni sharp, ni supabase/server) pour être
 * importable des deux côtés : le formulaire s'en sert pour ses valeurs par
 * défaut, le rendu pour composer sa feuille de style.
 */
/**
 * Jeux de réglages. Les deux jeux historiques, plus un jeu facultatif par
 * boutique : `scope` vaut alors son domaine (voir migration 0058).
 *
 * « tool » reste le défaut — une boutique sans réglages propres en hérite,
 * il n'y a donc rien à créer pour chaque nouvelle boutique.
 */
export const BASE_SCOPES = ["admin", "tool"] as const;
export type BaseScope = (typeof BASE_SCOPES)[number];
export type SettingsScope = BaseScope | string;

// Conservé pour les appelants qui n'itèrent que sur les deux jeux de base.
export const SETTINGS_SCOPES = BASE_SCOPES;

const SCOPE_LABELS: Record<BaseScope, string> = {
  admin: "Administration",
  tool: "Outil Shopify (par défaut)",
};

/** Un domaine de boutique, tel qu'accepté comme jeu de réglages. */
export function isShopScope(value: string): boolean {
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(value);
}

export function isSettingsScope(value: unknown): value is SettingsScope {
  return typeof value === "string" && ((BASE_SCOPES as readonly string[]).includes(value) || isShopScope(value));
}

/**
 * Boutique d'origine du visiteur, déduite de l'adresse de retour Shopify.
 * C'est le seul signal dont dispose l'Outil Shopify : le client arrive par
 * un lien, sans session ni en-tête qui dise d'où il vient.
 *
 * Ici plutôt que dans lib/shopify.ts, qui importe `crypto` et ne peut donc
 * pas être chargé côté navigateur : la barre de navigation en a besoin pour
 * afficher le bon logo, et elle est un composant client.
 *
 * Cette fonction dit seulement « à quel jeu de réglages regarder ». Ce qui
 * est acceptable comme adresse de RETOUR — là où on renvoie réellement le
 * client, et donc une redirection ouverte si on se trompe — reste jugé par
 * isAllowedReturnUrl, côté serveur uniquement. Un domaine inventé ne donne
 * ici qu'un jeu inexistant, donc l'habillage par défaut.
 */
function shopScopeOfReturnUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    return isShopScope(host) ? host : null;
  } catch {
    return null; // relative, ou illisible
  }
}

/**
 * Jeu de réglages de l'Outil Shopify : le paramètre `boutique` (le domaine
 * public de la boutique, ex. picolabo.ca, envoyé par le bloc Liquid) s'il est
 * valable, sinon le domaine de l'adresse de retour. L'adresse de retour est
 * toujours en .myshopify.com (seul domaine accepté pour y renvoyer le client),
 * alors que les réglages sont rangés sous le domaine que voit le client.
 *
 * Même garantie que plus haut : un domaine inventé ne donne qu'un jeu
 * inexistant, donc l'habillage par défaut. `boutique` ne sert jamais
 * d'adresse de retour.
 */
export function shopScopeOf(boutique: unknown, returnUrl: unknown): string | null {
  if (typeof boutique === "string") {
    // www.picolabo.ca et picolabo.ca désignent la même boutique.
    const shop = boutique.trim().toLowerCase().replace(/^www\./, "");
    if (isShopScope(shop)) return shop;
  }
  return shopScopeOfReturnUrl(returnUrl);
}

/** Libellé d'un jeu : « Administration », « Outil Shopify », ou le domaine. */
export function scopeLabel(scope: SettingsScope): string {
  return (SCOPE_LABELS as Record<string, string>)[scope] ?? scope;
}

/**
 * Les 8 couleurs exposées — pas les 51 tokens de globals.css : tous les
 * autres en dérivent, et une liste complète serait illisible dans un
 * formulaire. La clé est le nom du token CSS redéfini.
 */
export const COLOR_FIELDS = [
  { key: "primary", token: "--primary", label: "Couleur principale", default: "#631028" },
  { key: "primaryHover", token: "--primary-hover", label: "Principale (survol)", default: "#4d0c1f" },
  { key: "accent", token: "--accent", label: "Accent", default: "#ff6633" },
  { key: "background", token: "--background", label: "Fond de page", default: "#faf7f2" },
  { key: "surface", token: "--surface", label: "Fond des cartes", default: "#ffffff" },
  { key: "border", token: "--border", label: "Bordures", default: "#e6ddd1" },
  { key: "text", token: "--text", label: "Texte", default: "#1a1613" },
  { key: "textMuted", token: "--text-muted", label: "Texte secondaire", default: "#5c5347" },
] as const;

export type ColorKey = (typeof COLOR_FIELDS)[number]["key"];

/**
 * Catalogue de polices d'interface, servies par Google Fonts. Rien n'est
 * stocké : l'interface s'affiche dans un navigateur, la feuille de style de
 * Google suffit — contrairement aux polices de l'outil de texte
 * (lib/design/fonts.ts), dont le fichier doit être sur le disque parce que
 * le PDF est composé côté serveur.
 *
 * Liste fermée : le nom choisi finit dans une URL et dans du CSS, il est
 * donc validé contre ce catalogue et jamais pris tel quel.
 */
export const UI_FONT_CHOICES = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Raleway",
  "Nunito",
  "Nunito Sans",
  "Work Sans",
  "Rubik",
  "Karla",
  "Mulish",
  "Manrope",
  "DM Sans",
  "Figtree",
  "Outfit",
  "Plus Jakarta Sans",
  "Sora",
  "Space Grotesk",
  "Barlow",
  "Cabin",
  "Quicksand",
  "Josefin Sans",
  "Oswald",
  "Bebas Neue",
  "Archivo",
  "Chivo",
  "Playfair Display",
  "Merriweather",
  "Lora",
  "Libre Baskerville",
  "Source Serif 4",
  "Crimson Pro",
  "Cormorant Garamond",
  "EB Garamond",
  "Bitter",
  "Arvo",
  "Fraunces",
  "Spectral",
] as const;

export type UiFont = (typeof UI_FONT_CHOICES)[number];

function isUiFont(value: unknown): value is UiFont {
  return typeof value === "string" && (UI_FONT_CHOICES as readonly string[]).includes(value);
}

/**
 * Polices de marque, chargées au build (voir lib/fonts.ts) : elles restent
 * proposées à côté du catalogue Google, et peuvent être croisées — Gelica en
 * texte courant, par exemple, là où elle ne sert d'ordinaire qu'aux titres.
 * Elles ne déclenchent aucune requête externe : le nom renvoie simplement
 * vers la variable CSS correspondante.
 */
export const BRAND_FONTS = [
  { value: "brand:apercu", label: "Apercu (marque)", cssVar: "--font-body" },
  { value: "brand:gelica", label: "Gelica (marque)", cssVar: "--font-heading" },
] as const;

export type BrandFont = (typeof BRAND_FONTS)[number]["value"];

export function isBrandFont(value: unknown): value is BrandFont {
  return typeof value === "string" && BRAND_FONTS.some((f) => f.value === value);
}

export function brandFontVar(value: BrandFont): string {
  return BRAND_FONTS.find((f) => f.value === value)!.cssVar;
}

/** Une police d'interface : de marque, ou tirée du catalogue Google. */
export type FontChoice = UiFont | BrandFont;

function isFontChoice(value: unknown): value is FontChoice {
  return isUiFont(value) || isBrandFont(value);
}

/** URL de la feuille Google Fonts pour les familles demandées. */
export function googleFontsHref(families: string[]): string | null {
  const valid = Array.from(new Set(families.filter(isUiFont)));
  if (valid.length === 0) return null;
  const params = valid.map((f) => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700;800`).join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

export interface TypographySettings {
  // Taille de référence : Tailwind travaillant en rem, cette seule valeur
  // met toute l'interface à l'échelle.
  baseSizePx: number;
  bodyWeight: number;
  headingWeight: number;
  // Police choisie (de marque ou Google) ; null = celle d'origine pour cet
  // emplacement. Un fichier téléversé, s'il y en a un, l'emporte.
  bodyFont: FontChoice | null;
  headingFont: FontChoice | null;
}

export const TYPOGRAPHY_DEFAULTS: TypographySettings = {
  baseSizePx: 16,
  bodyWeight: 400,
  headingWeight: 600,
  bodyFont: null,
  headingFont: null,
};

export const TYPOGRAPHY_LIMITS = {
  baseSizePx: { min: 14, max: 18 },
  weight: { min: 300, max: 800 },
};

export interface AppSettings {
  scope: SettingsScope;
  colors: Partial<Record<ColorKey, string>>;
  typography: TypographySettings;
  logoPath: string | null;
  faviconPath: string | null;
  shareImagePath: string | null;
  fontBodyPath: string | null;
  fontHeadingPath: string | null;
  // Sert de cache-buster dans les URL d'assets : le navigateur doit revoir
  // le logo dès qu'il change, sans pour autant le redemander à chaque page.
  updatedAt: string | null;
}

export function defaultAppSettings(scope: SettingsScope): AppSettings {
  return {
    scope,
    colors: {},
    typography: { ...TYPOGRAPHY_DEFAULTS },
    logoPath: null,
    faviconPath: null,
    shareImagePath: null,
    fontBodyPath: null,
    fontHeadingPath: null,
    updatedAt: null,
  };
}

// #rrggbb uniquement : c'est ce que produisent les sélecteurs de couleur du
// projet (voir ColorPickerButton), et ce qui est sûr à injecter tel quel
// dans une feuille de style.
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function parseTypography(raw: unknown): TypographySettings {
  const t = (raw ?? {}) as Partial<Record<keyof TypographySettings, unknown>>;
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    baseSizePx: clamp(
      num(t.baseSizePx, TYPOGRAPHY_DEFAULTS.baseSizePx),
      TYPOGRAPHY_LIMITS.baseSizePx.min,
      TYPOGRAPHY_LIMITS.baseSizePx.max
    ),
    bodyWeight: clamp(
      num(t.bodyWeight, TYPOGRAPHY_DEFAULTS.bodyWeight),
      TYPOGRAPHY_LIMITS.weight.min,
      TYPOGRAPHY_LIMITS.weight.max
    ),
    headingWeight: clamp(
      num(t.headingWeight, TYPOGRAPHY_DEFAULTS.headingWeight),
      TYPOGRAPHY_LIMITS.weight.min,
      TYPOGRAPHY_LIMITS.weight.max
    ),
    bodyFont: isFontChoice(t.bodyFont) ? t.bodyFont : null,
    headingFont: isFontChoice(t.headingFont) ? t.headingFont : null,
  };
}

function parseColors(raw: unknown): Partial<Record<ColorKey, string>> {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out: Partial<Record<ColorKey, string>> = {};
  for (const field of COLOR_FIELDS) {
    const value = source[field.key];
    if (isHexColor(value)) out[field.key] = value;
  }
  return out;
}

/** Ligne brute de la table, telle que Supabase la renvoie. */
export interface AppSettingsRow {
  scope: SettingsScope;
  colors: unknown;
  typography: unknown;
  logo_path: string | null;
  favicon_path: string | null;
  share_image_path: string | null;
  font_body_path: string | null;
  font_heading_path: string | null;
  updated_at: string | null;
}

export function fromRow(row: AppSettingsRow): AppSettings {
  return {
    scope: row.scope,
    colors: parseColors(row.colors),
    typography: parseTypography(row.typography),
    logoPath: row.logo_path,
    faviconPath: row.favicon_path,
    shareImagePath: row.share_image_path,
    fontBodyPath: row.font_body_path,
    fontHeadingPath: row.font_heading_path,
    updatedAt: row.updated_at,
  };
}

/**
 * Lit un jeu de réglages. Tolérant par construction : si la table n'existe
 * pas encore (migration 0054 non exécutée) ou si la ligne manque, on renvoie
 * les valeurs par défaut — l'interface continue de s'afficher normalement.
 */
export async function loadAppSettings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  scope: SettingsScope
): Promise<AppSettings> {
  try {
    const { data } = await supabase.from("app_settings").select("*").eq("scope", scope).maybeSingle();
    return data ? fromRow(data as AppSettingsRow) : defaultAppSettings(scope);
  } catch {
    return defaultAppSettings(scope);
  }
}

export const ASSET_SLOTS = ["logo", "favicon", "share", "font-body", "font-heading"] as const;
export type AssetSlot = (typeof ASSET_SLOTS)[number];

export function assetPathFor(settings: AppSettings, slot: AssetSlot): string | null {
  switch (slot) {
    case "logo":
      return settings.logoPath;
    case "favicon":
      return settings.faviconPath;
    case "share":
      return settings.shareImagePath;
    case "font-body":
      return settings.fontBodyPath;
    case "font-heading":
      return settings.fontHeadingPath;
  }
}

/**
 * URL de service d'un asset. Les buckets étant privés, rien n'est servi
 * directement : tout passe par /api/settings/[scope]/asset/[slot]. Le
 * `v=updatedAt` force le navigateur à revoir le fichier quand il change,
 * tout en autorisant un cache long le reste du temps.
 */
export function assetUrl(scope: SettingsScope, slot: AssetSlot, updatedAt: string | null): string {
  const version = updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : "";
  return `/api/settings/${scope}/asset/${slot}${version}`;
}
