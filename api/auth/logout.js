/* POST /api/auth/logout  (sem corpo — usa o cookie HttpOnly cm_refresh)
   Sair de verdade: revoga a família inteira de refresh tokens da sessão e
   limpa o cookie. O JWT de acesso restante morre sozinho em até 1h. */
import { createClient } from "@supabase/supabase-js";
import { revogarRefresh, origemBloqueada, logSeguro, auditar, ipDoRequest, lerCookieRefresh } from "../_lib/seguranca.js";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (origemBloqueada(req, res)) return;
  const serviceKey = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return res.status(200).json({ ok: true }); // nada a revogar sem backend configurado
  const supabase = createClient(envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL, serviceKey);
  try {
    const tinhaSessao = !!lerCookieRefresh(req);
    await revogarRefresh(supabase, req, res);
    if (tinhaSessao)
      await auditar(supabase, { evento: "logout", ip: ipDoRequest(req) });
  } catch (e) { logSeguro("[auth/logout]", e); }
  return res.status(200).json({ ok: true });
}
