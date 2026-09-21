import nodeFs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Extension pages resolve paths against chrome-extension://<id>/ — absolute
 * "/assets/..." links have proven flaky in zip-installed side panels, so we
 * inline the panel's CSS into the HTML and make the script path relative.
 */
function inlineSidepanelCss(): Plugin {
  return {
    name: "inline-sidepanel-css",
    apply: "build",
    enforce: "post",
    writeBundle(options: { dir?: string }) {
      const dir = options.dir ?? "dist";
      const htmlPath = path.join(dir, "sidepanel.html");
      if (!nodeFs.existsSync(htmlPath)) return;
      let source = nodeFs.readFileSync(htmlPath, "utf8");
      source = source.replace(
        /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
        (link: string, href: string) => {
          const candidates = [
            path.join(dir, href.replace(/^\//, "")),
            path.join(dir, path.basename(href)),
          ];
          const cssPath = candidates.find((p) => nodeFs.existsSync(p));
          if (!cssPath) return link;
          const css = nodeFs
            .readFileSync(cssPath, "utf8")
            .replace(/url\((['"]?)\//g, "url($1./");
          return `<style>${css}</style>`;
        },
      );
      source = source.replace(/(src|href)="\//g, '$1="./');
      nodeFs.writeFileSync(htmlPath, source);
    },
  };
}

export default defineConfig({
  plugins: [react(), inlineSidepanelCss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: "chrome120",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, "sidepanel.html"),
        background: path.resolve(__dirname, "src/background/background.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
