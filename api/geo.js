/* GET /api/geo — país do visitante, com o idioma e a moeda sugeridos.

   Público de propósito: a tela de login precisa dele antes de existir token.
   É seguro ser público porque o handler não toca no banco, não persiste nada,
   não devolve o IP e não aceita entrada nenhuma — a resposta é função pura do
   header que a Vercel injeta na borda. Sem cliente Supabase aqui: o endpoint
   está no caminho do primeiro paint e o cold start tem que ser mínimo.

   Cache-Control: no-store é obrigatório. O CDN da Vercel não inclui
   x-vercel-ip-country na chave de cache — um s-maxage serviria a resposta do
   Brasil para quem abre do Japão. Quem faz cache é o cliente (src/lib/geo.js),
   que guarda o resultado por dispositivo. */
import { resolverGeo } from "./_lib/geo.js";
import { origemBloqueada } from "./_lib/seguranca.js";

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });
  if (origemBloqueada(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(resolverGeo(req));
}
