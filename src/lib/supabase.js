import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || url.startsWith("COLE_AQUI") || !anonKey || anonKey.startsWith("COLE_AQUI")) {
  console.warn(
    "[Supabase] Credenciais não configuradas. Preencha VITE_SUPABASE_URL e " +
    "VITE_SUPABASE_ANON_KEY no arquivo .env e reinicie o servidor."
  );
}

export const supabase = createClient(url, anonKey);
