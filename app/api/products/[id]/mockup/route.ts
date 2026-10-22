import { NextResponse } from "next/server";
import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase/server";
import { MockupError, renderProductMockup } from "@/lib/products/mockup";
import type { Product, Template } from "@/lib/types";

export const runtime = "nodejs"; // sharp a besoin du runtime Node, pas Edge.

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("*")
    .eq("id", params.id)
    .single<Product>();
  if (productError || !product) {
    return NextResponse.json({ error: "Produit introuvable." }, { status: 404 });
  }

  const { data: rawTemplate, error: templateError } = await supabase
    .from("templates")
    .select("*")
    .eq("id", product.template_id)
    .single<Template>();
  if (templateError || !rawTemplate) {
    return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });
  }
  // ?mockupId= choisit lequel rendre quand le modèle en a plusieurs (voir
  // resolveMockupBundle) ; absent = le premier, puis repli sur le bundle
  // hérité du modèle.
  const mockupId = new URL(request.url).searchParams.get("mockupId");
  try {
    const png = await renderProductMockup(supabase, createAdminSupabaseClient(), product, rawTemplate, { mockupId });
    return new NextResponse(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    // Assets manquants ou bundle incohérent : le message tel quel, il dit
    // quoi corriger — sinon le client ne verrait qu'un 500 opaque.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur lors de la génération du mockup." },
      { status: err instanceof MockupError ? err.status : 500 }
    );
  }
}
