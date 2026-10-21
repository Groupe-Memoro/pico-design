"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { Check } from "@/components/animate-ui/icons/check";
import { ChevronDown } from "@/components/animate-ui/icons/chevron-down";
import { ChevronLeft } from "@/components/animate-ui/icons/chevron-left";
import { ChevronRight } from "@/components/animate-ui/icons/chevron-right";
import { ChevronUp } from "@/components/animate-ui/icons/chevron-up";
import { Copy } from "@/components/animate-ui/icons/copy";
import { Download } from "@/components/animate-ui/icons/download";
import { Layers } from "@/components/animate-ui/icons/layers";
import { LogOut } from "@/components/animate-ui/icons/log-out";
import { Menu } from "@/components/animate-ui/icons/menu";
import { PanelLeft } from "@/components/animate-ui/icons/panel-left";
import { Plus } from "@/components/animate-ui/icons/plus";
import { RefreshCw } from "@/components/animate-ui/icons/refresh-cw";
import { RotateCw } from "@/components/animate-ui/icons/rotate-cw";
import { Send } from "@/components/animate-ui/icons/send";
import { Trash2 } from "@/components/animate-ui/icons/trash-2";
import { Upload } from "@/components/animate-ui/icons/upload";
import { Users } from "@/components/animate-ui/icons/users";
import { X } from "@/components/animate-ui/icons/x";

/**
 * Icônes animées d'Animate UI (animate-ui.com/docs/icons), pour celles qui ont
 * un équivalent exact de nos icônes Lucide (components/icons.tsx les
 * réexporte sous les mêmes noms) : l'animation se joue au survol du bouton ou
 * du lien qui contient l'icône, comme le faisait la secousse « jello »
 * (app/globals.css), dont elles sont exclues par `data-animate-icon`.
 */

type AnimatedProps = {
  className?: string;
  size?: number;
  animate?: boolean;
  "data-animate-icon"?: string;
};

// Le bouton ou le lien parent, survolé (et pas désactivé).
function useParentHover() {
  const ref = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const target = ref.current?.closest<HTMLElement>("button, a[href], [role='button']");
    if (!target) return;
    const enter = () => setHover(!(target as HTMLButtonElement).disabled);
    const leave = () => setHover(false);
    target.addEventListener("mouseenter", enter);
    target.addEventListener("mouseleave", leave);
    return () => {
      target.removeEventListener("mouseenter", enter);
      target.removeEventListener("mouseleave", leave);
    };
  }, []);
  return { ref, hover };
}

function animated(Icon: ComponentType<AnimatedProps>, name: string) {
  function AnimatedIcon({ className }: { className?: string }) {
    const { ref, hover } = useParentHover();
    // Le menu ajoute lui-même la secousse au survol : retirée ici.
    const classes = className
      ?.split(/\s+/)
      .filter((c) => !c.includes("animate-jello"))
      .join(" ");
    return (
      // `contents` : le span ne sert qu'à retrouver le bouton parent, sans
      // compter dans la mise en page.
      <span ref={ref} className="contents">
        <Icon size={24} className={classes} animate={hover} data-animate-icon="" />
      </span>
    );
  }
  AnimatedIcon.displayName = name;
  return AnimatedIcon;
}

export const CheckIcon = animated(Check, "CheckIcon");
export const ChevronDownIcon = animated(ChevronDown, "ChevronDownIcon");
export const ChevronLeftIcon = animated(ChevronLeft, "ChevronLeftIcon");
export const ChevronRightIcon = animated(ChevronRight, "ChevronRightIcon");
export const ChevronUpIcon = animated(ChevronUp, "ChevronUpIcon");
export const CopyIcon = animated(Copy, "CopyIcon");
export const DownloadIcon = animated(Download, "DownloadIcon");
export const LayersIcon = animated(Layers, "LayersIcon");
export const LogOutIcon = animated(LogOut, "LogOutIcon");
export const MenuIcon = animated(Menu, "MenuIcon");
export const PanelLeftIcon = animated(PanelLeft, "PanelLeftIcon");
export const PlusIcon = animated(Plus, "PlusIcon");
// Notre « RefreshCcwIcon » dessine en fait refresh-cw de Lucide.
export const RefreshCcwIcon = animated(RefreshCw, "RefreshCcwIcon");
export const RotateCwIcon = animated(RotateCw, "RotateCwIcon");
export const SendIcon = animated(Send, "SendIcon");
export const TrashIcon = animated(Trash2, "TrashIcon");
export const UploadIcon = animated(Upload, "UploadIcon");
export const UsersIcon = animated(Users, "UsersIcon");
export const XIcon = animated(X, "XIcon");
