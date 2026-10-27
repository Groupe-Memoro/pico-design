"use client";

import { useEffect } from "react";
import { SpinnerIcon } from "@/components/icons";

export default function Modal({
  title,
  onClose,
  children,
  wide,
  full,
  busy,
  busyDetail = null,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  // Presque tout l'écran : pour un espace de travail (ex. l'éditeur de thème).
  full?: boolean;
  // Affiche un voile "Enregistrement en cours..." par-dessus la modale et
  // bloque sa fermeture (Échap, clic sur le fond, bouton "X") — évite qu'un
  // envoi un peu long (traitement d'image, génération de PDF...) donne
  // l'impression que l'app a planté, et qu'une fermeture accidentelle
  // pendant l'envoi laisse l'utilisateur dans le doute sur le résultat.
  busy?: boolean;
  // Précision affichée à côté de « Enregistrement en cours... » (ex.
  // « Création des produits 3/40 »).
  busyDetail?: string | null;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, busy]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onClose()} />
      {/* Le voile « Enregistrement » vit à côté de la zone qui défile, pas
          dedans : sinon il restait en haut du contenu (souvent hors de vue)
          dès qu'on avait fait défiler un long formulaire. */}
      <div
        className={`relative flex w-full flex-col overflow-hidden rounded-2xl bg-surface shadow-xl ${
          full ? "max-h-[96vh] max-w-[1600px]" : wide ? "max-h-[90vh] max-w-4xl" : "max-h-[90vh] max-w-lg"
        }`}
      >
        <div className="min-h-0 overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-text">{title}</h2>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Fermer"
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
        </div>

        {busy && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-neutral-50/85 backdrop-blur-[1px]">
            <SpinnerIcon className="h-6 w-6 text-pico-maroon" />
            <p className="text-sm font-medium text-neutral-600">
              Enregistrement en cours...
              {busyDetail && <span className="ml-2 font-semibold text-pico-maroon">{busyDetail}</span>}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
