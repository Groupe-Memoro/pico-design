"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HexColorPicker } from "react-colorful";
import { PipetteIcon } from "@/components/icons";

// L'API EyeDropper (Chrome/Edge desktop et Android, Safari 17.4+ ; pas
// Firefox) n'est pas encore dans lib.dom.d.ts de TypeScript — déclarée à la main.
interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperConstructor {
  new (): { open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperResult> };
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const PANEL_WIDTH = 176; // w-44
// Hauteur approximative du panneau (carré + barre de teinte + champ hex +
// marges) : le bouton "Générer" de UserForm n'existe pas ici, donc la
// mesure réelle n'est pas nécessaire — une estimation suffit pour décider
// de le faire flotter au-dessus plutôt qu'en dessous, si la place manque.
const PANEL_HEIGHT_ESTIMATE = 260;

/**
 * Remplace `<input type="color">` : le sélecteur natif ouvre une fenêtre du
 * système ou du navigateur, impossible à styliser (particulièrement terne
 * sur PC). Ici, un bouton-pastille ouvre un petit panneau maison (react-
 * colorful, ~2,8 Ko), dans le style de l'app plutôt que celui de l'OS.
 *
 * Le panneau est monté dans un portail (document.body) plutôt qu'à la place
 * du bouton : ce sélecteur est toujours utilisé dans un formulaire ouvert en
 * modale (voir Modal.tsx, `overflow-y-auto`), qui couperait ou forcerait un
 * défilement interne si le panneau restait un enfant positionné dedans.
 */
export default function ColorPickerButton({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (hex: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(value);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Calculé une fois : dépend du navigateur, pas de l'état du composant.
  const [supportsEyeDropper] = useState(() => typeof window !== "undefined" && "EyeDropper" in window);

  // Le champ hex suit la couleur choisie sur le carré/la barre.
  useEffect(() => {
    setHexInput(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function place() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Aligné sous le bouton ; ramené à l'intérieur de la fenêtre s'il déborderait à droite,
      // et basculé au-dessus s'il n'y a pas assez de place en dessous.
      const left = Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8);
      const fitsBelow = rect.bottom + 6 + PANEL_HEIGHT_ESTIMATE <= window.innerHeight;
      const top = fitsBelow ? rect.bottom + 6 : Math.max(8, rect.top - 6 - PANEL_HEIGHT_ESTIMATE);
      setPosition({ top, left: Math.max(8, left) });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Se ferme au clic en dehors. Pas de fermeture sur Échap ici : ce
  // sélecteur s'ouvre presque toujours dans une modale (voir Modal.tsx),
  // qui a elle-même son propre raccourci Échap — en dupliquer un ici
  // fermerait les deux à la fois plutôt que le panneau seul.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function handleHexChange(raw: string) {
    setHexInput(raw);
    const hex = raw.startsWith("#") ? raw : `#${raw}`;
    if (HEX_RE.test(hex)) onChange(hex);
  }

  // Choisit une couleur n'importe où à l'écran (pas seulement dans la page),
  // via la pipette du système — pratique pour reprendre la couleur exacte
  // d'un visuel ou d'une maquette ouverte ailleurs.
  async function handleEyeDropper() {
    const EyeDropperCtor = (window as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper;
    if (!EyeDropperCtor) return;
    try {
      const result = await new EyeDropperCtor().open();
      onChange(result.sRGBHex);
    } catch {
      // Annulée (Échap ou clic ailleurs) — rien à faire.
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={label}
        aria-label={label}
        aria-expanded={open}
        className="h-7 w-7 rounded-full border border-neutral-300 outline-none ring-offset-2 transition-transform duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-pico-black"
        style={{ backgroundColor: HEX_RE.test(value) ? value : "#000000" }}
      />
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-50 space-y-2 card p-3 shadow-xl"
            style={{ top: position.top, left: position.left, width: PANEL_WIDTH }}
          >
            <HexColorPicker
              color={HEX_RE.test(value) ? value : "#000000"}
              onChange={(hex) => onChange(hex)}
              className="!w-full"
            />
            <div className="flex items-center gap-1.5">
              {supportsEyeDropper && (
                <button
                  type="button"
                  onClick={handleEyeDropper}
                  title="Pipette : choisir une couleur à l'écran"
                  aria-label="Pipette : choisir une couleur à l'écran"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                >
                  <PipetteIcon className="h-3.5 w-3.5" />
                </button>
              )}
              <input
                value={hexInput}
                onChange={(e) => handleHexChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                spellCheck={false}
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-center text-xs uppercase tracking-wide text-neutral-700"
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
