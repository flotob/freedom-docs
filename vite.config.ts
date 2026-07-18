import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Relative base so the app works from any bzz://<ref>/ origin
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // Vite's commonjs transform breaks exceljs's browserify bundle (dsheet's
      // xlsx import hangs in workbook.xlsx.load). The shim loads the pristine
      // exceljs.min.js as a classic script instead — see lib/exceljs-shim.ts.
      // Exact-match so the shim's own 'exceljs/dist/…?url' import resolves.
      {
        find: /^exceljs$/,
        replacement: fileURLToPath(
          new URL('./src/lib/exceljs-shim.ts', import.meta.url)
        ),
      },
    ],
  },
  build: {
    // Top-level await (used by the exceljs shim) needs a recent target; the
    // app only runs in Freedom Browser / current Chromium anyway.
    target: 'es2022',
  },
})
