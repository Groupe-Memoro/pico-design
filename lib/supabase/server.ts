import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { loadAppSettings, type SettingsScope } from "@/lib/appSettings";
import type { Database } from "../types";

// Client Supabase utilisé dans les Server Components / routes API,
// avec la clé "anon" — respecte les politiques RLS de l'utilisateur connecté.
export function createServerSupabaseClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Appelé depuis un Server Component sans possibilité d'écrire
            // des cookies — sans effet ici, le client navigateur
            // (createBrowserClient) gère lui-même le rafraîchissement et
            // l'écriture du cookie de session.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // idem
          }
        },
      },
    }
  );
}

// Protège une page (Server Component) contre l'accès sans connexion —
// remplace la vérification qui se faisait avant dans middleware.ts (retiré
// : le Routing Middleware de Vercel s'est révélé instable avec ce projet,
// sur les deux runtimes disponibles — voir l'historique de commits).
// À appeler en tout début de chaque page protégée.
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// Utilisateur connecté, lu UNE fois par requête (cache() de React : mémoïsé
// le temps du rendu serveur) — getUser() est un aller-retour vers Supabase
// Auth, et le layout, l'habillage et la page le demandaient chacun. Hors
// rendu React (routes API), cache() n'a pas d'effet : chaque appel relit.
export const getCurrentUser = cache(async () => {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

// Réglages d'un jeu, lus une fois par requête pour un (jeu, client) donné.
// Les arguments sont des primitives : cache() compare par identité, un client
// Supabase créé à chaque appel ne serait jamais « le même ». `admin` choisit
// la clé de service (visiteur public sans session, RLS fermée) plutôt que la
// session de l'utilisateur. Pas de cache entre requêtes : un enregistrement
// se voit tout de suite.
export const loadAppSettingsCached = cache((scope: SettingsScope, admin: boolean) =>
  loadAppSettings(admin ? createAdminSupabaseClient() : createServerSupabaseClient(), scope)
);

// Protège une page (Server Component) réservée aux administrateurs (ex.
// gestion des utilisateurs) — redirige les employés vers l'accueil.
export async function requireAdmin() {
  const user = await requireUser();
  const supabase = createServerSupabaseClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (profile?.role !== "admin") redirect("/");
  return user;
}

// Équivalent de `requireAdmin`, mais pour les routes API (`redirect()` n'y
// fonctionne pas comme dans les Server Components) : à chaque route
// réservée aux admins de vérifier `isAdmin` et retourner une réponse 401/403
// elle-même.
export async function getAuthorizedAdmin(supabase: ReturnType<typeof createServerSupabaseClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, isAdmin: false };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  return { user, isAdmin: profile?.role === "admin" };
}

// Client "admin" — utilise la clé service_role, réservé aux routes API
// serveur qui doivent écrire dans Storage/DB sans contrainte RLS
// (ex: enregistrer le PDF généré). Ne jamais importer côté client.
import { createClient as createRawClient } from "@supabase/supabase-js";

export function createAdminSupabaseClient() {
  return createRawClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
