import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

/**
 * Limitation de débit des routes publiques (voir
 * supabase/migrations/0056_rate_limits.sql).
 *
 * Ces routes sont joignables sans compte depuis l'ouverture du lien Shopify,
 * et composent des images lourdes. Les plafonds ci-dessous visent un usage
 * humain normal : un client qui prépare un visuel regarde beaucoup d'aperçus,
 * mais ne télécharge qu'une poignée de PDF.
 *
 * Les utilisateurs CONNECTÉS ne sont jamais limités : c'est le public qu'on
 * protège, pas l'équipe.
 */

const LIMITS = {
  // Le plus coûteux : pleine résolution, recto et verso.
  pdf: { max: 20, windowSeconds: 3600 },
  // Enregistrement d'un design : écrit en base et dans le stockage.
  submit: { max: 20, windowSeconds: 3600 },
  // Aperçus : nombreux par nature, mais plus légers.
  mockup: { max: 200, windowSeconds: 3600 },
  preview: { max: 400, windowSeconds: 3600 },
  // Adresses d'envoi direct au stockage (voir app/api/design/stage) : un
  // appel par lot de fichiers, chaque fichier n'étant déposé qu'une fois.
  // Relevé pour l'impression de photos : une commande de plusieurs centaines
  // de tirages dépose une photo (et son aperçu) par appel.
  stage: { max: 1000, windowSeconds: 3600 },
  // Impression de photos : chaque photo d'un lot est un design enregistré.
  photos: { max: 1000, windowSeconds: 3600 },
} as const;

export type LimitBucket = keyof typeof LIMITS;

/**
 * Adresse du demandeur. Derrière Vercel, l'adresse réelle est en tête de
 * `x-forwarded-for` ; la connexion elle-même vient toujours du proxy.
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "inconnue";
}

/**
 * Compte un appel et dit s'il dépasse le plafond.
 *
 * En cas de panne du compteur, on LAISSE PASSER : un limiteur en échec ne
 * doit pas fermer l'outil à des clients légitimes. Le risque inverse — une
 * rafale non comptée pendant une panne de base — est le moindre des deux,
 * d'autant que la base est justement ce dont le reste du parcours dépend.
 */
export async function checkRateLimit(
  bucket: LimitBucket,
  request: Request,
): Promise<{ allowed: boolean; count: number; max: number }> {
  const { max, windowSeconds } = LIMITS[bucket];
  const key = `${bucket}:${clientIp(request)}`;

  try {
    const { data, error } = await createAdminSupabaseClient().rpc(
      "bump_rate_limit",
      {
        p_key: key,
        p_window_seconds: windowSeconds,
      },
    );
    if (error) return { allowed: true, count: 0, max };
    const count = Number(data) || 0;
    return { allowed: count <= max, count, max };
  } catch {
    return { allowed: true, count: 0, max };
  }
}

/** Réponse 429 normalisée, avec le délai d'attente. */
export function tooManyRequests(bucket: LimitBucket): NextResponse {
  const minutes = Math.ceil(LIMITS[bucket].windowSeconds / 60);
  return NextResponse.json(
    { error: `Trop de demandes. Réessaie dans ${minutes} minutes.` },
    {
      status: 429,
      headers: { "Retry-After": String(LIMITS[bucket].windowSeconds) },
    },
  );
}
