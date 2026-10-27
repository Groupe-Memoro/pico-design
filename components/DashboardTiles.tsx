"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "@/components/icons";
import { MENU_ITEMS, groupMenuOrder, menuGroupLabel, type MenuKey } from "@/lib/menuItems";

function SortableTile({ menuKey }: { menuKey: MenuKey }) {
  const item = MENU_ITEMS[menuKey];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: menuKey,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative flex items-center gap-4 rounded-2xl border border-neutral-200 bg-surface p-5 shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:border-transparent hover:shadow-xl"
    >
      <Link href={item.href} className="flex flex-1 items-center gap-4 overflow-hidden">
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white ${item.gradient}`}
        >
          {/* Même secousse « jello » que les icônes du menu, jouée une fois au survol de la
              carte (`group`) ; `motion-safe` la coupe pour qui a demandé moins d'animations. */}
          <item.icon className="h-6 w-6 motion-safe:group-hover:animate-jello" />
        </span>
        <span className="truncate font-heading text-2xl font-semibold text-text transition-transform duration-200 ease-out group-hover:translate-x-0.5">
          {item.title}
        </span>
      </Link>
      {/* Poignée dédiée : le déplacement se déclenche uniquement à partir
          d'elle, jamais de la carte/lien elle-même — évite toute ambiguïté
          entre "cliquer pour naviguer" et "glisser pour réordonner". */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Déplacer"
        className="flex h-8 w-8 shrink-0 touch-none cursor-grab items-center justify-center rounded-lg text-neutral-300 opacity-50 transition-colors transition-opacity duration-150 hover:bg-neutral-100 hover:text-neutral-500 hover:opacity-100 active:cursor-grabbing"
      >
        <GripVerticalIcon className="h-5 w-5" />
      </button>
    </div>
  );
}

export default function DashboardTiles({ initialOrder }: { initialOrder: MenuKey[] }) {
  const [order, setOrder] = useState<MenuKey[]>(initialOrder);
  // Mêmes groupes que la barre du haut, chacun en section (voir groupMenuOrder).
  const groupes = useMemo(() => groupMenuOrder(order), [order]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = groupes.findIndex((g) => g.includes(active.id as MenuKey));
    const to = groupes.findIndex((g) => g.includes(over.id as MenuKey));
    // Une tuile se déplace à l'intérieur de son groupe, jamais vers un autre :
    // le regroupement prime sur l'ordre personnalisé (voir MENU_GROUPS).
    if (from === -1 || from !== to) return;
    const groupe = groupes[from];
    const moved = arrayMove(groupe, groupe.indexOf(active.id as MenuKey), groupe.indexOf(over.id as MenuKey));
    const next = groupes.flatMap((g, i) => (i === from ? moved : g));
    setOrder(next);
    // Diffuse le nouvel ordre pour que la nav (composant séparé, monté une
    // seule fois dans le layout) se resynchronise sans attendre un
    // rechargement complet de la page.
    window.dispatchEvent(new CustomEvent<MenuKey[]>("pico:menu-order-changed", { detail: next }));
    fetch("/api/profile/menu-order", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next }),
    }).catch(() => {
      // Best-effort : un échec réseau laisse l'ordre correct pour cette
      // session ; il sera simplement réécrit au prochain glisser-déposer.
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="space-y-8">
        {groupes.map((groupe) => (
          <section key={groupe.join("-")}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
              {menuGroupLabel(groupe)}
            </h2>
            <SortableContext items={groupe} strategy={rectSortingStrategy}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {groupe.map((key) => (
                  <SortableTile key={key} menuKey={key} />
                ))}
              </div>
            </SortableContext>
          </section>
        ))}
      </div>
    </DndContext>
  );
}
