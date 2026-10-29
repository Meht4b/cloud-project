import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // Relative asset URLs work both at the repository root and under /cloud-project/.
  base: "./",
  build: { rollupOptions: { input: { index: resolve(process.cwd(), "src-index.html") } } }
});
