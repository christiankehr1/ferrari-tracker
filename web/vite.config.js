import { createReadStream } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The published site gets data/ copied into dist/ by the Actions build. In dev
// there's no copy step and data/ sits above the Vite root, so serve it from the
// repo instead — otherwise `npm run dev` only ever renders the load error.
const serveRepoData = {
  name: "serve-repo-data",
  apply: "serve",
  configureServer(server) {
    // Block body, not a concise arrow: a returned value is taken as Vite's
    // post-middleware hook and gets called as a function.
    server.middlewares.use("/data/dashboard.json", (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      createReadStream(new URL("../data/dashboard.json", import.meta.url)).pipe(res);
    });
  },
};

export default defineConfig({
  plugins: [react(), serveRepoData],
  // Relative so the build works under https://<user>.github.io/<repo>/
  // without baking the repo name in.
  base: "./",
});
