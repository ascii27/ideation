import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The frontend is built to ./dist and served by the Express server (server/index.ts).
// In development the same server runs Vite in middleware mode, so there is a single
// origin for the app and the /api routes.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
