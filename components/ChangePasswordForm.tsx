"use client";

import { useState } from "react";
import { PASSWORD_MIN_LENGTH, passwordStrength, validatePassword } from "@/lib/passwordPolicy";
import { SpinnerIcon } from "@/components/icons";

const STRENGTH_COLORS = ["bg-danger", "bg-danger", "bg-warning", "bg-emerald-500", "bg-emerald-600"];

export default function ChangePasswordForm({
  onSuccess,
  onBusyChange,
}: {
  onSuccess: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = passwordStrength(newPassword);
  // N'affiche l'erreur de robustesse qu'une fois la saisie commencée : pas
  // de message rouge dès l'ouverture du formulaire, sur un champ vide.
  const policyError = newPassword ? validatePassword(newPassword) : null;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (policyError || mismatch || !currentPassword) return;

    setSaving(true);
    onBusyChange?.(true);
    setError(null);
    const res = await fetch("/api/profile/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    onBusyChange?.(false);
    if (!res.ok) {
      setError(data.error ?? "Erreur lors du changement de mot de passe.");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium">Mot de passe actuel</label>
        <input
          type={showPasswords ? "text" : "password"}
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="mt-1 w-full input"
        />
      </div>
      <div>
        <label className="block text-sm font-medium">Nouveau mot de passe</label>
        <input
          type={showPasswords ? "text" : "password"}
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="mt-1 w-full input"
        />
        {newPassword && (
          <div className="mt-1.5">
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full ${
                    i < strength.score ? STRENGTH_COLORS[strength.score] : "bg-neutral-200"
                  }`}
                />
              ))}
            </div>
            <p
              className={`mt-1 text-xs ${policyError ? "text-danger" : "text-neutral-500"}`}
            >
              {policyError ?? `Robustesse : ${strength.label.toLowerCase()}`}
            </p>
          </div>
        )}
        {!newPassword && (
          <p className="mt-1 text-xs text-neutral-500">
            Au moins {PASSWORD_MIN_LENGTH} caractères, avec une majuscule, une minuscule et un chiffre.
          </p>
        )}
      </div>
      <div>
        <label className="block text-sm font-medium">Confirmer le nouveau mot de passe</label>
        <input
          type={showPasswords ? "text" : "password"}
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="mt-1 w-full input"
        />
        {mismatch && <p className="mt-1 text-xs text-danger">Les mots de passe ne correspondent pas.</p>}
      </div>
      <label className="flex items-center gap-2 text-xs text-neutral-600">
        <input type="checkbox" checked={showPasswords} onChange={(e) => setShowPasswords(e.target.checked)} />
        Afficher les mots de passe
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={saving || !currentPassword || !newPassword || Boolean(policyError) || mismatch}
        className="inline-flex items-center gap-2 btn-primary disabled:opacity-50"
      >
        {saving && <SpinnerIcon className="h-4 w-4" />}
        Changer le mot de passe
      </button>
    </form>
  );
}
