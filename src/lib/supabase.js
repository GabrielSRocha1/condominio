import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || url.startsWith("COLE_AQUI") || !anonKey || anonKey.startsWith("COLE_AQUI")) {
  console.warn(
    "[Supabase] Credenciais não configuradas. Preencha VITE_SUPABASE_URL e " +
    "VITE_SUPABASE_ANON_KEY no arquivo .env e reinicie o servidor."
  );
}

/* Com o RLS por condomínio, as consultas só funcionam com o token emitido
   pelo login (/api/auth/*) — ele carrega o condominio_id da conta e é o que
   o banco usa para liberar apenas as linhas do próprio prédio. */
let tokenAtual = null;
export let supabase = criarCliente(null);

function criarCliente(token) {
  return createClient(url, anonKey, token
    ? { global: { headers: { Authorization: `Bearer ${token}` } } }
    : undefined);
}

export function setAuthToken(token) {
  tokenAtual = token || null;
  supabase = criarCliente(tokenAtual);
}

export function getAuthToken() { return tokenAtual; }
