import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import DashboardTiles from "@/components/DashboardTiles";
import { menuKeysForRole, resolveMenuOrder } from "@/lib/menuItems";

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = createServerSupabaseClient();

  let firstName = user.email?.split("@")[0] ?? "";
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, menu_order")
    .eq("id", user.id)
    .single<{ full_name: string | null; role: string | null; menu_order: string[] | null }>();
  if (profile?.full_name) firstName = profile.full_name.split(" ")[0];
  firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  const order = resolveMenuOrder(profile?.menu_order, menuKeysForRole(profile?.role));

  return (
    <div>
      {/* Le halo dégradé vient de la mise en page commune (.page-glow). Pas de
          pleine largeur (100vw) ici : elle déborderait sous le menu de gauche. */}
      <div className="py-2">
        <p className="text-xs font-semibold tracking-widest text-pico-accent">PICO DESIGN</p>
        <h1 className="mt-2 font-heading text-3xl font-bold text-text sm:text-4xl">
          Bonjour, {firstName}.
        </h1>
        <p className="mt-2 text-neutral-600">Choisissez une page pour commencer.</p>
      </div>

      {/* Les tuiles sont groupées comme le menu, chaque groupe sous son titre. */}
      <div className="mt-8">
        <DashboardTiles initialOrder={order} />
      </div>
    </div>
  );
}
