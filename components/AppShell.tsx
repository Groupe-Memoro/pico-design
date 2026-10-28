"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import { hasSidebar } from "@/lib/menuItems";
import { ChromeVisibilityProvider, useChromeHidden } from "@/components/ChromeVisibility";

// Cadre commun des pages (menu à gauche, ou barre en haut sur mobile + halo + colonne centrée). La
// page de connexion occupe tout l'écran sans ce chrome. L'Outil Shopify
// (/design), lui, le garde comme les autres modules SAUF pendant l'édition
// plein écran — voir ChromeVisibility.tsx/useHideChrome, appelé depuis
// DesignTool.tsx (l'écran « Choisir un modèle », avant l'éditeur, n'a pas
// besoin de masquer le chrome).
function AppShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const chromeHidden = useChromeHidden();
  // Ni la connexion, ni l'aide de l'Outil Shopify (lue par les clients de la
  // boutique, qui n'ont rien à faire des menus de l'administration).
  const showChrome = pathname !== "/login" && pathname !== "/design/aide" && !chromeHidden;
  // Pas de menu de gauche sur certaines pages (voir hasSidebar) : pas de décalage.
  const showSidebar = showChrome && hasSidebar(pathname);

  // `{children}` (donc la page, ex. DesignTool) reste TOUJOURS à la même
  // place dans l'arbre — seuls Nav et les classes du conteneur autour
  // apparaissent/disparaissent. Si `{children}` changeait de parent selon
  // `showChrome` (ex. wrappé ici, direct enfant du Fragment là), React
  // démonterait puis remonterait toute la page à chaque bascule (position
  // différente dans l'arbre = nouvelle identité) — perdant l'état interne de
  // DesignTool (dont `phase`) pile au moment où l'Outil Shopify entre dans
  // l'éditeur (ce qui déclenche justement cette bascule, via useHideChrome).
  return (
    <>
      {showChrome && <Nav />}
      {/* La place du menu fixe à gauche : sa largeur mesurée (--sidebar-w, voir Nav). */}
      <div
        className={
          showSidebar
            ? "page-glow lg:pl-[var(--sidebar-w)]"
            : showChrome
              ? "page-glow"
              : undefined
        }
      >
        <main className={showChrome ? "mx-auto max-w-6xl px-4 py-8 sm:px-6" : undefined}>{children}</main>
      </div>
    </>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  // /design?template=… ouvre l'éditeur plein écran d'emblée (voir DesignTool) :
  // on masque le chrome dès le premier rendu plutôt qu'à l'effet. Le layout
  // racine est dynamique (headers()), donc useSearchParams n'y pose pas de
  // contrainte de rendu statique.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const startsInEditor = pathname === "/design" && searchParams.has("template");
  return (
    <ChromeVisibilityProvider initiallyHidden={startsInEditor}>
      <AppShellContent>{children}</AppShellContent>
    </ChromeVisibilityProvider>
  );
}
