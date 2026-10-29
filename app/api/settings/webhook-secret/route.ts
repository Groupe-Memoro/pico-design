import { serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient, createServerSupabaseClient, getAuthorizedAdmin } from "@/lib/supabase/server";
import { isShopScope } from "@/lib/appSettings";

export const runtime = "nodejs";

/**
 * Secret de signature des webhooks de commande d'une boutique (voir
 * supabase/migrations/0065_shop_webhook_secrets.sql). Réservé aux
 * administrateurs, et en écriture seulement : la valeur n'est jamais
 * renvoyée, pas même à eux. L'écran ne sait que si elle est configurée.
 */
async function guard(): Promise<{ userId: string } | NextResponse> {
  const { user, isAdmin } = await getAuthorizedAdmin(createServerSupabaseClient());
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  return { userId: user.id };
}

function shopOf(value: unknown): string | null {
  const shop = String(value ?? "").trim().toLowerCase();
  return isShopScope(shop) ? shop : null;
}

// Enregistre (ou remplace) le secret d'une boutique.
export async function PUT(request: Request) {
  const auth = await guard();
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => ({}))) as { shop?: unknown; secret?: unknown };
  const shop = shopOf(body.shop);
  if (!shop) return NextResponse.json({ error: "Domaine de boutique invalide." }, { status: 400 });
  // Collé depuis Shopify : on retire les espaces et retours à la ligne autour,
  // qui feraient échouer toutes les signatures sans que rien ne le montre.
  const secret = String(body.secret ?? "").trim();
  if (!secret || secret.length > 200) {
    return NextResponse.json({ error: "Collez la clé de signature affichée par Shopify." }, { status: 400 });
  }

  const { error } = await createAdminSupabaseClient()
    .from("shop_webhook_secrets")
    .upsert({ shop_domain: shop, secret, updated_at: new Date().toISOString(), updated_by: auth.userId });
  if (error) return serverError(error, "Impossible d'enregistrer le secret du webhook.");
  return NextResponse.json({ ok: true });
}

// Retire le secret d'une boutique : ses webhooks seront refusés.
export async function DELETE(request: Request) {
  const auth = await guard();
  if (auth instanceof NextResponse) return auth;

  const shop = shopOf(new URL(request.url).searchParams.get("shop"));
  if (!shop) return NextResponse.json({ error: "Domaine de boutique invalide." }, { status: 400 });
  const { error } = await createAdminSupabaseClient().from("shop_webhook_secrets").delete().eq("shop_domain", shop);
  if (error) return serverError(error, "Impossible d'enregistrer le secret du webhook.");
  return NextResponse.json({ ok: true });
}
