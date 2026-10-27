"use client";

import { useEffect, useState } from "react";
import type { Profile } from "@/lib/types";
import { CopyIcon, SpinnerIcon } from "@/components/icons";
import { PASSWORD_MIN_LENGTH, generateSecurePassword, validatePassword } from "@/lib/passwordPolicy";

export default function UserForm({
  user,
  currentUserId,
  onSuccess,
  onBusyChange,
}: {
  user?: Profile & { email: string };
  currentUserId: string;
  onSuccess: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const isEditing = Boolean(user);
  const isSelf = user?.id === currentUserId;
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<"admin" | "designer" | "gestionnaire">(user?.role ?? "designer");
  const [password, setPassword] = useState(isEditing ? "" : generateSecurePassword());
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const passwordError = password ? validatePassword(password) : null;

  useEffect(() => {
    onBusyChange?.(saving);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Presse-papiers indisponible (permissions navigateur) — sans
      // conséquence, l'admin peut toujours sélectionner/copier manuellement.
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = { fullName, role, email };
    if (password) body.password = password;

    const res = await fetch(isEditing ? `/api/users/${user!.id}` : "/api/users", {
      method: isEditing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erreur lors de l'enregistrement.");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium">Nom complet</label>
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-1 w-full input"
        />
      </div>
      <div>
        <label className="block text-sm font-medium">Courriel</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full input"
        />
      </div>
      <div>
        <label className="block text-sm font-medium">Rôle</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "designer" | "gestionnaire")}
          disabled={isSelf}
          className="mt-1 w-full input disabled:bg-neutral-100"
        >
          <option value="designer">Designer</option>
          <option value="gestionnaire">Gestionnaire</option>
          <option value="admin">Administrateur</option>
        </select>
        {isSelf && (
          <p className="mt-1 text-xs text-neutral-500">Vous ne pouvez pas modifier votre propre rôle.</p>
        )}
      </div>
      <div>
        <label className="block text-sm font-medium">
          {isEditing ? "Nouveau mot de passe (optionnel)" : "Mot de passe"}
        </label>
        <div className="mt-1 flex gap-2">
          <input
            type={showPassword ? "text" : "password"}
            required={!isEditing}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isEditing ? "Laisser vide pour ne pas changer" : undefined}
            className="w-full input"
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            {showPassword ? "Masquer" : "Afficher"}
          </button>
          <button
            type="button"
            onClick={() => setPassword(generateSecurePassword())}
            className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            Générer
          </button>
          {password && (
            <button
              type="button"
              onClick={handleCopy}
              title="Copier"
              aria-label="Copier"
              className="shrink-0 rounded-lg border border-neutral-300 p-2 text-neutral-600 hover:bg-neutral-50"
            >
              <CopyIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        {copied && <p className="mt-1 text-xs text-success-strong">Copié.</p>}
        {password && passwordError ? (
          <p className="mt-1 text-xs text-danger">{passwordError}</p>
        ) : (
          <p className="mt-1 text-xs text-neutral-500">
            {!isEditing
              ? "Communiquez ce mot de passe à l'employé — il ne sera plus affiché après la création."
              : `Au moins ${PASSWORD_MIN_LENGTH} caractères, avec une majuscule, une minuscule et un chiffre.`}
          </p>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={saving || Boolean(password && passwordError)}
        className="inline-flex items-center gap-2 btn-primary disabled:opacity-50"
      >
        {saving && <SpinnerIcon className="h-4 w-4" />}
        {isEditing ? "Enregistrer" : "Créer le compte"}
      </button>
    </form>
  );
}
