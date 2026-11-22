import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  test: {
    // Page tests import the app shell. Running every one of those imports at once keeps
    // the transform busy until each file's timer runs out, so `npm test` uses two workers.
    // The heavy files still set their own timeout; a hang fails, and other tests keep
    // Vitest's five-second default.
    maxWorkers: 2,
  },
});
