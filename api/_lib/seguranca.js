/* Núcleo de segurança dos endpoints /api — Etapa 1 (auth + blindagem).
   Concentra o que antes vivia copiado em auth/login|registrar|condominio:
   · JWT de acesso CURTO (1h) — a sessão longa vive no refresh token
     (cookie HttpOnly com rotação, tabela auth_sessoes);
   · senha com scrypt + salt (formato "s2$N$r$p$salt$hash"); hashes legados
     em SHA-256 puro seguem aceitos no login e são migrados na hora;
   · lockout/rate-limit via RPC registrar_tentativa (supabase-seguranca.sql)
     — se o SQL ainda não rodou, degrada aberto com aviso no log;
   · cookie do refresh: HttpOnly + SameSite=Strict + Secure, Path=/api/auth
     (o navegador nunca expõe o token longo ao JavaScript). */
import { createHash, createHmac, timingSafeEqual, randomBytes, scryptSync, randomUUID } from "crypto";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };

/* ── JWT de acesso (HS256, mesmo formato que o RLS do Supabase valida) ── */
export const ACESSO_TTL_SEG = 60 * 60; // 1 hora — o refresh renova sem atrito
const b64u = (s) => Buffer.from(s).toString("base64url");

export const assinarToken = (claims, secret, ttlSeg = ACESSO_TTL_SEG) => {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ role: "authenticated", iss: "condomaster",
    exp: Math.floor(Date.now() / 1000) + ttlSeg, ...claims }));
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};

export const lerToken = (token, secret) => {
  try {
    const [h, p, sig] = String(token || "").split(".");
    const esperada = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(esperada))) return null;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    if (claims.exp && claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch { return null; }
};

export const lerClaimsReq = (req) => {
  const secret = envVal("SUPABASE_JWT_SECRET");
  if (!secret) return null;
  return lerToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), secret);
};

/* ── senha: scrypt com salt (novo) + SHA-256 legado (migrado no login) ── */
const SCRYPT = { N: 16384, r: 8, p: 1, len: 32 };

