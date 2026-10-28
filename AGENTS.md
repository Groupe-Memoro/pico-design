# AGENTS.md

This repository is the Pico Design internal product generator.

## Goal
Build and maintain a Next.js 14 application that allows employees to:
- sign in with Supabase auth,
- select a product template,
- upload an image,
- generate a print-ready PDF with correct dimensions and bleed,
- store the result in Supabase storage, and
- manage products, Shopify orders and their production (imposition).

## Stack
- Next.js 14 App Router
- TypeScript
- React + Tailwind CSS
- Supabase for auth, DB, and storage
- PDF generation with `pdf-lib` and `sharp`

## Important conventions
- Use the App Router structure and server/client separation that already exists.
- Keep any database, auth, or storage access on the server side unless clearly required for client-side interaction.
- Use the `@/` path alias when importing from app code.
- Do not add secrets to the frontend or commit real environment values.
- Prefer small, focused changes. Do not broaden the feature scope without reason.

## Working notes
- `middleware.ts` only sets a nonce-based CSP; it does NOT enforce auth. Every new page must call `requireUser()`/`requireAdmin()` (from `lib/supabase/server.ts`) and every new API route must check `auth.getUser()` itself.
- The `products` API is the core workflow: validate template + file input, upload the source image, generate the PDF, and save output to Supabase storage. The public Shopify tool renders through `app/api/design/*`.
- Product templates are stored in the `templates` table and contain print metadata (dimensions, bleed, DPI, and logo placement).
- `lib/pdf/generate.ts` is the critical business logic file; changes here should preserve output dimensions and print quality.
- The `public/pico-noir.svg` file can be absent without breaking generation.

## Verification
Before claiming completion, run the smallest relevant tool for the task:
- `npm run lint` for general code health,
- `npx tsc --noEmit` for type checking,
- or a targeted build/test command when the change affects runtime behavior.

Keep the repo easy to maintain and aligned with the existing Pico Design workflow.
