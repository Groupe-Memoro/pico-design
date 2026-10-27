import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Bourgogne : alias de --primary (même teinte, et suit le mode
        // sombre). Noir et crème restent fixes.
        pico: {
          black: "#0a0a0a",
          cream: "#f8f1e9",
          accent: "#f07544",
          maroon: "rgb(var(--primary-rgb) / <alpha-value>)",
          "maroon-dark": "var(--primary-hover)",
        },
        // Les gris de Tailwind remplacés par les gris chauds de PICO OS
        // (app/globals.css) : tout l'existant s'accorde au fond beige, et
        // s'inverse en mode sombre.
        neutral: Object.fromEntries(
          ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"].map((step) => [
            step,
            `rgb(var(--neutral-${step}-rgb) / <alpha-value>)`,
          ])
        ),
        // Tokens portés de PICO OS (voir app/globals.css) — utilisables en
        // plus des couleurs pico.* existantes (ex. bg-background, text-text,
        // bg-primary, text-primary-hover...).
        background: "var(--background)",
        surface: "var(--surface)",
        "surface-muted": "var(--surface-muted)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        text: "var(--text)",
        "text-muted": "var(--text-muted)",
        "text-subtle": "var(--text-subtle)",
        "text-on-brand": "var(--text-on-brand)",
        primary: "var(--primary)",
        "primary-hover": "var(--primary-hover)",
        "primary-subtle": "var(--primary-subtle)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-subtle": "var(--accent-subtle)",
        success: "var(--success)",
        "success-subtle": "var(--success-subtle)",
        warning: "var(--warning)",
        "warning-subtle": "var(--warning-subtle)",
        danger: "var(--danger)",
        "danger-hover": "var(--danger-hover)",
        "danger-subtle": "var(--danger-subtle)",
        "warning-strong": "var(--warning-strong)",
        "success-strong": "var(--success-strong)",
        info: "var(--info)",
        "info-subtle": "var(--info-subtle)",
      },
      // Titre de page (h1) : 26 px, soit 30 % de plus que l'ancien text-xl (20 px).
      fontSize: {
        // En var() pour suivre l'échelle typographique réglée dans le
        // module Paramètres (voir AppSettingsStyle).
        "page-title": ["var(--page-title-size, 1.625rem)", { lineHeight: "2.25rem" }],
      },
      // Secousse élastique « jello » (Animate.css) : un biais qui s'amortit et
      // revient à zéro. Utilisée sur les icônes du menu du haut au survol.
      // Amplitude réglée pour une icône de 16 px : subtile mais visible. Le jello
      // d'origine (12,5°, sans agrandissement) y passait inaperçu ; 25° / ×1,35 et
      // 18° / ×1,15 étaient trop intenses.
      keyframes: {
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        jello: {
          "0%, 11.1%, 100%": { transform: "translate3d(0, 0, 0)" },
          "22.2%": { transform: "scale(1.08) skewX(-14deg) skewY(-14deg)" },
          "33.3%": { transform: "scale(1.05) skewX(7deg) skewY(7deg)" },
          "44.4%": { transform: "scale(1.03) skewX(-3.5deg) skewY(-3.5deg)" },
          "55.5%": { transform: "scale(1.015) skewX(1.75deg) skewY(1.75deg)" },
          "66.6%": { transform: "scale(1.007) skewX(-0.875deg) skewY(-0.875deg)" },
          "77.7%": { transform: "scale(1.003) skewX(0.44deg) skewY(0.44deg)" },
          "88.8%": { transform: "scale(1.001) skewX(-0.22deg) skewY(-0.22deg)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.5s infinite",
        jello: "jello 0.9s both",
      },
      fontFamily: {
        heading: ["var(--font-heading)", "serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        lg: "var(--radius-lg)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        lg: "var(--shadow-lg)",
      },
      letterSpacing: {
        display: "var(--tracking-display)",
        body: "var(--tracking-body)",
        price: "var(--tracking-price)",
      },
    },
  },
  plugins: [],
};

export default config;
