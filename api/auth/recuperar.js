/* POST /api/auth/recuperar  { perfil, email?, nome?, codigo, senha }
   "Esqueci minha senha" da tela de entrada, sem e-mail: a pessoa apresenta
   um código de recuperação de uso único (gerado pelo diretor em Gerenciar
   Acessos — o do próprio diretor é permanente) e define a senha nova.
   Morador se identifica pelo nome; os demais perfis, pelo e-mail.

   Blindagem (mesma régua do login):
   · lockout por conta E por IP — só FALHAS contam; resposta genérica,
     sem revelar se a conta ou o código existem;
   · só o sha256 do código vive no banco; comparação em tempo constante;
   · uso marca usado_em (código não se repete), senha nasce em scrypt e
     TODAS as sessões vivas da conta são revogadas (auth_sessoes);
   · payload validado deny-by-default; sem a tabela (supabase-seguranca4.sql
     não rodado) responde 503 sem derrubar nada. */
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { corpoValidado } from "../_lib/validar.js";
import {
  gerarHashSenha, sha256Hex, limitar, limparLimite, ipDoRequest,
  origemBloqueada, logSeguro, auditar,
} from "../_lib/seguranca.js";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
const PERFIS = ["diretor", "sindico", "tesouraria", "morador", "administradora"];
const LOCK = { janelaSeg: 15 * 60, max: 5, bloqueioSeg: 15 * 60 };       // por conta
const LOCK_IP = { janelaSeg: 15 * 60, max: 30, bloqueioSeg: 15 * 60 };   // por IP

/* o código circula como "XXXX-XXXX-XXXX-XXXX"; o hash é do miolo normalizado */
const normalizarCodigo = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const semTabela = (e) => !!e && /does not exist|schema cache/i.test(e.message || "");
const hashConfere = (a, b) => {
  try { return timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
};

/* código ativo da conta que bate com o hash apresentado (uso único, prazo ok) */
async function codigoValido(supabase, usuarioId, hash) {
  const { data, error } = await supabase.from("auth_recuperacao")
    .select("id, codigo_hash, expira_em").eq("usuario_id", usuarioId).is("usado_em", null);
  if (error) throw Object.assign(new Error(error.message), { semTabela: semTabela(error) });
  return (data || []).find((c) =>
    (!c.expira_em || new Date(c.expira_em) > new Date()) && hashConfere(c.codigo_hash, hash)) || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const serviceKey = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey)
    return res.status(503).json({ error: "Configure SUPABASE_SERVICE_ROLE_KEY no servidor." });
  if (origemBloqueada(req, res)) return;
  const supabase = createClient(envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL, serviceKey);

  try {
    const f = corpoValidado(res, typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}), {
      perfil: { tipo: "enum", valores: PERFIS, obrigatorio: true },
      email:  { tipo: "email" },
      nome:   { tipo: "texto", max: 120 },
      codigo: { tipo: "texto", max: 40, obrigatorio: true },
      senha:  { tipo: "texto", max: 200, obrigatorio: true },
    });
    if (!f) return;
    if (f.senha.length < 8)
      return res.status(400).json({ error: "A senha precisa de pelo menos 8 caracteres." });

    const ip = ipDoRequest(req);
    const identidade = f.perfil === "morador" ? (f.nome || "").toLowerCase() : (f.email || "");
    if (!identidade) return res.status(400).json({ error: "Informe as credenciais." });
    const chaveConta = `recuperar:${f.perfil}:${identidade}`;
    const chaveIp = `recuperar:ip:${ip}`;

    const nega = async () => {
      /* resposta única para conta inexistente e código errado — nada vaza */
      const [porConta, porIp] = await Promise.all([
        limitar(supabase, chaveConta, LOCK), limitar(supabase, chaveIp, LOCK_IP),
      ]);
      const virouBloqueio = porConta.bloqueado || porIp.bloqueado;
      await auditar(supabase, { evento: virouBloqueio ? "recuperacao_bloqueada" : "recuperacao_falha",
        severidade: "aviso", ip, detalhe: { perfil: f.perfil, identidade } });
      if (virouBloqueio)
        return res.status(429).json({ error: "Muitas tentativas — aguarde alguns minutos e tente de novo." });
      return res.status(401).json({ error: "Código de recuperação inválido ou expirado." });
    };

    const hash = sha256Hex(normalizarCodigo(f.codigo));

    /* localiza a conta e o código que bate — morador pode ter homônimos,
       então o código é quem desambigua (mesma lógica da senha no login) */
    let usuarioId = null, nomeConta = null, condominioId = null, codigo = null;
    if (f.perfil === "morador") {
      const { data: rows, error } = await supabase.from("usuarios")
        .select("id, pessoas!inner(nome), usuario_perfis(condominio_id, perfis(nome))")
        .ilike("pessoas.nome", f.nome || "");
      if (error) throw new Error(error.message);
      for (const r of rows || []) {
        const vinc = (r.usuario_perfis || []).find((up) => up.perfis?.nome === "morador");
        if (!vinc) continue;
        const c = await codigoValido(supabase, r.id, hash);
        if (c) { usuarioId = r.id; nomeConta = r.pessoas?.nome; condominioId = vinc.condominio_id; codigo = c; break; }
      }
    } else {
      if (!f.email) return res.status(400).json({ error: "Informe as credenciais." });
      const { data, error } = await supabase.from("usuarios")
        .select("id, pessoas(nome), usuario_perfis(condominio_id, perfis(nome))")
        .eq("email", f.email).maybeSingle();
      if (error) throw new Error(error.message);
      const vinculo = (data?.usuario_perfis || []).find((up) => up.perfis?.nome === f.perfil);
      /* diretor recém-cadastrado (sem perfil ainda) também é diretor */
      const perfilOk = vinculo || (f.perfil === "diretor" && !(data?.usuario_perfis || []).length);
      if (data && perfilOk) {
        const c = await codigoValido(supabase, data.id, hash);
        if (c) { usuarioId = data.id; nomeConta = data.pessoas?.nome; condominioId = vinculo?.condominio_id || null; codigo = c; }
      }
    }
    if (!usuarioId) return nega();

    /* troca efetiva: consome o código, regrava a senha e derruba as sessões */
    const { error: eUso } = await supabase.from("auth_recuperacao")
      .update({ usado_em: new Date().toISOString() }).eq("id", codigo.id).is("usado_em", null);
    if (eUso) throw new Error(eUso.message);
    const { error: eSenha } = await supabase.from("usuarios")
      .update({ senha_hash: gerarHashSenha(f.senha) }).eq("id", usuarioId);
    if (eSenha) throw new Error(eSenha.message);
    await supabase.from("auth_sessoes").update({ revogada: true }).eq("usuario_id", usuarioId)
      .then(() => {}, () => {}); // sem a tabela de sessões, a troca em si já vale

    await limparLimite(supabase, chaveConta);
    await auditar(supabase, { evento: "senha_recuperada", severidade: "aviso", usuarioId, condominioId,
      ip, detalhe: { perfil: f.perfil, nome: nomeConta || undefined } });
    return res.status(200).json({ ok: true });
  } catch (e) {
    if (e.semTabela)
      return res.status(503).json({ error: "Recuperação de senha ainda não habilitada — rode o supabase-seguranca4.sql." });
    logSeguro("[auth/recuperar]", e);
    return res.status(500).json({ error: "Erro ao recuperar a senha." });
  }
}
