import { defineConfig } from 'vite';
// GITHUB_PAGES=true → served from https://<user>.github.io/patrol-radar/
// index.html only redirects to v2/index.html. The app stays in that file so
// /v2/ bookmarks, Capacitor server.appStartPath, and hash/query links do not move.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0') },
  base: process.env.GITHUB_PAGES ? '/patrol-radar/' : '/',
  build: { rollupOptions: { input: { main: 'index.html', v2: 'v2/index.html' } } },
  server: { host: true, allowedHosts: ['.trycloudflare.com', '.loca.lt'] },
});
