"use client";

import Link from "next/link";

/**
 * Barre du haut de l'Outil Shopify, commune à tous ses modules (création de
 * design, impression de photos) : le client garde les mêmes repères d'un
 * produit à l'autre — logo de sa boutique (retour à la boutique), produit et
 * format, changement de modèle, et l'action principale à droite.
 */
export default function ToolTopBar({
  brandScope = "tool",
  shopHome = null,
  title,
  subtitle,
  onChangeModel,
  center,
  actions,
}: {
  // Jeu de réglages dont vient le logo (la boutique d'origine, sinon « tool »).
  brandScope?: string;
  // Accueil de la boutique : le logo y ramène.
  shopHome?: string | null;
  title: string;
  subtitle: string;
  onChangeModel?: () => void;
  // Au centre (ex. Recto / Verso de la création de design).
  center?: React.ReactNode;
  // À droite : aide, action principale.
  actions?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link href={shopHome ?? "/"} className="shrink-0" aria-label={shopHome ? "Retour à la boutique" : undefined}>
          {/* Logo réglable (module Paramètres) : celui de la boutique
              d'origine, à défaut celui de l'Outil Shopify. C'est le SEUL logo
              qu'un client Shopify voit, la barre de navigation étant masquée
              dans l'outil (voir useHideChrome). La route renvoie le fichier
              d'origine tant que rien n'est téléversé. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/settings/${brandScope}/asset/logo`} alt="Pico" className="h-6 w-auto" />
        </Link>
        <span className="h-7 w-px shrink-0 bg-border" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">{title}</p>
          <p className="truncate text-xs text-text-subtle">{subtitle}</p>
        </div>
        {onChangeModel && (
          <button
            type="button"
            onClick={onChangeModel}
            className="ml-2 shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-muted"
          >
            Changer de modèle
          </button>
        )}
      </div>
      {center}
      <div className="flex shrink-0 items-center gap-3">{actions}</div>
    </header>
  );
}
