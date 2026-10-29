import { serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { createServerSupabaseClient, createAdminSupabaseClient, getAuthorizedAdmin } from "@/lib/supabase/server";
import { validatePassword } from "@/lib/passwordPolicy";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const { user, isAdmin } = await getAuthorizedAdmin(supabase);
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : undefined;
  const role =
    body?.role === "admin" || body?.role === "designer" || body?.role === "gestionnaire"
      ? body.role
      : undefined;
  const email = typeof body?.email === "string" && body.email.trim() ? body.email.trim() : undefined;
  const password = typeof body?.password === "string" && body.password ? body.password : undefined;

  if (role && role !== "admin" && params.id === user.id) {
    return NextResponse.json({ error: "Impossible de retirer votre propre rôle admin." }, { status: 400 });
  }
  if (password) {
    const passwordError = validatePassword(password);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  if (email || password) {
    const { error: authError } = await admin.auth.admin.updateUserById(params.id, {
      ...(email ? { email, email_confirm: true } : {}),
      ...(password ? { password } : {}),
    });
    if (authError) {
      // Courriel déjà pris : message utile à l'administrateur.
      if (authError.code === "email_exists") {
        return NextResponse.json({ error: "Un compte existe déjà avec ce courriel." }, { status: 500 });
      }
      return serverError(authError, "Impossible de modifier le compte.");
    }
  }

  const update: Record<string, unknown> = {};
  if (fullName !== undefined) update.full_name = fullName || null;
  if (role !== undefined) update.role = role;

  if (Object.keys(update).length > 0) {
    const { error: profileError } = await admin.from("profiles").update(update).eq("id", params.id);
    if (profileError) return serverError(profileError, "Impossible de modifier le profil.");
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const { user, isAdmin } = await getAuthorizedAdmin(supabase);
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (params.id === user.id) {
    return NextResponse.json({ error: "Impossible de supprimer votre propre compte." }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  // La ligne `profiles` associée est supprimée automatiquement (foreign key
  // `on delete cascade` vers `auth.users`, voir 0001_init.sql).
  const { error } = await admin.auth.admin.deleteUser(params.id);
  if (error) return serverError(error, "Impossible de supprimer le compte.");

  return NextResponse.json({ success: true });
}
