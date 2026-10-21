import type { Product } from "./types";

// Réglages de l'ombre portée du logo. Le flou et la distance sont en % de la
// largeur du logo (l'ombre garde la même allure quelle que soit la taille du
// logo sur le produit) ; l'angle est en degrés (0° = vers la droite, 90° =
// vers le bas) ; l'opacité est en %.
export interface LogoShadowSettings {
  blur: number;
  distance: number;
  angle: number;
  opacity: number;
}

// Valeurs de départ : le rendu de la première version de l'option.
export const DEFAULT_LOGO_SHADOW: LogoShadowSettings = { blur: 2.5, distance: 3.2, angle: 68, opacity: 40 };

export const LOGO_SHADOW_RANGES: Record<keyof LogoShadowSettings, { min: number; max: number; step: number }> = {
  blur: { min: 0, max: 10, step: 0.5 },
  distance: { min: 0, max: 10, step: 0.5 },
  angle: { min: 0, max: 360, step: 5 },
  opacity: { min: 0, max: 100, step: 5 },
};

function clampNumber(value: unknown, key: keyof LogoShadowSettings): number {
  const { min, max } = LOGO_SHADOW_RANGES[key];
  const n = typeof value === "string" ? parseFloat(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return DEFAULT_LOGO_SHADOW[key];
  return Math.min(max, Math.max(min, n));
}

function normalizeLogoShadow(raw: Partial<Record<keyof LogoShadowSettings, unknown>>): LogoShadowSettings {
  return {
    blur: clampNumber(raw.blur, "blur"),
    distance: clampNumber(raw.distance, "distance"),
    angle: clampNumber(raw.angle, "angle"),
    opacity: clampNumber(raw.opacity, "opacity"),
  };
}

type ShadowColumns = Pick<
  Product,
  "logo_shadow_blur" | "logo_shadow_distance" | "logo_shadow_angle" | "logo_shadow_opacity"
>;

// Réglages enregistrés d'un produit (même quand l'ombre est désactivée : on
// garde les valeurs pour les retrouver si on la réactive).
export function logoShadowSettingsOf(product: Partial<ShadowColumns>): LogoShadowSettings {
  return normalizeLogoShadow({
    blur: product.logo_shadow_blur,
    distance: product.logo_shadow_distance,
    angle: product.logo_shadow_angle,
    opacity: product.logo_shadow_opacity,
  });
}

// Réglages à appliquer au rendu : null si le produit n'a pas d'ombre.
export function logoShadowOf(product: Partial<ShadowColumns> & { logo_shadow?: boolean }): LogoShadowSettings | null {
  return product.logo_shadow ? logoShadowSettingsOf(product) : null;
}

// Lit l'option et ses réglages dans un formulaire envoyé par le navigateur.
export function parseLogoShadowForm(formData: FormData) {
  const enabled = formData.get("logoShadow") === "true";
  const settings = normalizeLogoShadow({
    blur: formData.get("logoShadowBlur"),
    distance: formData.get("logoShadowDistance"),
    angle: formData.get("logoShadowAngle"),
    opacity: formData.get("logoShadowOpacity"),
  });
  return {
    enabled,
    settings,
    // Pour le rendu : null quand l'ombre est désactivée.
    active: enabled ? settings : null,
    // Colonnes de la table `products`.
    columns: {
      logo_shadow: enabled,
      logo_shadow_blur: settings.blur,
      logo_shadow_distance: settings.distance,
      logo_shadow_angle: settings.angle,
      logo_shadow_opacity: settings.opacity,
    },
  };
}
