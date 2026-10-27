"use client";

import { useState } from "react";
import MeasureField, { UnitToggle, type Unit } from "@/components/MeasureField";
import { RowActions, SubmitButton } from "@/components/ImpositionPresets";
import { sheetLabel } from "@/lib/imposition/presets";
import { MAX_GRID } from "@/lib/imposition/cutters";
import type { ImpositionCutter, ImpositionSheet } from "@/lib/types";

const inputClass = "mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm";
const labelClass = "block text-xs font-medium text-neutral-500";

// Un fichier du profil : celui déjà enregistré (qu'on peut retirer) ou un nouveau à envoyer.
function AssetField({
  label,
  help,
  hasCurrent,
  file,
  remove,
  onFile,
  onRemove,
}: {
  label: string;
  help: string;
  hasCurrent: boolean;
  file: File | null;
  remove: boolean;
  onFile: (file: File | null) => void;
  onRemove: (remove: boolean) => void;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <p className="mt-0.5 text-xs text-neutral-400">{help}</p>
      {hasCurrent && !file && (
        <label className="mt-1.5 flex items-center gap-2 text-xs text-neutral-600">
          <span className={remove ? "line-through" : ""}>Fichier enregistré</span>
          <input type="checkbox" checked={remove} onChange={(e) => onRemove(e.target.checked)} />
          Retirer
        </label>
      )}
      <input
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        className="mt-1.5 block w-full text-sm"
      />
    </div>
  );
}

