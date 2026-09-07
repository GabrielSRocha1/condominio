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

/* ── renovação silenciosa da sessão ──
   O JWT de acesso agora dura 1h; a sessão longa vive num refresh token em
   cookie HttpOnly (o JavaScript nunca o vê). Perto de expirar, o timer chama
   /api/auth/refresh — que rotaciona o cookie e devolve um token novo — e o
   cliente do Supabase é recriado sem o usuário perceber. Tokens antigos (7
   dias, sem cookie) seguem valendo até o fim: a renovação só falha em
   silêncio e nada quebra. */
const MARGEM_MS = 5 * 60 * 1000; // renova 5 min antes de expirar
let timerRenovacao = null;
let renovando = null;

const expiraEmMs = (token) => {
  try {
    const { exp } = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return exp ? exp * 1000 - Date.now() : null;
  } catch { return null; }
};

async function renovarSessao() {
  if (renovando) return renovando; // single-flight
  renovando = (async () => {
    try {
      const r = await fetch("/api/auth/refresh", { method: "POST" });
      if (!r.ok) return null;
      const corpo = await r.json().catch(() => null);
      if (!corpo?.token) return null;
      setAuthToken(corpo.token);
      /* mantém a sessão persistida em dia (mesma chave do CondoMasterPro) */
      try {
        const s = JSON.parse(localStorage.getItem("cm_sessao"));
        if (s) localStorage.setItem("cm_sessao", JSON.stringify({ ...s, token: corpo.token }));
      } catch { /* sem storage */ }
      return corpo.token;
    } catch { return null; }
    finally { renovando = null; }
  })();
  return renovando;
}

function agendarRenovacao(token) {
  if (timerRenovacao) { clearTimeout(timerRenovacao); timerRenovacao = null; }
  if (!token) return;
  const resta = expiraEmMs(token);
  if (resta == null) return; // token sem exp legível — não agenda
  const espera = Math.max(resta - MARGEM_MS, 1000);
  timerRenovacao = setTimeout(() => { renovarSessao(); }, espera);
}

/* quando o token restaurado já está vencido (aba reaberta depois de horas),
   a primeira carga precisa ESPERAR a renovação — senão o RLS nega tudo */
let bootRenovacao = null;

export function setAuthToken(token) {
  tokenAtual = token || null;
  supabase = criarCliente(tokenAtual);
  const resta = tokenAtual ? expiraEmMs(tokenAtual) : null;
  if (tokenAtual && resta != null && resta < MARGEM_MS) bootRenovacao = renovarSessao();
  else agendarRenovacao(tokenAtual);
}

/* aguarda a renovação de boot (se houver) — usada pelo loadAll */
export async function sessaoPronta() {
  if (bootRenovacao) { await bootRenovacao.catch(() => {}); bootRenovacao = null; }
}

export function getAuthToken() { return tokenAtual; }

/* Sair de verdade: revoga o refresh token no servidor (cookie HttpOnly) —
   melhor esforço; o logout local acontece de qualquer jeito. */
export function encerrarSessaoServidor() {
  try { fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); } catch { /* offline */ }
}
