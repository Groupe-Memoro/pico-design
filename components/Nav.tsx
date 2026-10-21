"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { shopScopeOf } from "@/lib/appSettings";
import { createClient } from "@/lib/supabase/client";
import { LayoutGridIcon, LifeBuoyIcon, LogOutIcon, MenuIcon, PanelLeftIcon, XIcon } from "@/components/icons";
import { groupMenuOrder, hasSidebar, MENU_ITEMS, menuKeysForRole, resolveMenuOrder, type MenuKey } from "@/lib/menuItems";
import Modal from "@/components/Modal";
import ChangePasswordForm from "@/components/ChangePasswordForm";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrateur",
  designer: "Designer",
  gestionnaire: "Gestionnaire",
  // Compat : anciennes lignes encore sur "employee" si la migration 0030
  // (renommage du rôle) n'a pas été exécutée en base.
  employee: "Designer",
};


export default function Nav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = createClient();

  // Jeu de réglages dont vient le logo. Sur l'Outil Shopify, celui de la
  // boutique d'origine quand on en vient, sinon le jeu « tool ».
  //
  // La boutique est relue de l'URL plutôt que reçue en prop : cette barre
  // vit dans app/layout.tsx, donc AU-DESSUS de la page qui la connaît —
  // l'information ne peut pas remonter (même contrainte que
  // ChromeVisibility.tsx). Un `boutique` ou un `retour` forgé ne donne ici qu'un jeu
  // inexistant, donc le logo par défaut ; ce qui est acceptable comme
  // adresse de retour reste jugé côté serveur.
  const logoScope = pathname.startsWith("/design")
    ? (shopScopeOf(searchParams.get("boutique"), searchParams.get("retour")) ?? "tool")
    : "admin";
  // Accueil de la boutique d'origine, pour le lien du logo sur l'Outil
  // Shopify. Seulement depuis une adresse de retour en .myshopify.com (Shopify
  // redirige vers le domaine public) : jamais depuis `boutique`, que
  // n'importe qui peut changer dans l'adresse, et qui ferait du logo un lien
  // vers un site tiers.
  const shopHome = pathname.startsWith("/design") ? shopHomeOf(searchParams.get("retour")) : null;
  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  // Menu burger (mobile et tablette : le menu de gauche n'apparaît qu'à
  // partir de 1024 px).
  // Fermé automatiquement dès qu'on change de page.
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);
  // Modale « Changer mon mot de passe », ouverte depuis la pastille du nom —
  // accessible à tous les rôles (contrairement à Utilisateurs, réservé aux admins).
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  // Ordre par défaut en attendant le chargement du profil, pour éviter un
  // flash de nav vide — synchronisé avec l'ordre choisi sur le tableau de
  // bord une fois le profil chargé (voir DashboardTiles).
  const [menuOrder, setMenuOrder] = useState<MenuKey[]>(() => menuKeysForRole(null));

  useEffect(() => {
    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role, menu_order")
        .eq("id", user.id)
        .single<{ full_name: string | null; role: string | null; menu_order: string[] | null }>();
      setName(profile?.full_name ?? user.email ?? null);
      setRole(profile?.role ?? null);
      setMenuOrder(resolveMenuOrder(profile?.menu_order, menuKeysForRole(profile?.role)));
    }
    loadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Resynchronise immédiatement avec un glisser-déposer effectué sur le
    // tableau de bord (composant séparé) dans le même onglet.
    function onMenuOrderChanged(e: Event) {
      const detail = (e as CustomEvent<MenuKey[]>).detail;
      if (Array.isArray(detail)) setMenuOrder(detail);
    }
    window.addEventListener("pico:menu-order-changed", onMenuOrderChanged);
    return () => window.removeEventListener("pico:menu-order-changed", onMenuOrderChanged);
  }, []);

  // Les liens, répartis dans leurs groupes — l'ordre personnalisé continue
  // de jouer à l'intérieur de chacun (voir groupMenuOrder).
  const groupes = useMemo(() => groupMenuOrder(menuOrder), [menuOrder]);

  // Nouvelles commandes (reçues, pas encore en production) : une pastille sur
  // « Commandes », mise à jour chaque minute, au retour sur l'onglet et à
  // chaque changement de page (après avoir fait avancer une commande, par ex.).
  const showsOrders = menuOrder.includes("orders");
  const [newOrders, setNewOrders] = useState(0);
  useEffect(() => {
    if (!showsOrders) return;
    let cancelled = false;
    const refresh = () =>
      fetch("/api/orders/new-count", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d && typeof d.count === "number") setNewOrders(d.count);
        })
        .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    // L'écran Commandes signale chaque commande vue, retirée ou avancée.
    window.addEventListener("pico:orders-changed", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pico:orders-changed", refresh);
    };
  }, [showsOrders, pathname]);

  const initials = name
    ? name
        .split(/\s+/)
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "";

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // Menu de gauche réduit aux icônes (bouton « Réduire »). Préférence de ce
  // navigateur seulement.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("pico:sidebar") === "collapsed");
    } catch {
      // Stockage indisponible (navigation privée…) : menu déplié.
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("pico:sidebar", collapsed ? "collapsed" : "expanded");
    } catch {
      // Sans stockage, la préférence ne vaut que pour cette page.
    }
  }, [collapsed]);

  // Le menu prend la largeur de son contenu (son lien le plus long). Cette
  // largeur mesurée est publiée dans --sidebar-w sur <html>, d'où AppShell
  // décale la page : les deux restent alignés quels que soient les titres,
  // la police ou l'état réduit.
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarShown = hasSidebar(pathname);
  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty("--sidebar-w", `${el.offsetWidth}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sidebarShown]);

  // Page active : le tableau de bord sur « / » seulement, une page sur son
  // adresse et ses sous-pages (/imposition/new reste dans Imposition).
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  // Un lien du menu, en colonne. `iconOnly` : menu de gauche réduit (le titre
  // passe alors dans l'infobulle).
  function navLink(href: string, title: string, Icon: (props: { className?: string }) => JSX.Element, iconOnly = false) {
    const active = isActive(href);
    const badge = href === MENU_ITEMS.orders.href ? newOrders : 0;
    const badgeText = badge > 99 ? "99+" : String(badge);
    return (
      <Link
        key={href}
        href={href}
        title={iconOnly ? title : undefined}
        aria-label={iconOnly ? title : undefined}
        aria-current={active ? "page" : undefined}
        className={`group flex items-center gap-3 rounded-xl py-2.5 text-[15px] transition-colors duration-150 ${
          iconOnly ? "w-10 justify-center" : "pl-3 pr-6"
        } ${active ? "bg-primary-subtle font-medium text-primary" : "text-text-muted hover:bg-surface-muted hover:text-text"}`}
      >
        {/* Même secousse « jello » au survol que partout ailleurs ; `motion-safe` la coupe au besoin. */}
        <span className="relative shrink-0">
          <Icon className="h-[18px] w-[18px] shrink-0 motion-safe:group-hover:animate-jello" />
          {/* Menu réduit : la pastille sur l'icône. */}
          {iconOnly && badge > 0 && (
            <span className="absolute -right-2 -top-2 min-w-[16px] rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-text-on-brand">
              {badgeText}
            </span>
          )}
        </span>
        {!iconOnly && <span className="truncate">{title}</span>}
        {!iconOnly && badge > 0 && (
          <span
            className="ml-auto rounded-full bg-primary px-2 text-xs font-semibold leading-5 text-text-on-brand"
            title={`${badge} nouvelle${badge > 1 ? "s" : ""} commande${badge > 1 ? "s" : ""}`}
          >
            {badgeText}
          </span>
        )}
      </Link>
    );
  }

  // Les liens, groupés comme sur le tableau de bord : le tableau de bord en
  // tête, puis chaque groupe séparé du précédent par un filet.
  const links = (iconOnly: boolean) => (
    <>
      {navLink("/", "Tableau de bord", LayoutGridIcon, iconOnly)}
      {groupes.map((groupe) => (
        <div key={groupe.join("-")} className="mt-2 space-y-0.5 border-t border-border pt-2">
          {groupe.map((key) => navLink(MENU_ITEMS[key].href, MENU_ITEMS[key].title, MENU_ITEMS[key].icon, iconOnly))}
        </div>
      ))}
    </>
  );

  return (
    <>
      {/* Barre du haut, sur toute la largeur et sur tous les écrans : le logo
          à gauche, le compte et la déconnexion à droite. En dessous de 1024 px,
          elle porte aussi le burger, qui déplie les liens du menu. */}
      <header className="sticky top-0 z-40 border-b border-border bg-surface">
        <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
          {/* Logo réglable (module Paramètres). Le jeu suit la surface : l'Outil
              Shopify peut porter un autre logo que l'administration, et une
              boutique le sien. La route renvoie le logo d'origine tant que rien
              n'est téléversé. */}
          {/* Le logo suivi de l'initiale de l'application : « Pico D », comme
              « Pico OS ». Le nom complet reste dans l'étiquette du lien. */}
          {shopHome ? (
            <a href={shopHome} className="flex shrink-0 items-center gap-2.5" aria-label="Retour à la boutique">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/settings/${logoScope}/asset/logo`} alt="" className="h-7 w-auto" />
            </a>
          ) : (
            <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Pico Design — tableau de bord">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/settings/${logoScope}/asset/logo`} alt="" className="h-7 w-auto" />
              <span className="font-heading text-2xl font-bold leading-none text-text">D</span>
            </Link>
          )}
          {/* Retour au tableau de bord, comme la grille à côté de « Pico OS ». */}
          <Link
            href="/"
            title="Tableau de bord"
            aria-label="Tableau de bord"
            className="group mr-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted hover:text-text"
          >
            <LayoutGridIcon className="h-5 w-5 motion-safe:group-hover:animate-jello" />
          </Link>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMobileOpen((open) => !open)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              title={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
              className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted hover:text-text lg:hidden"
            >
              {mobileOpen ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
              {/* Menu fermé : un point signale de nouvelles commandes. */}
              {!mobileOpen && newOrders > 0 && (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
              )}
            </button>
            {/* Aide : intégrer Pico Design à une boutique Shopify (page /aide). */}
            <Link
              href="/aide"
              title="Aide"
              aria-label="Aide"
              aria-current={pathname === "/aide" ? "page" : undefined}
              className={`group flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-surface-muted hover:text-text ${
                pathname === "/aide" ? "text-primary" : "text-text-muted"
              }`}
            >
              <LifeBuoyIcon className="h-5 w-5 motion-safe:group-hover:animate-jello" />
            </Link>
            {/* La pastille du nom ouvre « Changer mon mot de passe » (tous les rôles). */}
            <button
              onClick={() => setAccountOpen(true)}
              title="Changer mon mot de passe"
              className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 hover:bg-surface-muted"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-text-on-brand">
                {initials || "?"}
              </span>
              {name && (
                <span className="hidden text-left sm:block">
                  <span className="block text-sm font-medium text-text">{name}</span>
                  {role && <span className="block text-xs text-text-subtle">{ROLE_LABELS[role] ?? role}</span>}
                </span>
              )}
            </button>
            <button
              onClick={handleLogout}
              title="Se déconnecter"
              aria-label="Se déconnecter"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted hover:text-text"
            >
              <LogOutIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
        {mobileOpen && (
          <nav id="mobile-nav" className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-border px-3 py-2 lg:hidden">
            {links(false)}
          </nav>
        )}
      </header>

      {/* Grand écran : menu fixe à gauche, sous la barre du haut. AppShell
          décale la page de sa largeur (--sidebar-w). Pas sur toutes les
          pages : voir hasSidebar. */}
      {sidebarShown && (
        <aside
          ref={sidebarRef}
          className="fixed bottom-0 left-0 top-16 z-30 hidden w-max flex-col border-r border-border bg-surface lg:flex"
        >
          <nav className={`flex-1 overflow-y-auto py-3 ${collapsed ? "px-2" : "px-3"}`}>{links(collapsed)}</nav>
  
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Déplier le menu" : "Réduire le menu"}
            aria-label={collapsed ? "Déplier le menu" : "Réduire le menu"}
            aria-expanded={!collapsed}
            className={`flex shrink-0 items-center gap-3 border-t border-border py-3 text-sm text-text-muted hover:bg-surface-muted hover:text-text ${
              collapsed ? "justify-center" : "px-5"
            }`}
          >
            <PanelLeftIcon className="h-[18px] w-[18px]" />
            {!collapsed && "Réduire"}
          </button>
        </aside>
      )}

      {accountOpen && (
        <Modal
          title="Changer mon mot de passe"
          onClose={() => {
            setAccountOpen(false);
            setPasswordChanged(false);
          }}
        >
          {passwordChanged ? (
            <p className="text-sm text-green-700">Mot de passe changé.</p>
          ) : (
            <ChangePasswordForm onSuccess={() => setPasswordChanged(true)} />
          )}
        </Modal>
      )}
    </>
  );
}

/** Accueil de la boutique, d'après une adresse de retour en .myshopify.com. */
function shopHomeOf(returnUrl: string | null): string | null {
  if (!returnUrl) return null;
  try {
    const url = new URL(returnUrl);
    if (url.protocol !== "https:" || !url.hostname.toLowerCase().endsWith(".myshopify.com")) return null;
    return `https://${url.hostname}/`;
  } catch {
    return null;
  }
}
