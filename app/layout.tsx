import type { Metadata } from "next";
import { headers } from "next/headers";
import { apercu, gelica } from "@/lib/fonts";
import "./globals.css";
import AppShell from "@/components/AppShell";
import AppSettingsStyle from "@/components/AppSettingsStyle";
import { THEME_SCRIPT } from "@/lib/colorTheme";

// Le favicon passe par les réglages (module Paramètres) : la route renvoie
// le fichier téléversé, ou le logo d'origine à défaut. D'où `icons` ici
// plutôt qu'un fichier app/icon.svg, que Next servirait en priorité.
export const metadata: Metadata = {
  icons: { icon: "/api/settings/admin/asset/favicon" },
  // Nécessaire pour que l'image de partage (app/opengraph-image.tsx) soit
  // résolue en URL absolue dans les balises og:image/twitter:image — sans
  // ça, la plupart des plateformes (Slack, iMessage...) n'affichent rien.
  metadataBase: new URL("https://pico-design.vercel.app"),
  title: "Pico Design",
  description: "Génération de PDF prêts pour impression pour les produits Pico",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // La CSP (middleware.ts) impose un nonce sur les scripts : sans lui, le
  // script de thème est bloqué en production et le mode sombre ne s'applique pas.
  const nonce = headers().get("x-nonce") ?? undefined;
  return (
    // data-theme est posé par THEME_SCRIPT avant React : d'où suppressHydrationWarning.
    <html lang="fr" className={`${apercu.variable} ${gelica.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/* Habillage de l'administration ; l'Outil Shopify pose le sien
            par-dessus dans app/design/layout.tsx. */}
        <AppSettingsStyle scope="admin" />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
