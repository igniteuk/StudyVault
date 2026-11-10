import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => ({
  envPrefix: [],
  define: {
    'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(loadEnv(mode, process.cwd(), 'VITE_GOOGLE_CLIENT_ID').VITE_GOOGLE_CLIENT_ID?.trim() ?? ''),
  },
}))
