"use client";

import { useMemo, useRef, useState } from "react";
import Modal from "@/components/Modal";
import { FilePenIcon, SpinnerIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { readSheet } from "@/lib/albums/sheet";
import { matchPhotos, studentsFromRows, type ImportedStudent } from "@/lib/albums/match";
import { ACCEPTED_PHOTO_TYPES, PORTRAIT_MAX_PX, uploadAlbumPhotos } from "@/lib/albums/upload";
import { sortStudents, type AlbumStudent } from "@/lib/albums/types";

const inputClass = "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm";

async function postStudents(albumId: string, body: unknown) {
  const res = await fetch(`/api/albums/${albumId}/students`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Enregistrement impossible.");
}

/**
 * Import : une liste (Excel ou CSV) et/ou des photos. Avec une liste, chaque
 * photo est associée à son élève par son nom de fichier ; sans liste, les
 * photos vont aux élèves déjà dans l'album qui portent ce nom.
 */
function ImportForm({ albumId, existing, onDone }: { albumId: string; existing: AlbumStudent[]; onDone: () => void }) {
  const [rows, setRows] = useState<ImportedStudent[] | null>(null);
  const [listName, setListName] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function chooseList(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const { students, columns } = studentsFromRows(await readSheet(file));
      if (students.length === 0) throw new Error("Aucun élève trouvé : la première ligne doit nommer les colonnes (Prénom, Nom, Groupe…).");
      if (!columns.includes("last_name") && !columns.includes("first_name")) {
        throw new Error("Colonnes Prénom / Nom introuvables dans la première ligne.");
      }
      setRows(students);
      setListName(file.name);
    } catch (err) {
      setRows(null);
      setError(err instanceof Error ? err.message : "Liste illisible.");
    }
  }

  // Avec une liste : on associe à ses lignes. Sans : aux élèves de l'album.
  const targets = useMemo(() => rows ?? existing.map((s) => ({ ...s, photo: "" })), [rows, existing]);
  const match = useMemo(() => matchPhotos(targets, photos.map((f) => f.name)), [targets, photos]);
  const withPhoto = match.fileOf.filter((i) => i >= 0).length;

  async function run() {
    setError(null);
    try {
      const used = match.fileOf.filter((i) => i >= 0);
      const files = used.map((i) => photos[i]);
      setBusy(files.length ? `Envoi des photos 0 / ${files.length}` : "Enregistrement…");
      const uploaded = files.length
        ? await uploadAlbumPhotos(albumId, files, PORTRAIT_MAX_PX, (d, t) => setBusy(`Envoi des photos ${d} / ${t}`))
        : [];
      const pathOfFile = new Map(used.map((fileIndex, k) => [fileIndex, uploaded[k]?.photoPath ?? null]));
      setBusy("Enregistrement…");
      if (rows) {
        await postStudents(albumId, {
          replace,
          students: rows.map((s, i) => ({ ...s, photo_path: match.fileOf[i] >= 0 ? pathOfFile.get(match.fileOf[i]) : null })),
        });
      } else {
        const map: Record<string, string> = {};
        existing.forEach((s, i) => {
          const path = match.fileOf[i] >= 0 ? pathOfFile.get(match.fileOf[i]) : null;
          if (path) map[s.id] = path;
        });
        await postStudents(albumId, { photos: map });
      }
      const failed = uploaded.filter((u) => u.error).length;
      if (failed) alert(`${failed} photo(s) n'ont pas pu être envoyées : ces élèves restent sans photo.`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import impossible.");
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block cursor-pointer rounded-xl border border-dashed border-neutral-300 p-4 text-center hover:bg-neutral-50">
          <UploadIcon className="mx-auto h-5 w-5 text-neutral-500" />
          <span className="mt-1 block text-sm font-medium">Liste des élèves</span>
          <span className="block text-xs text-neutral-500">{listName || "Excel (.xlsx) ou CSV"}</span>
          <input type="file" accept=".xlsx,.csv,.txt,text/csv" className="hidden" onChange={(e) => chooseList(e.target.files?.[0])} />
        </label>
        <label className="block cursor-pointer rounded-xl border border-dashed border-neutral-300 p-4 text-center hover:bg-neutral-50">
          <UploadIcon className="mx-auto h-5 w-5 text-neutral-500" />
          <span className="mt-1 block text-sm font-medium">Photos</span>
          <span className="block text-xs text-neutral-500">
            {photos.length ? `${photos.length} photo${photos.length > 1 ? "s" : ""}` : "JPEG, PNG ou WebP — plusieurs à la fois"}
          </span>
          <input type="file" accept={ACCEPTED_PHOTO_TYPES} multiple className="hidden" onChange={(e) => setPhotos(Array.from(e.target.files ?? []))} />
        </label>
      </div>
      <p className="text-xs text-neutral-500">
        Première ligne de la liste : les noms de colonnes — <strong>Prénom</strong>, <strong>Nom</strong>,{" "}
        <strong>Groupe</strong>, et au besoin <strong>Photo</strong> (nom du fichier). Sans colonne Photo, chaque photo doit
        porter le nom de l&apos;élève (<em>Tremblay_Julie.jpg</em>, l&apos;ordre ne compte pas).
      </p>

      {(rows || photos.length > 0) && (
        <div className="rounded-lg bg-neutral-50 p-3 text-sm">
          {rows ? (
            <p>
              <strong>{rows.length}</strong> élève{rows.length > 1 ? "s" : ""} dans la liste
              {photos.length > 0 && (
                <>
                  {" "}· <strong>{withPhoto}</strong> avec photo · <strong>{rows.length - withPhoto}</strong> sans photo
                </>
              )}
              .
            </p>
          ) : (
            <p>
              Photos seules : <strong>{withPhoto}</strong> associée{withPhoto > 1 ? "s" : ""} à des élèves de l&apos;album.
            </p>
          )}
          {match.unmatched.length > 0 && photos.length > 0 && (
            <p className="mt-1 text-warning-strong">
              {match.unmatched.length} photo{match.unmatched.length > 1 ? "s" : ""} sans élève :{" "}
              {match.unmatched.slice(0, 8).map((i) => photos[i].name).join(", ")}
              {match.unmatched.length > 8 ? "…" : ""}
            </p>
          )}
          {rows && photos.length > 0 && rows.length - withPhoto > 0 && (
            <p className="mt-1 text-neutral-600">
              Sans photo :{" "}
              {rows
                .filter((_, i) => match.fileOf[i] < 0)
                .slice(0, 8)
                .map((s) => `${s.first_name} ${s.last_name}`.trim())
                .join(", ")}
              {rows.length - withPhoto > 8 ? "…" : ""}
            </p>
          )}
          {rows && existing.length > 0 && (
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              Remplacer les {existing.length} élèves déjà dans l&apos;album (sinon, la liste s&apos;ajoute)
            </label>
          )}
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={run}
          disabled={Boolean(busy) || (!rows && withPhoto === 0)}
          className="flex items-center gap-2 btn-primary disabled:opacity-50"
        >
          {busy && <SpinnerIcon className="h-4 w-4" />}
          {busy ?? "Importer"}
        </button>
      </div>
    </div>
  );
}

function StudentForm({
  albumId,
  student,
  groups,
  onDone,
}: {
  albumId: string;
  student: AlbumStudent | null;
  groups: string[];
  onDone: () => void;
}) {
  const [first, setFirst] = useState(student?.first_name ?? "");
  const [last, setLast] = useState(student?.last_name ?? "");
  const [group, setGroup] = useState(student?.group_name ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let photoPath: string | undefined;
      if (photo) {
        const [up] = await uploadAlbumPhotos(albumId, [photo], PORTRAIT_MAX_PX);
        if (!up.photoPath) throw new Error(up.error ?? "Envoi de la photo impossible.");
        photoPath = up.photoPath;
      }
      const fields = { first_name: first, last_name: last, group_name: group };
      if (student) {
        const res = await fetch(`/api/albums/${albumId}/students/${student.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(photoPath ? { ...fields, photo_path: photoPath } : fields),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Enregistrement impossible.");
      } else {
        await postStudents(albumId, { students: [{ ...fields, photo_path: photoPath ?? null }] });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium">Prénom</label>
          <input value={first} onChange={(e) => setFirst(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium">Nom</label>
          <input value={last} onChange={(e) => setLast(e.target.value)} className={inputClass} />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium">Groupe</label>
        <input value={group} onChange={(e) => setGroup(e.target.value)} list="album-groups" className={inputClass} />
        <datalist id="album-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </div>
      <div>
        <label className="block text-sm font-medium">{student?.photo_path ? "Remplacer la photo" : "Photo"}</label>
        <input type="file" accept={ACCEPTED_PHOTO_TYPES} onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy || (!first.trim() && !last.trim())}
          className="flex items-center gap-2 btn-primary disabled:opacity-50"
        >
          {busy && <SpinnerIcon className="h-4 w-4" />}
          Enregistrer
        </button>
      </div>
    </form>
  );
}

export default function AlbumStudentsPanel({
  albumId,
  students,
  thumbs,
  onChanged,
}: {
  albumId: string;
  students: AlbumStudent[];
  thumbs: Record<string, string>;
  onChanged: () => void;
}) {
  const [modal, setModal] = useState<{ mode: "import" } | { mode: "edit"; student: AlbumStudent | null } | null>(null);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const deletingRef = useRef(false);

  const groups = useMemo(() => [...new Set(students.map((s) => s.group_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")), [students]);
  const sorted = useMemo(() => sortStudents(students), [students]);
  const q = search.trim().toLowerCase();
  const visible = q ? sorted.filter((s) => `${s.first_name} ${s.last_name} ${s.group_name}`.toLowerCase().includes(q)) : sorted;
  const missing = students.filter((s) => !s.photo_path).length;

  async function remove(student: AlbumStudent) {
    if (deletingRef.current || !confirm(`Retirer ${student.first_name} ${student.last_name} de l'album ?`)) return;
    deletingRef.current = true;
    setDeleting(student.id);
    await fetch(`/api/albums/${albumId}/students/${student.id}`, { method: "DELETE" });
    deletingRef.current = false;
    setDeleting(null);
    onChanged();
  }

  function done() {
    setModal(null);
    onChanged();
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-neutral-600">
            {students.length} finissant{students.length > 1 ? "s" : ""}
            {groups.length > 0 && ` · ${groups.length} groupe${groups.length > 1 ? "s" : ""}`}
            {missing > 0 && <span className="text-warning-strong"> · {missing} sans photo</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="w-full input sm:w-48"
          />
          <button
            type="button"
            onClick={() => setModal({ mode: "edit", student: null })}
            className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
          >
            Ajouter un élève
          </button>
          <button
            type="button"
            onClick={() => setModal({ mode: "import" })}
            className="shrink-0 rounded-lg bg-pico-maroon px-3 py-2 text-sm font-medium text-white hover:bg-pico-maroon-dark"
          >
            Importer liste / photos
          </button>
        </div>
      </div>

      {students.length === 0 ? (
        <p className="card p-6 text-center text-sm text-neutral-500">
          Aucun finissant. Importez la liste de l&apos;école (Excel ou CSV) et le dossier de photos.
        </p>
      ) : (
        <div className="overflow-hidden card">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                <th className="w-14 px-3 py-2">Photo</th>
                <th className="px-3 py-2">Prénom</th>
                <th className="px-3 py-2">Nom</th>
                <th className="px-3 py-2">Groupe</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.id} className={`border-t border-neutral-100 ${deleting === s.id ? "opacity-40" : ""}`}>
                  <td className="px-3 py-1.5">
                    {s.photo_path && thumbs[s.photo_path] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbs[s.photo_path]} alt="" className="h-12 w-10 rounded object-cover object-top" />
                    ) : (
                      <div className="flex h-12 w-10 items-center justify-center rounded bg-neutral-100 text-[10px] text-neutral-400">aucune</div>
                    )}
                  </td>
                  <td className="px-3 py-1.5">{s.first_name}</td>
                  <td className="px-3 py-1.5">{s.last_name}</td>
                  <td className="px-3 py-1.5 text-neutral-600">{s.group_name}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => setModal({ mode: "edit", student: s })}
                      title="Modifier"
                      aria-label="Modifier"
                      className="icon-btn"
                    >
                      <FilePenIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(s)}
                      title="Retirer"
                      aria-label="Retirer"
                      className="rounded-lg p-1.5 text-neutral-500 hover:bg-danger-subtle hover:text-danger"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.mode === "import" && (
        <Modal title="Importer la liste et les photos" onClose={() => setModal(null)} wide>
          <ImportForm albumId={albumId} existing={students} onDone={done} />
        </Modal>
      )}
      {modal?.mode === "edit" && (
        <Modal title={modal.student ? "Modifier l'élève" : "Ajouter un élève"} onClose={() => setModal(null)}>
          <StudentForm albumId={albumId} student={modal.student} groups={groups} onDone={done} />
        </Modal>
      )}
    </div>
  );
}
