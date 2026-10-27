// Mode clair / sombre de l'administration : préférence de ce navigateur
// (localStorage), posée sur <html data-theme> avant le premier rendu par
// THEME_SCRIPT (app/layout.tsx), pour éviter un flash clair. L'Outil Shopify
// (/design) reste toujours clair : il s'affiche dans la boutique.

export type ColorTheme = "light" | "dark";
export const THEME_STORAGE_KEY = "pico:theme";

export const THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark"&&!location.pathname.startsWith("/design"))document.documentElement.dataset.theme="dark"}catch(e){}`;

export function applyColorTheme(theme: ColorTheme) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Sans stockage, le choix ne vaut que pour cette page.
  }
}