export const gerarHashSenha = (senha) => {
  const salt = randomBytes(16);
  const hash = scryptSync(String(senha), salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `s2$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
};

export const verificarSenha = (senha, guardado) => {
  const g = String(guardado || "");
  if (g.startsWith("s2$")) {
    const [, N, r, p, saltB64, hashB64] = g.split("$");
    try {
      const calc = scryptSync(String(senha), Buffer.from(saltB64, "base64url"),
        Buffer.from(hashB64, "base64url").length, { N: +N, r: +r, p: +p });
      return { ok: timingSafeEqual(calc, Buffer.from(hashB64, "base64url")), legado: false };
    } catch { return { ok: false, legado: false }; }
  }
  /* legado: SHA-256 hex puro (64 chars) — aceita e sinaliza para migrar */
  const calc = createHash("sha256").update(String(senha)).digest("hex");
  try {
    return { ok: timingSafeEqual(Buffer.from(calc), Buffer.from(g)), legado: true };
  } catch { return { ok: false, legado: true }; }
};

/* migração transparente: senha correta em formato legado → regrava em scrypt */
export async function migrarSenhaSeLegada(supabase, usuarioId, senha, resultado) {
  if (!resultado.ok || !resultado.legado) return;
  await supabase.from("usuarios").update({ senha_hash: gerarHashSenha(senha) })
    .eq("id", usuarioId).then(() => {}, (e) => console.error("[seguranca] migração de hash falhou:", e?.message));
}

/* ── refresh token (cookie HttpOnly + rotação na tabela auth_sessoes) ── */
export const REFRESH_TTL_SEG = 60 * 60 * 24 * 30; // 30 dias
const COOKIE = "cm_refresh";
const hashToken = (t) => createHash("sha256").update(t).digest("hex");

const cookieRefresh = (valor, maxAgeSeg) =>
  `${COOKIE}=${valor}; Max-Age=${maxAgeSeg}; Path=/api/auth; HttpOnly; Secure; SameSite=Strict`;

export const lerCookieRefresh = (req) => {
  const m = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
};

/* cria a sessão de refresh e grava o cookie na resposta. Falha silenciosa
   (ex.: supabase-seguranca.sql ainda não rodou) não impede o login. */
export async function emitirRefresh(supabase, res, { usuarioId, perfil, condominioId, familia = null }) {
  try {
    const token = randomBytes(32).toString("base64url");
    const { error } = await supabase.from("auth_sessoes").insert({
      usuario_id: usuarioId, familia: familia || randomUUID(), token_hash: hashToken(token),
      perfil, condominio_id: condominioId || null,
      expira_em: new Date(Date.now() + REFRESH_TTL_SEG * 1000).toISOString(),
    });
    if (error) throw new Error(error.message);
    res.setHeader("Set-Cookie", cookieRefresh(token, REFRESH_TTL_SEG));
    return true;
  } catch (e) {
    console.error("[seguranca] refresh não emitido (rode supabase-seguranca.sql?):", e.message);
    return false;
  }
}

/* valida + ROTACIONA o refresh do cookie. Reuso de token já rotacionado =
   possível roubo → revoga a família inteira. Devolve a sessão ou null. */
export async function rotacionarRefresh(supabase, req, res) {
  const token = lerCookieRefresh(req);
  if (!token) return null;
  const { data: sessao } = await supabase.from("auth_sessoes")
    .select("id, usuario_id, familia, perfil, condominio_id, expira_em, usado_em, revogada")
    .eq("token_hash", hashToken(token)).maybeSingle();
  if (!sessao) return null;

  if (sessao.revogada || sessao.usado_em) {
    /* token já consumido voltou a aparecer: derruba toda a cadeia */
    await supabase.from("auth_sessoes").update({ revogada: true }).eq("familia", sessao.familia);
    limparCookieRefresh(res);
    return null;
  }
  if (new Date(sessao.expira_em) < new Date()) { limparCookieRefresh(res); return null; }

  await supabase.from("auth_sessoes").update({ usado_em: new Date().toISOString() }).eq("id", sessao.id);
  const ok = await emitirRefresh(supabase, res, {
    usuarioId: sessao.usuario_id, perfil: sessao.perfil,
    condominioId: sessao.condominio_id, familia: sessao.familia,
  });
  return ok ? sessao : null;
}

export async function revogarRefresh(supabase, req, res) {
  const token = lerCookieRefresh(req);
  if (token) {
    const { data } = await supabase.from("auth_sessoes")
      .select("familia").eq("token_hash", hashToken(token)).maybeSingle();
    if (data) await supabase.from("auth_sessoes").update({ revogada: true }).eq("familia", data.familia);
  }
  limparCookieRefresh(res);
}

export const limparCookieRefresh = (res) => res.setHeader("Set-Cookie", cookieRefresh("", 0));

/* ── força bruta / rate-limit (RPC registrar_tentativa) ──
   chave: ex. "login:joao@x.com" ou "login:ip:1.2.3.4". Se a RPC não existe
   (SQL não rodado), degrada ABERTO com aviso — nunca tranca o app. */
export async function limitar(supabase, chave, { janelaSeg, max, bloqueioSeg }) {
  try {
    const { data, error } = await supabase.rpc("registrar_tentativa", {
      p_chave: chave.slice(0, 160), p_janela_seg: janelaSeg, p_max: max, p_bloqueio_seg: bloqueioSeg,
    });
    if (error) throw new Error(error.message);
    return { bloqueado: data?.bloqueado === true, ate: data?.ate || null };
  } catch (e) {
    console.error("[seguranca] rate-limit indisponível (rode supabase-seguranca.sql?):", e.message);
    return { bloqueado: false, ate: null };
  }
}

export async function limparLimite(supabase, chave) {
  await supabase.rpc("limpar_tentativas", { p_chave: chave.slice(0, 160) }).then(() => {}, () => {});
}

/* IP do cliente (Vercel/proxies primeiro; dev local cai no socket) */
export const ipDoRequest = (req) =>
  (String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || req.socket?.remoteAddress || "desconhecido").slice(0, 64);

/* ── Etapa 2: origem estrita (anti-CSRF / gateway) ──
   Allowlist EXPLÍCITA: o próprio host da API + APP_ORIGINS do .env (lista
   separada por vírgula, ex.: "https://condomaster.app,https://www.condomaster.app").
   Nunca wildcard. Requisições sem Origin (server-to-server, curl, webhooks
   da Stripe) passam — o objetivo é barrar NAVEGADOR de site alheio. */
export function origemBloqueada(req, res) {
  const origem = req.headers.origin;
  if (!origem) return false;
  try {
    const host = new URL(origem).host;
    if (host === req.headers.host) return false;
    const permitidas = String(process.env.APP_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (permitidas.some((p) => { try { return new URL(p).host === host; } catch { return p === host; } }))
      return false;
  } catch { /* Origin ilegível = bloqueia */ }
  res.status(403).json({ error: "Origem não autorizada." });
  return true;
}

/* ── Etapa 2: log com redação (OpSec) ──
   Nada de JWT, chave de API, cookie ou senha parar em log de servidor. */
const REDACOES = [
  [/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[jwt-redigido]"],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, "[chave-stripe-redigida]"],
  [/\bwhsec_[A-Za-z0-9]+/g, "[segredo-webhook-redigido]"],
  [/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redigido]"],
  [/cm_refresh=[^;\s"]+/g, "cm_refresh=[redigido]"],
  [/("?senha"?\s*[:=]\s*)"[^"]*"/gi, '$1"[redigida]"'],
];
export function logSeguro(tag, erro) {
  let msg = String(erro?.stack || erro?.message || erro);
  for (const [rx, sub] of REDACOES) msg = msg.replace(rx, sub);
  console.error(tag, msg);
}

/* ── Etapa 2: idempotência das operações mutantes ──
   O app manda "Idempotency-Key: <uuid>" a cada AÇÃO do usuário; o retry de
   rede reenvia a MESMA chave. Aqui:
   · 1ª chegada → reserva a chave (linha "processando") e intercepta o
     res.json para gravar a resposta ao final (5xx não é gravado — retry
     futuro pode tentar de novo);
   · repetição → devolve a resposta gravada (header Idempotency-Replayed),
     sem executar o handler de novo;
   · corrida (mesma chave em paralelo) → a 2ª espera a 1ª terminar (até 3s)
     e faz replay; reserva órfã (> 60s sem resposta) é tomada de volta.
   Sem a tabela (supabase-seguranca2.sql não rodado) degrada aberto.
   Uso no handler:
     const idem = await prepararIdempotencia(supabase, req, res, { usuarioId, rota });
     if (idem.repetida) return;  // já respondido */
export async function prepararIdempotencia(supabase, req, res, { usuarioId, rota }) {
  const chaveHeader = String(req.headers["idempotency-key"] || "").trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(chaveHeader)) return { ativa: false, repetida: false };
  const chave = `${usuarioId || "anon"}:${rota}:${chaveHeader}`.slice(0, 200);

  const reservar = () => supabase.from("api_idempotencia")
    .insert({ chave, usuario_id: usuarioId || null, rota });

  let { error: eIns } = await reservar();
  if (eIns && eIns.code !== "23505") {
    console.error("[seguranca] idempotência indisponível (rode supabase-seguranca2.sql?):", eIns.message);
    return { ativa: false, repetida: false };
  }

  if (eIns) {
    /* chave já vista: replay da resposta pronta, ou espera curta */
    for (let i = 0; i < 6; i++) {
      const { data } = await supabase.from("api_idempotencia")
        .select("status, corpo, criado_em").eq("chave", chave).maybeSingle();
      if (data?.status != null) {
        res.setHeader("Idempotency-Replayed", "true");
        res.status(data.status).json(data.corpo || {});
        return { ativa: true, repetida: true };
      }
      /* reserva órfã (processo morreu sem responder): assume o lugar */
      if (data && Date.now() - new Date(data.criado_em).getTime() > 60_000) {
        await supabase.from("api_idempotencia").delete().eq("chave", chave);
        ({ error: eIns } = await reservar());
        if (!eIns) break;
      }
      if (!data) { ({ error: eIns } = await reservar()); if (!eIns) break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (eIns) {
      res.status(409).json({ error: "Esta operação ainda está sendo processada — aguarde um instante e tente de novo." });
      return { ativa: true, repetida: true };
    }
  }

  /* dono da reserva: grava a resposta quando o handler responder */
  const jsonOriginal = res.json.bind(res);
  res.json = (obj) => {
    const st = res.statusCode || 200;
    const fim = st >= 500
      ? supabase.from("api_idempotencia").delete().eq("chave", chave)
      : supabase.from("api_idempotencia").update({ status: st, corpo: obj }).eq("chave", chave);
    fim.then(() => {}, () => {});
    return jsonOriginal(obj);
  };
  /* varredura ocasional das chaves com mais de 24h */
  if (Math.random() < 0.02)
    supabase.from("api_idempotencia").delete()
      .lt("criado_em", new Date(Date.now() - 24 * 3600 * 1000).toISOString()).then(() => {}, () => {});
  return { ativa: true, repetida: false };
}
