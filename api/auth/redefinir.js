/* POST /api/auth/redefinir  { token, senha }  (sem autenticação)
   Página /redefinir-senha: consome o token do LINK enviado por e-mail
   (Etapa 5 — diretor/síndico) e define a senha nova.

   Blindagem (mesma régua do /recuperar):
   · o token (64 hex) é localizado pelo sha256 — o link não carrega a
     identidade da conta; resposta de falha é genérica (401);
   · uso único com proteção de corrida (update condicional em usado_em);
   · senha nasce em scrypt e TODAS as sessões vivas são revogadas;
   · só FALHAS contam no rate-limit por IP (o token de 256 bits é a
     defesa principal; o limite é cinto e suspensório);
   · payload validado deny-by-default; sem o supabase-seguranca5.sql
     responde 503 sem derrubar nada. */
import { createClient } from "@supabase/supabase-js";
import { corpoValidado } from "../_lib/validar.js";
import {
  gerarHashSenha, sha256Hex, erroSemTabela,
  limitar, ipDoRequest, origemBloqueada, logSeguro, auditar,
} from "../_lib/seguranca.js";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
const LOCK_IP = { janelaSeg: 15 * 60, max: 10, bloqueioSeg: 15 * 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const serviceKey = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey)
    return res.status(503).json({ error: "Configure SUPABASE_SERVICE_ROLE_KEY no servidor." });
  if (origemBloqueada(req, res)) return;
  const supabase = createClient(envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL, serviceKey);

  try {
    const f = corpoValidado(res, typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}), {
      token: { tipo: "texto", max: 128, obrigatorio: true, padrao: /^[0-9a-f]{64}$/i },
      senha: { tipo: "texto", max: 200, obrigatorio: true },
    });
    if (!f) return;
    if (f.senha.length < 8)
      return res.status(400).json({ error: "A senha precisa de pelo menos 8 caracteres." });

    const ip = ipDoRequest(req);
    const nega = async () => {
      /* resposta única para token inexistente, vencido ou já usado */
      const { bloqueado } = await limitar(supabase, `redefinir:ip:${ip}`, LOCK_IP);
      await auditar(supabase, { evento: bloqueado ? "recuperacao_bloqueada" : "recuperacao_falha",
        severidade: "aviso", ip, detalhe: { canal: "email" } });
      if (bloqueado)
        return res.status(429).json({ error: "Muitas tentativas — aguarde alguns minutos e tente de novo." });
      return res.status(401).json({ error: "Link de redefinição inválido ou expirado — solicite um novo." });
    };

    const { data: tk, error } = await supabase.from("auth_recuperacao")
      .select("id, usuario_id, expira_em")
      .eq("codigo_hash", sha256Hex(f.token.toLowerCase()))
      .eq("canal", "email").is("usado_em", null).maybeSingle();
    if (error) throw Object.assign(new Error(error.message), { semTabela: erroSemTabela(error) });
    if (!tk || !tk.expira_em || new Date(tk.expira_em) <= new Date()) return nega();

    /* consumo com proteção de corrida: só um request vence o update condicional */
    const { data: usado, error: eUso } = await supabase.from("auth_recuperacao")
      .update({ usado_em: new Date().toISOString() }).eq("id", tk.id).is("usado_em", null).select("id");
    if (eUso) throw new Error(eUso.message);
    if (!usado?.length) return nega();

    const { error: eSenha } = await supabase.from("usuarios")
      .update({ senha_hash: gerarHashSenha(f.senha) }).eq("id", tk.usuario_id);
    if (eSenha) throw new Error(eSenha.message);
    await supabase.from("auth_sessoes").update({ revogada: true }).eq("usuario_id", tk.usuario_id)
      .then(() => {}, () => {}); // sem a tabela de sessões, a troca em si já vale

    /* perfil só para a trilha — o token nasce apenas para diretor/síndico */
    const { data: vincs } = await supabase.from("usuario_perfis")
      .select("condominio_id, perfis(nome)").eq("usuario_id", tk.usuario_id);
    const vinc = (vincs || []).find((v) => ["diretor", "sindico"].includes(v.perfis?.nome)) || null;
    await auditar(supabase, { evento: "senha_recuperada", severidade: "aviso",
      usuarioId: tk.usuario_id, condominioId: vinc?.condominio_id || null, ip,
      detalhe: { canal: "email", perfil: vinc?.perfis?.nome || "diretor" } });
    return res.status(200).json({ ok: true });
  } catch (e) {
    if (e.semTabela)
      return res.status(503).json({ error: "Recuperação por e-mail ainda não habilitada — rode o supabase-seguranca5.sql." });
    logSeguro("[auth/redefinir]", e);
    return res.status(500).json({ error: "Erro ao redefinir a senha." });
  }
}
