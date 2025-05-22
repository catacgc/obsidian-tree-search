import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'manifest.json', dest: '.' },
        { src: 'manifest-beta.json', dest: '.' },
        { src: '.hotreload', dest: '.' }
      ]
    })
  ],
  build: {
    outDir: './dist',
    lib: {
      entry: path.resolve(__dirname, 'src/main.ts'),
      formats: ['cjs'],
      fileName: () => 'main.js',
      name: 'TreeSearchPlugin',
    },
    rollupOptions: {
      external: [
        'obsidian',
        'electron',
        '@codemirror/autocomplete',
        '@codemirror/collab',
        '@codemirror/commands',
        '@codemirror/language',
        '@codemirror/lint',
        '@codemirror/search',
        '@codemirror/state',
        '@codemirror/view',
        '@lezer/common',
        '@lezer/highlight',
        '@lezer/lr',
        'http',
        'fs',
      ],
      output: {
        entryFileNames: 'main.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'main.css';
          }
          return '[name][extname]';
        },
      },
    },
    emptyOutDir: false,
    sourcemap: true,
  },
  css: {
    postcss: './postcss.config.js',
    preprocessorOptions: {
      css: {
        additionalData: '@import "tailwindcss/base"; @import "tailwindcss/components"; @import "tailwindcss/utilities";',
      },
    },
  },
}); 