function ProfileForm({
  profile,
  sheets,
  onSuccess,
  onCancel,
}: {
  profile?: ImpositionCutter;
  sheets: ImpositionSheet[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [sheetId, setSheetId] = useState(
    profile?.sheet_id && sheets.some((s) => s.id === profile.sheet_id) ? profile.sheet_id : (sheets[0]?.id ?? "")
  );
  const [cols, setCols] = useState(profile?.grid_cols ?? 2);
  const [rows, setRows] = useState(profile?.grid_rows ?? 5);
  const [unit, setUnit] = useState<Unit>("in");
  const [margins, setMargins] = useState({
    top: profile?.margin_top_mm ?? 12.7,
    right: profile?.margin_right_mm ?? 12.7,
    bottom: profile?.margin_bottom_mm ?? 12.7,
    left: profile?.margin_left_mm ?? 12.7,
  });
  const [gutterX, setGutterX] = useState(profile?.gutter_x_mm ?? 3.175);
  const [gutterY, setGutterY] = useState(profile?.gutter_y_mm ?? 3.175);
  const [offsetX, setOffsetX] = useState(profile?.offset_x_mm ?? 0);
  const [offsetY, setOffsetY] = useState(profile?.offset_y_mm ?? 0);
  const [centerGrid, setCenterGrid] = useState(profile?.center_grid ?? false);
  const [marksFile, setMarksFile] = useState<File | null>(null);
  const [guideFile, setGuideFile] = useState<File | null>(null);
  const [removeMarks, setRemoveMarks] = useState(false);
  const [removeGuide, setRemoveGuide] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const body = new FormData();
    body.append("name", name);
    body.append("sheet_id", sheetId);
    body.append("grid_cols", String(cols));
    body.append("grid_rows", String(rows));
    body.append("margin_top_mm", String(margins.top));
    body.append("margin_right_mm", String(margins.right));
    body.append("margin_bottom_mm", String(margins.bottom));
    body.append("margin_left_mm", String(margins.left));
    body.append("gutter_x_mm", String(gutterX));
    body.append("gutter_y_mm", String(gutterY));
    body.append("offset_x_mm", String(offsetX));
    body.append("offset_y_mm", String(offsetY));
    body.append("center_grid", String(centerGrid));
    if (marksFile) body.append("marks", marksFile);
    else if (removeMarks) body.append("remove_marks", "true");
    if (guideFile) body.append("guide", guideFile);
    else if (removeGuide) body.append("remove_guide", "true");

    const res = await fetch(profile ? `/api/imposition/cutters/${profile.id}` : "/api/imposition/cutters", {
      method: profile ? "PATCH" : "POST",
      body,
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Erreur lors de l'enregistrement.");
      return;
    }
    onSuccess();
  }

  const count = (value: number, set: (n: number) => void, label: string) => (
    <div>
      <label className={labelClass}>{label}</label>
      <input
        type="number"
        min={1}
        max={MAX_GRID}
        step={1}
        value={value}
        onChange={(e) => set(Math.min(MAX_GRID, Math.max(1, Math.floor(Number(e.target.value)) || 1)))}
        className={inputClass}
      />
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Nom du profil</label>
          <input
            type="text"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex. Cartes d'affaires 2 × 5"
            className={inputClass}
            required
          />
        </div>
        <div>
          <label className={labelClass}>Format du papier</label>
          <select value={sheetId} onChange={(e) => setSheetId(e.target.value)} className={inputClass} required>
            {sheets.length === 0 && <option value="">— Créez d&apos;abord une feuille —</option>}
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {sheetLabel(s.width_mm, s.height_mm)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium">Nombre de fichiers</p>
        <div className="mt-2 grid grid-cols-3 items-end gap-3">
          {count(cols, setCols, "Colonnes")}
          {count(rows, setRows, "Rangées")}
          <p className="pb-2 text-sm text-neutral-600">
            = <strong>{cols * rows}</strong> pièce{cols * rows > 1 ? "s" : ""} par feuille
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Marges et espacements</span>
          <UnitToggle unit={unit} onChange={setUnit} />
        </div>
        <div className="grid grid-cols-4 gap-3">
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <MeasureField
              key={`m-${side}-${unit}`}
              label={{ top: "Marge haut", right: "Marge droite", bottom: "Marge bas", left: "Marge gauche" }[side]}
              valueMm={margins[side]}
              unit={unit}
              onChange={(mm) => setMargins((m) => ({ ...m, [side]: mm }))}
            />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-3">
          <MeasureField key={`gx-${unit}`} label="Espacement horiz." valueMm={gutterX} unit={unit} onChange={setGutterX} />
          <MeasureField key={`gy-${unit}`} label="Espacement vert." valueMm={gutterY} unit={unit} onChange={setGutterY} />
          <MeasureField
            key={`ox-${unit}`}
            label="Calibration X"
            valueMm={offsetX}
            unit={unit}
            onChange={setOffsetX}
            allowNegative
          />
          <MeasureField
            key={`oy-${unit}`}
            label="Calibration Y"
            valueMm={offsetY}
            unit={unit}
            onChange={setOffsetY}
            allowNegative
          />
        </div>
        <p className="text-xs text-neutral-400">
          Marges et espacement se mesurent depuis la pièce finie (le trait de coupe), fond perdu exclu : le fond
          perdu déborde dans l&apos;espacement, et deux pièces voisines se partagent un espacement trop étroit à
          parts égales. La calibration décale toute la grille (positif = vers la droite / vers le bas) pour
          compenser l&apos;écart de la Graphtec.
        </p>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={centerGrid} onChange={(e) => setCenterGrid(e.target.checked)} />
          Centrer la grille dans la zone utile (sinon, collée aux marges haut et gauche)
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-neutral-100 pt-4">
        <AssetField
          label="Image des codes et marques"
          help="PDF ou image de la taille de la feuille. Imprimée au recto, sous les pièces."
          hasCurrent={Boolean(profile?.marks_path)}
          file={marksFile}
          remove={removeMarks}
          onFile={setMarksFile}
          onRemove={setRemoveMarks}
        />
        <AssetField
          label="Gabarit de guidage"
          help="PDF ou image de la taille de la feuille. Affiché dans l'aperçu seulement, jamais imprimé."
          hasCurrent={Boolean(profile?.guide_path)}
          file={guideFile}
          remove={removeGuide}
          onFile={setGuideFile}
          onRemove={setRemoveGuide}
        />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary"
        >
          Annuler
        </button>
        <SubmitButton loading={loading}>{profile ? "Enregistrer" : "Créer le profil"}</SubmitButton>
      </div>
    </form>
  );
}

// Profils de découpe de la Graphtec : création, modification, suppression.
export default function GraphtecProfilesManager({
  profiles,
  sheets,
  onChanged,
}: {
  profiles: ImpositionCutter[];
  sheets: ImpositionSheet[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<ImpositionCutter | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(profile: ImpositionCutter) {
    if (!confirm(`Supprimer le profil « ${profile.name} » ?`)) return;
    setDeletingId(profile.id);
    const res = await fetch(`/api/imposition/cutters/${profile.id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "La suppression a échoué.");
      return;
    }
    onChanged();
  }

  if (editing) {
    return (
      <ProfileForm
        profile={editing === "new" ? undefined : editing}
        sheets={sheets}
        onCancel={() => setEditing(null)}
        onSuccess={() => {
          setEditing(null);
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {profiles.length === 0 && <p className="text-sm text-neutral-500">Aucun profil pour l&apos;instant.</p>}
      <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
        {profiles.map((p) => {
          const sheet = sheets.find((s) => s.id === p.sheet_id);
          return (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className={`text-xs ${sheet ? "text-neutral-500" : "text-danger"}`}>
                  {sheet ? sheetLabel(sheet.width_mm, sheet.height_mm) : "Format du papier à choisir"} · {p.grid_cols} ×{" "}
                  {p.grid_rows} pièces
                  {p.marks_path ? " · marques" : ""}
                  {p.guide_path ? " · gabarit" : ""}
                </p>
              </div>
              <RowActions onEdit={() => setEditing(p)} onDelete={() => handleDelete(p)} busy={deletingId === p.id} />
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => setEditing("new")}
        className="w-full btn-secondary border-dashed"
      >
        + Nouveau profil
      </button>
    </div>
  );
}
