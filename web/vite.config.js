import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative so the build works under https://<user>.github.io/<repo>/
  // without baking the repo name in.
  base: "./",
});
