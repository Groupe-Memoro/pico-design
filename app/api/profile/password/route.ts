import { serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validatePassword } from "@/lib/passwordPolicy";

export const runtime = "nodejs";

// Changement de mot de passe par l'utilisateur lui-même (tous les rôles) —
// distinct de /api/users/[id], réservé aux admins pour créer/réinitialiser
// le compte d'un autre employé. Le mot de passe actuel est revérifié par
// une connexion (signInWithPassword) avant le changement : sans ça, une
// session laissée ouverte suffirait à en changer le mot de passe.
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword) {
    return NextResponse.json({ error: "Le mot de passe actuel est requis." }, { status: 400 });
  }
  const validationError = validatePassword(newPassword);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "Le nouveau mot de passe doit être différent de l'actuel." },
      { status: 400 }
    );
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (signInError) {
    return NextResponse.json({ error: "Mot de passe actuel incorrect." }, { status: 400 });
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) return serverError(updateError, "Impossible de modifier le mot de passe.");

  return NextResponse.json({ success: true });
}
