import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the same build works unmodified on GitHub Pages
  // project subpaths (yourname.github.io/laminate/), Cloudflare/Netlify root
  // domains, and IPFS gateways alike.
  base: "./",
});
