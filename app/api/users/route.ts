import { serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { createServerSupabaseClient, createAdminSupabaseClient, getAuthorizedAdmin } from "@/lib/supabase/server";
import { validatePassword } from "@/lib/passwordPolicy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const { user, isAdmin } = await getAuthorizedAdmin(supabase);
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const role = body?.role === "admin" || body?.role === "gestionnaire" ? body.role : "designer";

  if (!email || !password) {
    return NextResponse.json({ error: "Courriel et mot de passe requis." }, { status: 400 });
  }
  const passwordError = validatePassword(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || null },
  });
  if (error?.code === "email_exists") {
    return NextResponse.json({ error: "Un compte existe déjà avec ce courriel." }, { status: 500 });
  }
  if (error || !data.user) {
    return serverError(error, "Erreur lors de la création du compte.");
  }

  // Le profil est créé automatiquement par le trigger `on_auth_user_created`
  // (voir supabase/migrations/0001_init.sql), mais avec le rôle par défaut
  // "designer" — on l'ajuste ici si un autre rôle a été choisi.
  if (role !== "designer") {
    const { error: profileError } = await admin
      .from("profiles")
      .update({ role })
      .eq("id", data.user.id);
    if (profileError) {
      return serverError(profileError, "Impossible d'attribuer le rôle.");
    }
  }

  return NextResponse.json({ id: data.user.id, email: data.user.email, full_name: fullName, role });
}
