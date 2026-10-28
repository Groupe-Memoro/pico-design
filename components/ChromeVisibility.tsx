"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Permet à une page (via useHideChrome, plus bas) de demander à AppShell de
// masquer temporairement son chrome (Nav + habillage page-glow/max-w-6xl) —
// utilisé par l'Outil Shopify : l'écran « Choisir un modèle » garde le
// chrome habituel (comme les autres modules), mais l'éditeur plein écran,
// lui, occupe tout l'écran sans Nav (voir DesignTool.tsx). AppShell étant un
// ANCÊTRE de la page (dans app/layout.tsx), l'info ne peut pas remonter par
// une prop — un contexte est le mécanisme le plus simple pour ça, sans
// changer de route (l'Outil Shopify reste une seule page, voir DesignTool).
const ChromeVisibilityContext = createContext<{ hidden: boolean; setHidden: (hidden: boolean) => void } | null>(null);

// `initiallyHidden` : chrome masqué dès le premier rendu (sinon la Nav
// s'afficherait puis disparaîtrait à l'effet de useHideChrome — saut de mise
// en page). useHideChrome remet la valeur exacte dès son montage.
export function ChromeVisibilityProvider({
  children,
  initiallyHidden = false,
}: {
  children: React.ReactNode;
  initiallyHidden?: boolean;
}) {
  const [hidden, setHidden] = useState(initiallyHidden);
  return (
    <ChromeVisibilityContext.Provider value={{ hidden, setHidden }}>{children}</ChromeVisibilityContext.Provider>
  );
}

// Utilisé par AppShell lui-même pour savoir s'il doit masquer son chrome.
export function useChromeHidden(): boolean {
  return useContext(ChromeVisibilityContext)?.hidden ?? false;
}

// Utilisé par une page qui a besoin de masquer le chrome tant qu'une
// condition est vraie (ex. `phase === "editor"`) — remet automatiquement le
// chrome dès que `hidden` redevient false ou que la page se démonte, pas
// besoin de le faire explicitement à chaque endroit qui change de phase.
export function useHideChrome(hidden: boolean) {
  const ctx = useContext(ChromeVisibilityContext);
  useEffect(() => {
    if (!ctx) return;
    // Même quand `hidden` est faux : annule un masquage initial supposé à tort
    // (ex. `?template=` inconnu, donc galerie et non éditeur).
    ctx.setHidden(hidden);
    return () => ctx.setHidden(false);
  }, [ctx, hidden]);
}
