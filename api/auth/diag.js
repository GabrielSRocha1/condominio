/* GET /api/auth/diag — diagnóstico das variáveis de ambiente do servidor.
   Não expõe nenhum valor: só diz se cada uma está presente e utilizável. */
const estado = (k) => {
  const v = process.env[k];
  if (!v) return "AUSENTE";
  if (v.startsWith("COLE_AQUI")) return "placeholder (começa com COLE_AQUI)";
  if (v !== v.trim()) return "presente, mas com espaço no início/fim";
  return `ok (${v.length} caracteres)`;
};

export default function handler(req, res) {
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
