"use client";

import { useEffect, useState } from "react";
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
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FilePenIcon, GripVerticalIcon, SpinnerIcon, TrashIcon } from "@/components/icons";

interface SortableItem {
  id: string;
  name: string;
  sort_order: number;
}

function SortableRow({
  item,
  editingId,
  editingName,
  busyId,
  onStartEdit,
  onEditingNameChange,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: {
  item: SortableItem;
  editingId: string | null;
  editingName: string;
  busyId: string | null;
  onStartEdit: (item: SortableItem) => void;
  onEditingNameChange: (value: string) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onDelete: (item: SortableItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const isEditing = editingId === item.id;
  const isBusy = busyId === item.id;

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-2 bg-surface p-3">
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Déplacer"
        className="flex h-7 w-7 shrink-0 touch-none cursor-grab items-center justify-center rounded text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500 active:cursor-grabbing"
      >
        <GripVerticalIcon className="h-4 w-4" />
      </button>
      {isEditing ? (
        <input
          autoFocus
          value={editingName}
          onChange={(e) => onEditingNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSaveEdit(item.id);
            if (e.key === "Escape") onCancelEdit();
          }}
          className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
        />
      ) : (
        <span className="flex-1 text-sm text-text">{item.name}</span>
      )}
      <div className="flex shrink-0 gap-1">
        {isEditing ? (
          <button
            onClick={() => onSaveEdit(item.id)}
            disabled={isBusy}
            title="Enregistrer"
            aria-label="Enregistrer"
            className="icon-btn disabled:opacity-50"
          >
            {isBusy ? (
              <SpinnerIcon className="h-4 w-4" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        ) : (
          <button
            onClick={() => onStartEdit(item)}
            title="Modifier"
            aria-label="Modifier"
            className="icon-btn"
          >
            <FilePenIcon className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => onDelete(item)}
          disabled={isBusy}
          title="Supprimer"
          aria-label="Supprimer"
          className="inline-flex rounded-lg p-1.5 text-neutral-500 hover:bg-danger-subtle hover:text-danger disabled:opacity-50"
        >
          {isBusy ? <SpinnerIcon className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
        </button>
      </div>
    </li>
  );
}

export default function CollectionsManager({
  items,
  apiBasePath,
  itemLabel = "collection",
  deleteWarning,
  onChanged,
}: {
  items: SortableItem[];
  apiBasePath: string;
  itemLabel?: string;
  deleteWarning?: string;
  onChanged: () => void;
}) {
  const [order, setOrder] = useState<SortableItem[]>(items);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resynchronise avec la liste du parent (après création/suppression, ou
  // rafraîchissement suite à un réordonnancement) sans perdre le tri en
  // cours si `items` n'a pas encore été mis à jour côté serveur.
  useEffect(() => {
    setOrder(items);
  }, [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((current) => {
      const oldIndex = current.findIndex((i) => i.id === active.id);
      const newIndex = current.findIndex((i) => i.id === over.id);
      const next = arrayMove(current, oldIndex, newIndex);
      fetch(`${apiBasePath}/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: next.map((i) => i.id) }),
      })
        .then((res) => {
          if (!res.ok) throw new Error();
          onChanged();
        })
        .catch(() => setError("Erreur lors de l'enregistrement de l'ordre."));
      return next;
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    const res = await fetch(apiBasePath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) {
      setError(data.error ?? "Erreur lors de la création.");
      return;
    }
    setNewName("");
    onChanged();
  }

  function startEdit(item: SortableItem) {
    setEditingId(item.id);
    setEditingName(item.name);
    setError(null);
  }

  async function saveEdit(id: string) {
    if (!editingName.trim()) return;
    setBusyId(id);
    setError(null);
    const res = await fetch(`${apiBasePath}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingName.trim() }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setError(data.error ?? "Erreur lors de l'enregistrement.");
      return;
    }
    setEditingId(null);
    onChanged();
  }

  async function handleDelete(item: SortableItem) {
    const warning = deleteWarning ? ` ${deleteWarning}` : "";
    if (!confirm(`Supprimer la ${itemLabel} « ${item.name} » ?${warning}`)) return;
    setBusyId(item.id);
    setError(null);
    const res = await fetch(`${apiBasePath}/${item.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      setError(data.error ?? "Erreur lors de la suppression.");
      return;
    }
    onChanged();
  }

  return (
    <div className="space-y-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
            {order.map((item) => (
              <SortableRow
                key={item.id}
                item={item}
                editingId={editingId}
                editingName={editingName}
                busyId={busyId}
                onStartEdit={startEdit}
                onEditingNameChange={setEditingName}
                onSaveEdit={saveEdit}
                onCancelEdit={() => setEditingId(null)}
                onDelete={handleDelete}
              />
            ))}
            {order.length === 0 && (
              <li className="p-3 text-sm text-neutral-500">Aucune {itemLabel} pour l&apos;instant.</li>
            )}
          </ul>
        </SortableContext>
      </DndContext>

      {error && <p className="text-sm text-danger">{error}</p>}

      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={`Nouvelle ${itemLabel}...`}
          className="flex-1 input"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="inline-flex items-center gap-2 btn-primary disabled:opacity-50"
        >
          {creating && <SpinnerIcon className="h-4 w-4" />}
          Ajouter
        </button>
      </form>
    </div>
  );
}
