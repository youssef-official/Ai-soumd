import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    // Vite replaces this with the value of the environment variable at build time.
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY)
  }
});
