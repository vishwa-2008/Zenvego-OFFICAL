# Directives for Antigravity AI Coding Agent

This document contains the exact architecture, setup commands, design guardrails, and copy-paste prompts for continuing development on **Zenvego** inside **Antigravity** — keeping the web design 100% intact and keeping **ZenBot 100% free with zero API keys**.

---

## 1. System Orientation & Core Identity

- **Project Name:** Zenvego
- **Core Concept:** Hyper-local decentralized farmers market ecosystem with Buyer, Farmer, and Delivery Partner portals, regional US/India unit & currency switching, QR handshake flows, and a 100% free built-in local **ZenBot** assistant.
- **Tech Stack:**
  - **Runtime & Build:** Node.js (v18+), Vite 6, React 19, TypeScript
  - **Styling:** Tailwind CSS v4 via `@import "tailwindcss";` and `@theme` tokens in `src/index.css`
  - **Typography & Icons:** `Plus Jakarta Sans` and Google `Material Symbols Outlined` loaded in `index.html` (`lucide-react` is also installed if needed, but match existing Material Symbols icons where used)
  - **Animations:** `motion` (`motion/react`) and CSS keyframes in `src/index.css`

---

## 2. Strict Design Language & Web Design Guardrails

> [!WARNING]
> **Do NOT redesign, alter layouts, reset fonts, or overwrite `src/index.css` theme tokens.**

1. **Color Palette (`src/index.css`):**
   - Background / Surface: `#fff8f6` (warm cream), `#fff1eb` / `#ffeae0` (soft peach containers)
   - Text / Dark Contrast: `#271810` (deep espresso charcoal)
   - Primary (Green): `#0f5238` / `#2d6a4f` (`#b1f0ce` fixed highlight)
   - Secondary / Coral Accent: `#ff5c3e` (`#b5270e` hover/secondary)
2. **Architecture:**
   - Single-state view switcher inside `src/App.tsx` (`currentView` using `ViewState` from `src/types.ts`). Do NOT add `react-router-dom` or break conditional view rendering.
   - Keep floating controls non-overlapping:
     - Top-right: `Zenvego Mocks` switcher
     - Bottom-right: Toast notifications
     - Bottom-left: `☎ Support & Care` and `ZenBot Free`

---

## 3. Setup & Preview in Antigravity

Run these commands in the Antigravity terminal from the extracted project root:
1. Install dependencies:
   `npm install`
2. Start the preview server on port `3000`:
   `npm run dev` (runs `vite --port=3000 --host=0.0.0.0`)
3. Type-check and production build verification:
   `npm run lint && npm run build`

---

## 4. 100% Free ZenBot Rule (NO Paid APIs, NO `GEMINI_API_KEY`)

- **Do NOT** require `GEMINI_API_KEY`, `AIza...` keys, Google Cloud OAuth tokens (`AQ.Ab8...`), or external paid LLM APIs in `src/App.tsx` or any component.
- **ZenBot (`src/components/ZenBotAssistant.tsx`)** must remain **100% free and offline-capable** using local TypeScript logic connected directly to live app state (`products`, `cart`, `currency`, `measurementSystem`, `sessionUser`, `setView`, `addToCart`).
- Never render API key input forms or error banners asking the user for an API key.

---

## 5. Key Utilities & State Rules

- **Currency (`src/utils/currency.ts`):** Always format prices with `formatPrice(usdAmount, currency)` (`USD` or `INR`).
- **Measurements (`src/utils/measurement.ts`):** Always convert weights/distances with `convertAndFormatProductWeight(...)`, `formatWeight(...)`, and `formatDistance(...)` for `US` (lbs, miles) vs `IND` (kg, km).
- **Speech (`src/utils/speech.ts`):** Web Speech API voice search helper.

---

## 6. Copy-Paste Prompt for Antigravity

Paste this exact prompt into Antigravity before asking for any new task:

```text
Read ANTIGRAVITY_INSTRUCTIONS.md first.
This is the Zenvego React 19 + Vite 6 + Tailwind CSS v4 project.
Strict rules:
1. Do NOT change the existing web design, layout, colors (#fff8f6, #271810, #0f5238, #ff5c3e), fonts (Plus Jakarta Sans), or view-switching architecture in src/App.tsx.
2. Keep everything 100% FREE with ZERO API keys. Do NOT use GEMINI_API_KEY, @google/genai, or ask for an AIza... API key in App.tsx or anywhere else. If any GEMINI_API_KEY or API-key ZenBot exists in App.tsx, remove it and use the 100% free local src/components/ZenBotAssistant.tsx connected to live products, cart, currency, and measurementSystem state.
3. Keep npm scripts intact (port 3000 via `npm run dev`), run `npm install` if node_modules is missing, verify with `npm run lint` and `npm run build`, and show me the live preview after changes.

Now perform this task: [DESCRIBE YOUR NEXT FEATURE OR CHANGE HERE]
```
