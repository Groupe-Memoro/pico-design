import { NextResponse } from "next/server";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { ALBUMS_BUCKET, albumSettings, pageContent, type Album, type AlbumPage, type AlbumStudent } from "./types";

// Outils serveur du module Albums, partagés par ses routes et sa page.

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Client de la session, ou null si personne n'est connecté.
export async function sessionClient() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}

export function albumStorage() {
  return createAdminSupabaseClient().storage.from(ALBUMS_BUCKET);
}

// Les fichiers d'un album vivent sous <albumId>/ : un chemin reçu du
// navigateur doit y être, sans quoi il pointerait vers un autre album.
export function isAlbumPath(albumId: string, path: unknown): path is string {
  return typeof path === "string" && path.startsWith(`${albumId}/`) && !path.includes("..");
}

// Vignette (écran) d'une photo d'impression : même nom, autre dossier.
export function thumbPathOf(photoPath: string): string {
  return photoPath.replace("/photos/", "/thumbs/");
}

type Supabase = ReturnType<typeof createServerSupabaseClient>;

export async function loadAlbum(supabase: Supabase, id: string) {
  const [{ data: album }, { data: students }, { data: pages }] = await Promise.all([
    supabase.from("albums").select("*").eq("id", id).maybeSingle(),
    supabase.from("album_students").select("*").eq("album_id", id),
    supabase.from("album_pages").select("*").eq("album_id", id).order("position", { ascending: true }),
  ]);
  if (!album) return null;
  return {
    album: { ...(album as Album), settings: albumSettings((album as Album).settings) } as Album,
    students: (students as AlbumStudent[]) ?? [],
    pages: ((pages as AlbumPage[]) ?? []).map((p) => ({ ...p, content: pageContent(p.kind, p.content) })),
  };
}

// L'album a changé : sa date sert à signaler un PDF devenu ancien.
export async function touchAlbum(supabase: Supabase, id: string) {
  await supabase.from("albums").update({ updated_at: new Date().toISOString() }).eq("id", id);
}

// Supprime des fichiers de l'album (photo et sa vignette), sans faire échouer
// l'appelant : un fichier orphelin ne gêne personne.
export async function removeAlbumFiles(paths: (string | null | undefined)[]) {
  const all = paths.filter((p): p is string => Boolean(p)).flatMap((p) => (p.includes("/photos/") ? [p, thumbPathOf(p)] : [p]));
  if (all.length > 0) await albumStorage().remove(all).catch(() => undefined);
}
