import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // registered manually via useRegisterSW (see UpdateAppCard) so the app
      // can also trigger an on-demand update check — avoid double-registering.
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Aria — Il tuo assistente di studio',
        short_name: 'Aria',
        description: 'Organizza lo studio, il calendario e i materiali con un assistente AI pensato per menti ADHD.',
        theme_color: '#6C5CE7',
        background_color: '#0F1115',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        lang: 'it',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallbackDenylist: [/^\/supabase/],
        // Mermaid (2026-08-26, Cheat Study figures) ships ~30 diagram-type
        // chunks (~1.3MB total) that mermaid itself only loads on demand,
        // per diagram syntax actually used -- Aria's own prompts (gemini.ts's
        // MERMAID_FIGURE_RULE) only ever ask for flowchart/graph ("graph TD")
        // or state diagrams, never gantt/sequence/C4/architecture/etc. Same
        // cost discipline as the rest of this app's caching (see CLAUDE.md's
        // "cache: principio permanente" -- don't precache what's never used):
        // excluding these from the PWA's offline install keeps that ~1.3MB
        // off every user's device. Worst case if ever needed anyway: mermaid
        // fetches the chunk live over the network (fails gracefully offline,
        // same fallback as any other unrenderable figure -- see
        // MermaidDiagram.tsx's error state), never a hard crash.
        globIgnores: [
          '**/abnfDiagram-*.js',
          '**/architectureDiagram-*.js',
          '**/blockDiagram-*.js',
          '**/c4Diagram-*.js',
          '**/classDiagram*-*.js',
          '**/cynefinDiagram-*.js',
          '**/cose-bilkent-*.js',
          '**/cytoscape.esm-*.js',
          '**/ebnfDiagram-*.js',
          '**/erDiagram-*.js',
          '**/ganttDiagram-*.js',
          '**/gitGraphDiagram-*.js',
          '**/infoDiagram-*.js',
          '**/ishikawaDiagram-*.js',
          '**/journeyDiagram-*.js',
          '**/pegDiagram-*.js',
          '**/pieDiagram-*.js',
          '**/quadrantDiagram-*.js',
          '**/railroadDiagram-*.js',
          '**/requirementDiagram-*.js',
          '**/sankeyDiagram-*.js',
          '**/sequenceDiagram-*.js',
          '**/swimlanes*-*.js',
          '**/vennDiagram-*.js',
          '**/wardleyDiagram-*.js',
          '**/xychartDiagram-*.js',
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
})
