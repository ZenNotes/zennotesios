import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The ZenNotes monorepo is consumed read-only, straight from source, the same
// way apps/web does it (aliases into packages/*). Nothing in that repo is
// modified by this project.
const ZENNOTES = resolve(__dirname, '../../opensource/zennotes')

function rendererManualChunk(id: string): string | undefined {
  const normalizedId = id.split('\\').join('/')
  if (normalizedId.endsWith('/packages/app-core/src/lib/wikilinks.ts')) {
    return 'app-wikilinks'
  }
  if (normalizedId.endsWith('/packages/app-core/src/lib/local-assets.ts')) {
    return 'app-local-assets'
  }
  if (normalizedId.endsWith('/packages/app-core/src/store.ts')) {
    return 'app-store'
  }

  if (!id.includes('node_modules')) return undefined

  if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/zustand/')) {
    return 'vendor-react'
  }
  if (id.includes('/@codemirror/language-data/')) {
    return 'vendor-editor-languages'
  }
  if (
    id.includes('/@codemirror/') ||
    id.includes('/codemirror/') ||
    id.includes('/@lezer/') ||
    id.includes('/@replit/codemirror-vim/')
  ) {
    return 'vendor-editor'
  }
  if (
    id.includes('/remark-') ||
    id.includes('/rehype-') ||
    id.includes('/unified/') ||
    id.includes('/unist-util-visit/') ||
    id.includes('/gray-matter/') ||
    id.includes('/katex/')
  ) {
    return 'vendor-markdown'
  }
  if (id.includes('/highlight.js/')) {
    return 'vendor-highlight'
  }
  if (id.includes('/mermaid/') || id.includes('/cytoscape/') || id.includes('/dagre/')) {
    return 'vendor-mermaid'
  }
  if (id.includes('/jsxgraph/')) {
    return 'vendor-jsxgraph'
  }
  if (id.includes('/function-plot/')) {
    return 'vendor-function-plot'
  }
  if (id.includes('/d3')) {
    return 'vendor-d3'
  }
  return undefined
}

export default defineConfig({
  root: __dirname,
  base: './',
  resolve: {
    alias: [
      { find: '@renderer', replacement: resolve(ZENNOTES, 'packages/app-core/src') },
      { find: '@shared', replacement: resolve(ZENNOTES, 'packages/shared-domain/src') },
      { find: '@bridge-contract', replacement: resolve(ZENNOTES, 'packages/bridge-contract/src') },
      {
        find: /^@zennotes\/app-core\/(.*)$/,
        replacement: resolve(ZENNOTES, 'packages/app-core/src') + '/$1'
      },
      {
        find: /^@zennotes\/shared-domain\/(.*)$/,
        replacement: resolve(ZENNOTES, 'packages/shared-domain/src') + '/$1'
      },
      {
        find: /^@zennotes\/bridge-contract\/(.*)$/,
        replacement: resolve(ZENNOTES, 'packages/bridge-contract/src') + '/$1'
      },
      // Two dependency-free desktop-main data/logic modules reused verbatim
      // (demo tour content, wikilink rename rewriting). Read-only imports.
      { find: '@desktop-main', replacement: resolve(ZENNOTES, 'apps/desktop/src/main') }
    ],
    // The app-core sources live in another repo whose node_modules would
    // otherwise win nearest-wins resolution; dedupe pins every stateful
    // singleton (React, Zustand, CodeMirror) to this project's copy.
    dedupe: [
      'react',
      'react-dom',
      'zustand',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/autocomplete',
      '@codemirror/commands',
      '@codemirror/search',
      '@lezer/common',
      '@lezer/highlight',
      '@replit/codemirror-vim',
      'codemirror'
    ]
  },
  server: {
    port: 5183,
    fs: {
      allow: [__dirname, ZENNOTES]
    }
  },
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 3500,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: rendererManualChunk
      }
    }
  }
})
