"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import UserForm from "@/components/UserForm";
import UpdatingBadge from "@/components/UpdatingBadge";
import { FilePenIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import type { Profile } from "@/lib/types";

export type ProfileWithEmail = Profile & { email: string };

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrateur",
  designer: "Designer",
  gestionnaire: "Gestionnaire",
  // Compat : anciennes lignes encore sur "employee" si la migration 0030
  // (renommage du rôle) n'a pas été exécutée en base.
  employee: "Designer",
};

type ModalState = { mode: "create" } | { mode: "edit"; user: ProfileWithEmail } | null;

export default function UsersTable({
  users,
  currentUserId,
}: {
  users: ProfileWithEmail[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => (u.full_name ?? "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [users, search]);

  function handleSuccess() {
    setModal(null);
    refresh();
  }

  async function handleDelete(u: ProfileWithEmail) {
    if (!confirm(`Supprimer le compte de « ${u.full_name || u.email} » ?`)) return;
    setDeletingId(u.id);
    const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    if (!res.ok) {
      setDeletingId(null);
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Erreur lors de la suppression.");
      return;
    }
    // Ne pas remettre `deletingId` à null ici : la ligne doit rester
    // grisée/en chargement jusqu'à sa disparition effective (données
    // rafraîchies), pas revenir à la normale juste avant de disparaître.
    refresh();
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-page-title font-semibold text-text">
            Utilisateurs
            <UpdatingBadge show={isPending} />
          </h1>
          <p className="text-sm text-neutral-500">
            {users.length} compte{users.length > 1 ? "s" : ""}.
          </p>
        </div>
        <button
          onClick={() => setModal({ mode: "create" })}
          className="flex items-center gap-2 btn-primary"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
          </svg>
          Nouvel utilisateur
        </button>
      </div>

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (nom, courriel)..."
          className="w-full max-w-xs input"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="card p-4 text-sm text-neutral-500">
          Aucun utilisateur ne correspond.
        </p>
      ) : (
        <div className="overflow-x-auto card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-sm font-semibold text-neutral-700">
                <th className="p-4">Nom</th>
                <th className="p-4">Courriel</th>
                <th className="p-4">Rôle</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                    <td className="p-4 font-semibold text-text">
                      {u.full_name || "—"}
                      {isSelf && <span className="ml-2 text-xs font-normal text-neutral-400">(vous)</span>}
                    </td>
                    <td className="p-4 text-neutral-700">{u.email}</td>
                    <td className="p-4 text-neutral-500">{ROLE_LABELS[u.role] ?? u.role}</td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setModal({ mode: "edit", user: u })}
                          title="Modifier"
                          aria-label="Modifier"
                          className="icon-btn"
                        >
                          <FilePenIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={isSelf || deletingId === u.id}
                          title={isSelf ? "Impossible de supprimer votre propre compte" : "Supprimer"}
                          aria-label="Supprimer"
                          className="inline-flex rounded-lg p-1.5 text-neutral-500 hover:bg-danger-subtle hover:text-danger disabled:opacity-30"
                        >
                          {deletingId === u.id ? (
                            <SpinnerIcon className="h-4 w-4" />
                          ) : (
                            <TrashIcon className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(modal?.mode === "create" || modal?.mode === "edit") && (
        <Modal
          title={
            modal.mode === "create"
              ? "Nouvel utilisateur"
              : `Modifier « ${modal.user.full_name || modal.user.email} »`
          }
          onClose={() => setModal(null)}
          busy={formBusy}
        >
          <UserForm
            user={modal.mode === "edit" ? modal.user : undefined}
            currentUserId={currentUserId}
            onSuccess={handleSuccess}
            onBusyChange={setFormBusy}
          />
        </Modal>
      )}
    </div>
  );
}
