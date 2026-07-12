import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Relative base so the app works from any bzz://<ref>/ origin
  base: './',
  plugins: [react(), tailwindcss()],
})
