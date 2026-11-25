import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

const MAPLIBRE_WORKER_FILE = path.resolve(
  __dirname,
  'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs',
);
const MAPLIBRE_WORKER_MAP_FILE = path.resolve(
  __dirname,
  'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs.map',
);

/**
 * Serves MapLibre GL JS v6's standalone ES module web worker cleanly in both
 * development and production:
 * - In dev, serves the pre-built worker verbatim BEFORE Vite's module transform
 *   middleware so Vite never injects `/@vite/client` (which crashes inside Web Workers)
 *   and never falls through to `index.html` (`text/html`).
 * - In production builds, emits `dist/assets/maplibre-gl-worker.mjs` verbatim so
 *   both explicit `setWorkerUrl('/assets/maplibre-gl-worker.mjs')` and relative
 *   worker resolution succeed with `text/javascript` MIME type.
 */
function maplibreWorkerAssetPlugin(): Plugin {
  return {
    name: 'maplibre-worker-asset',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || '';
        const pathname = rawUrl.split('?')[0];

        if (pathname.endsWith('/maplibre-gl-worker.mjs')) {
          if (!fs.existsSync(MAPLIBRE_WORKER_FILE)) {
            next();
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          fs.createReadStream(MAPLIBRE_WORKER_FILE).pipe(res);
          return;
        }

        if (pathname.endsWith('/maplibre-gl-worker.mjs.map')) {
          if (!fs.existsSync(MAPLIBRE_WORKER_MAP_FILE)) {
            next();
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          fs.createReadStream(MAPLIBRE_WORKER_MAP_FILE).pipe(res);
          return;
        }

        next();
      });
    },
    generateBundle() {
      if (fs.existsSync(MAPLIBRE_WORKER_FILE)) {
        this.emitFile({
          type: 'asset',
          fileName: 'assets/maplibre-gl-worker.mjs',
          source: fs.readFileSync(MAPLIBRE_WORKER_FILE),
        });
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      maplibreWorkerAssetPlugin(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
