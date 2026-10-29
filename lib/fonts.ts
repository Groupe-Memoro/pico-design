import localFont from "next/font/local";

// Polices de PICO OS (Apercu / Gelica), déposées dans public/fonts —
// remplacent DM Sans / Gelasio pour aligner l'identité visuelle sur celle
// de la plateforme sœur.
export const apercu = localFont({
  src: [
    { path: "../public/fonts/apercu-light.woff2", weight: "300", style: "normal" },
    { path: "../public/fonts/apercu-light-italic.woff2", weight: "300", style: "italic" },
    { path: "../public/fonts/apercu-regular.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/apercu-italic.woff2", weight: "400", style: "italic" },
    { path: "../public/fonts/apercu-medium.woff2", weight: "500", style: "normal" },
    { path: "../public/fonts/apercu-medium-italic.woff2", weight: "500", style: "italic" },
    { path: "../public/fonts/apercu-bold.woff2", weight: "700", style: "normal" },
    { path: "../public/fonts/apercu-bold-italic.woff2", weight: "700", style: "italic" },
  ],
  variable: "--font-body",
  display: "swap",
});

export const gelica = localFont({
  src: [{ path: "../public/fonts/gelica-semibold.woff2", weight: "600", style: "normal" }],
  variable: "--font-heading",
  display: "swap",
});
