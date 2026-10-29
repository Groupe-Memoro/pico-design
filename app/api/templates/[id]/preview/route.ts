import { requireApiUser } from "@/lib/api";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { generateTemplatePreviewPng } from "@/lib/pdf/preview";
import { loadLogoImage } from "@/lib/pdf/logo";
import type { Template } from "@/lib/types";

export const runtime = "nodejs"; // sharp a besoin du runtime Node, pas Edge.

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { data: template, error } = await supabase
    .from("templates")
    .select("*")
    .eq("id", params.id)
    .single<Template>();

  if (error || !template) {
    return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });
  }

  const admin = createAdminSupabaseClient();
  // L'aperçu montre le recto : le logo n'y figure que si le modèle le prévoit
  // sur le recto (case « Logo Pico > Sur le recto »).
  const logoBuffer = template.logo_on_front ? await loadLogoImage(admin, "logo", "#000000") : null;

  let overlayBuffer: Buffer | null = null;
  if (template.overlay_path) {
    const { data: overlayData } = await admin.storage.from("overlays").download(template.overlay_path);
    overlayBuffer = overlayData ? Buffer.from(await overlayData.arrayBuffer()) : null;
  }

  const png = await generateTemplatePreviewPng(template, logoBuffer, null, overlayBuffer);

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
    },
  });
}
