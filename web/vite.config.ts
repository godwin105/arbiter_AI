import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app is served by the Arbiter server under /work, not at the domain root,
// so asset URLs have to be relative or every request 404s.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
