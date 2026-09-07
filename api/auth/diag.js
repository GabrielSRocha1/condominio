/* GET /api/auth/diag — diagnóstico das variáveis de ambiente do servidor.
   Não expõe nenhum valor: só diz se cada uma está presente e utilizável.
   Blindagem: com o servidor já configurado (SUPABASE_JWT_SECRET presente),
   exige sessão válida — sondagem anônima de configuração fica fechada.
   Sem o secret configurado (bootstrap da instalação) segue aberto, porque
   nem haveria como validar um token. */
import { lerClaimsReq } from "../_lib/seguranca.js";

const estado = (k) => {
  const v = process.env[k];
  if (!v) return "AUSENTE";
  if (v.startsWith("COLE_AQUI")) return "placeholder (começa com COLE_AQUI)";
  if (v !== v.trim()) return "presente, mas com espaço no início/fim";
  return `ok (${v.length} caracteres)`;
};

export default function handler(req, res) {
  const configurado = !!(process.env.SUPABASE_JWT_SECRET || "").trim()
    && !String(process.env.SUPABASE_JWT_SECRET).startsWith("COLE_AQUI");
  if (configurado && !lerClaimsReq(req))
    return res.status(401).json({ error: "Entre no sistema para ver o diagnóstico." });

  return res.status(200).json({
    SUPABASE_JWT_SECRET: estado("SUPABASE_JWT_SECRET"),
    SUPABASE_SERVICE_ROLE_KEY: estado("SUPABASE_SERVICE_ROLE_KEY"),
    SUPABASE_URL: estado("SUPABASE_URL"),
    VITE_SUPABASE_URL: estado("VITE_SUPABASE_URL"),
    STRIPE_SECRET_KEY: estado("STRIPE_SECRET_KEY"),
    STRIPE_WEBHOOK_SECRET: estado("STRIPE_WEBHOOK_SECRET"),
    STRIPE_CONNECT_WEBHOOK_SECRET: estado("STRIPE_CONNECT_WEBHOOK_SECRET"),
  });
}
