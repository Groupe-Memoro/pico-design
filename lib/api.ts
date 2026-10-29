import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Outils partagés par les routes API. Le middleware ne vérifie pas la
// session : chaque route doit le faire elle-même (requireApiUser).

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Erreur de la base ou du stockage : le détail (noms de tables, colonnes,
// contraintes) part dans les journaux du serveur, le client reçoit un
// message générique.
export function serverError(error: unknown, message = "Erreur serveur.", status = 500) {
  console.error(message, error);
  return jsonError(message, status);
}

// Client de la session, ou null si personne n'est connecté.
export async function sessionClient() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}

// Client de la session, ou la réponse 401 à renvoyer telle quelle :
//   const session = await requireApiUser();
//   if (session instanceof NextResponse) return session;
export async function requireApiUser() {
  return (await sessionClient()) ?? jsonError("Non authentifié.", 401);
}

// Corps JSON de la requête, ou {} s'il est absent ou invalide : la
// validation des champs qui suit renvoie alors un 400 plutôt qu'un 500.
export async function readJson<T extends object = Record<string, unknown>>(request: Request): Promise<Partial<T>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Partial<T>) : {};
  } catch {
    return {};
  }
}
