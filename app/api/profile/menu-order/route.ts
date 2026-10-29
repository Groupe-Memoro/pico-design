import { requireApiUser, serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { MENU_ITEMS } from "@/lib/menuItems";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase, user } = session;

  const body = await request.json().catch(() => null);
  const order = Array.isArray(body?.order) ? body.order : null;
  if (!order || !order.every((k: unknown) => typeof k === "string" && k in MENU_ITEMS)) {
    return NextResponse.json({ error: "Ordre invalide." }, { status: 400 });
  }

  // Chacun ne peut modifier que son propre ordre — écrit via le client
  // admin (la table `profiles` n'a pas de politique RLS d'update), mais
  // restreint explicitement à `user.id`.
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("profiles").update({ menu_order: order }).eq("id", user.id);
  if (error) return serverError(error, "Impossible d'enregistrer l'ordre du menu.");

  return NextResponse.json({ success: true });
}
