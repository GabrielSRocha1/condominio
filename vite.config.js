import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

/* Serve as funções de /api (estilo Vercel) no servidor de dev do Vite,
   para o botão "Pagar online" funcionar em npm run dev. Em produção a
   Vercel faz isso sozinha — este plugin não entra no build. */
function apiDev(env) {
  return {
    name: "api-dev",
    configureServer(server) {
      // as funções leem process.env; injeta o .env (sem sobrescrever o que já existe)
      for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;

      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith("/api/")) return next();
        const rota = req.url.split("?")[0].replace(/^\/api\//, "");
        const arquivo = path.join(process.cwd(), "api", `${rota}.js`);
        if (!fs.existsSync(arquivo)) return next();

        // corpo cru (o handler faz o JSON.parse)
        const partes = [];
        for await (const p of req) partes.push(p);
        req.body = Buffer.concat(partes).toString("utf8");

        // adapta res do Node ao estilo Vercel (status/json encadeáveis)
        res.status = (c) => { res.statusCode = c; return res; };
        res.json = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); return res; };

        try {
          const { default: handler } = await import(`${pathToFileURL(arquivo)}?t=${Date.now()}`);
          await handler(req, res);
        } catch (e) {
          console.error(`[api-dev] ${req.url}:`, e);
          res.status(500).json({ error: e.message });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ""); // "" = carrega também as sem prefixo VITE_
  return {
    plugins: [react(), tailwindcss(), apiDev(env)],
  };
});
