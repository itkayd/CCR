import { defineConfig, type Plugin, type ViteDevServer, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Serve /api/*.ts (Vercel functions, Web signature) from the dev and preview servers. */
function vercelApi(): Plugin {
  let load: (path: string) => Promise<Record<string, unknown>>;
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const m = req.url?.match(/^\/api\/([a-z-]+)/);
    if (!m) return next();
    try {
      const mod = await load(`/api/${m[1]}.ts`);
      const fn = mod.GET as (r: Request) => Promise<Response>;
      const r = await fn(new Request(`http://localhost${req.url}`));
      res.statusCode = r.status;
      r.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(await r.text());
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
  };
  return {
    name: 'vercel-api',
    configureServer(server: ViteDevServer) {
      load = (p) => server.ssrLoadModule(p);
      server.middlewares.use(handler);
    },
    async configurePreviewServer(server: PreviewServer) {
      const { createServer } = await import('vite');
      const dev = await createServer({ server: { middlewareMode: true }, appType: 'custom', configFile: false });
      load = (p) => dev.ssrLoadModule(p);
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({ plugins: [react(), vercelApi()] });
