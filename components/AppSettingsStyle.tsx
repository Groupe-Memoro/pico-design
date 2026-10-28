import { getCurrentUser, loadAppSettingsCached } from "@/lib/supabase/server";
import {
  COLOR_FIELDS,
  TYPOGRAPHY_DEFAULTS,
  assetUrl,
  brandFontVar,
  googleFontsHref,
  isBrandFont,
  type SettingsScope,
} from "@/lib/appSettings";

/**
 * Feuille de style des réglages d'un jeu (voir lib/appSettings.ts), injectée
 * APRÈS globals.css pour en redéfinir les tokens. Seules les valeurs
 * réellement réglées sont écrites : un jeu vide ne produit rien, et
 * l'habillage d'origine reste intact.
 *
 * Portée : app/layout.tsx pose le jeu « admin » pour toute l'application,
 * app/design/layout.tsx pose « tool » par-dessus pour l'Outil Shopify — le
 * second bloc vient plus loin dans le document, il l'emporte donc, sans
 * qu'aucun code n'ait à détecter la route.
 */
export default async function AppSettingsStyle({ scope }: { scope: SettingsScope }) {
  // Lecture par la clé de service quand il n'y a pas de session : la RLS de
  // app_settings n'ouvre rien à l'anonyme, et un visiteur public du lien
  // Shopify n'aurait donc AUCUN habillage — pas même le jeu par défaut.
  // L'habillage n'est pas un secret : ce sont des couleurs et un logo, déjà
  // visibles de quiconque ouvre la page.
  const user = await getCurrentUser();
  const settings = await loadAppSettingsCached(scope, !user);

  const declarations: string[] = [];
  for (const field of COLOR_FIELDS) {
    const value = settings.colors[field.key];
    if (value) declarations.push(`${field.token}: ${value};`);
  }

  const { baseSizePx, bodyWeight, headingWeight, bodyFont, headingFont } = settings.typography;
  const rules: string[] = [];

  // Ordre de priorité : fichier téléversé, puis police Google choisie, puis
  // police de marque chargée au build (--font-body/--font-heading, voir
  // lib/fonts.ts). Un maillon absent laisse simplement passer le suivant, si
  // bien que l'interface n'est jamais sans texte.
  if (!settings.fontBodyPath && bodyFont) {
    const family = isBrandFont(bodyFont) ? `var(${brandFontVar(bodyFont)})` : `"${bodyFont}"`;
    declarations.push(`--font-text: ${family}, var(--font-body), system-ui, sans-serif;`);
  }
  if (!settings.fontHeadingPath && headingFont) {
    const family = isBrandFont(headingFont) ? `var(${brandFontVar(headingFont)})` : `"${headingFont}"`;
    declarations.push(`--font-display: ${family}, var(--font-heading), Georgia, serif;`);
  }

  if (settings.fontBodyPath) {
    rules.push(
      `@font-face{font-family:"Pico Settings Body";src:url("${assetUrl(scope, "font-body", settings.updatedAt)}");font-display:swap;}`
    );
    declarations.push(`--font-text: "Pico Settings Body", var(--font-body), system-ui, sans-serif;`);
  }
  if (settings.fontHeadingPath) {
    rules.push(
      `@font-face{font-family:"Pico Settings Heading";src:url("${assetUrl(scope, "font-heading", settings.updatedAt)}");font-display:swap;}`
    );
    declarations.push(`--font-display: "Pico Settings Heading", var(--font-heading), Georgia, serif;`);
  }

  if (declarations.length > 0) rules.push(`:root{${declarations.join("")}}`);

  // Tailwind est en rem : la taille de référence met toute l'interface à
  // l'échelle d'un seul réglage.
  if (baseSizePx !== TYPOGRAPHY_DEFAULTS.baseSizePx) rules.push(`html{font-size:${baseSizePx}px;}`);
  if (bodyWeight !== TYPOGRAPHY_DEFAULTS.bodyWeight) rules.push(`body{font-weight:${bodyWeight};}`);
  if (headingWeight !== TYPOGRAPHY_DEFAULTS.headingWeight) {
    rules.push(`h1,h2,h3,h4{font-weight:${headingWeight};}`);
  }

  // Feuille Google chargée par <link> plutôt qu'avec @import : un @import
  // n'est valide qu'en tête de feuille et bloque le rendu le temps d'être
  // résolu. Seules les familles du catalogue passent (voir googleFontsHref).
  const fontsHref = googleFontsHref([
    !settings.fontBodyPath && bodyFont ? bodyFont : "",
    !settings.fontHeadingPath && headingFont ? headingFont : "",
  ]);

  if (rules.length === 0 && !fontsHref) return null;
  return (
    <>
      {fontsHref && <link rel="stylesheet" href={fontsHref} />}
      {rules.length > 0 && <style data-app-settings={scope} dangerouslySetInnerHTML={{ __html: rules.join("") }} />}
    </>
  );
}
