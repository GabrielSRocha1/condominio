/* POST /api/auth/login  { perfil, email?, nome?, senha }
   Confere as credenciais na tabela usuarios (morador entra pelo nome; os
   demais pelo e-mail) e devolve o token com o condomínio da conta — é esse
   token que o RLS usa para liberar apenas os dados do próprio prédio.

   Blindagem (Etapa 1):
   · lockout de força bruta por conta E por IP (auth_protecao) — só FALHAS
     contam; resposta 429 genérica, sem revelar se a conta existe;
   · senha em scrypt+salt; hash legado (SHA-256) é aceito e migrado na hora;
   · JWT de acesso de 1h + refresh token em cookie HttpOnly (auth_sessoes,
     rotação em /api/auth/refresh);
   · payload validado deny-by-default. */
import { createClient } from "@supabase/supabase-js";
import { corpoValidado } from "../_lib/validar.js";
import {
  assinarToken, verificarSenha, migrarSenhaSeLegada, emitirRefresh,
  limitar, limparLimite, ipDoRequest, origemBloqueada, logSeguro,
} from "../_lib/seguranca.js";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
const PERFIS = ["diretor", "sindico", "tesouraria", "morador", "administradora"];
const LOCK = { janelaSeg: 15 * 60, max: 5, bloqueioSeg: 15 * 60 };       // por conta
const LOCK_IP = { janelaSeg: 15 * 60, max: 30, bloqueioSeg: 15 * 60 };   // por IP (várias contas)

/* bloqueio vigente? (leitura pura — não incrementa nada) */
async function bloqueado(supabase, chave) {
  const { data } = await supabase.from("auth_protecao")
    .select("bloqueado_ate").eq("chave", chave).maybeSingle();
  return !!(data?.bloqueado_ate && new Date(data.bloqueado_ate) > new Date());
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const secret = envVal("SUPABASE_JWT_SECRET");
  const serviceKey = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !serviceKey)
    return res.status(503).json({ error: "Configure SUPABASE_JWT_SECRET e SUPABASE_SERVICE_ROLE_KEY no servidor." });
  if (origemBloqueada(req, res)) return;
  const supabase = createClient(envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL, serviceKey);

  try {
    const f = corpoValidado(res, typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}), {
      perfil: { tipo: "enum", valores: PERFIS, obrigatorio: true },
      email:  { tipo: "email" },
      nome:   { tipo: "texto", max: 120 },
      senha:  { tipo: "texto", max: 200, obrigatorio: true },
    });
    if (!f) return;

    const ip = ipDoRequest(req);
    const identidade = f.perfil === "morador" ? (f.nome || "").toLowerCase() : (f.email || "");
    if (!identidade) return res.status(400).json({ error: "Informe as credenciais." });
    const chaveConta = `login:${f.perfil}:${identidade}`;
    const chaveIp = `login:ip:${ip}`;

    if (await bloqueado(supabase, chaveConta) || await bloqueado(supabase, chaveIp))
      return res.status(429).json({ error: "Muitas tentativas — aguarde alguns minutos e tente de novo." });

    const nega = async () => {
      /* só a falha alimenta os contadores (uso legítimo nunca é punido) */
      const [porConta, porIp] = await Promise.all([
        limitar(supabase, chaveConta, LOCK), limitar(supabase, chaveIp, LOCK_IP),
      ]);
      if (porConta.bloqueado || porIp.bloqueado)
        return res.status(429).json({ error: "Muitas tentativas — aguarde alguns minutos e tente de novo." });
      return res.status(401).json({ error: "Credenciais incorretas." });
    };

    /* morador entra pelo nome cadastrado em Gerenciar Acessos */
    if (f.perfil === "morador") {
      const { data: rows, error } = await supabase.from("usuarios")
        .select("id, senha_hash, pessoas!inner(nome, pessoa_vinculos(papel, unidades(numero, blocos(nome)))), usuario_perfis(condominio_id, perfis(nome))")
        .ilike("pessoas.nome", f.nome || "");
      if (error) throw new Error(error.message);
      let conta = null, resultado = null;
      for (const r of rows || []) {
        if (!(r.usuario_perfis || []).some((up) => up.perfis?.nome === "morador")) continue;
        const v = verificarSenha(f.senha, r.senha_hash);
        if (v.ok) { conta = r; resultado = v; break; }
      }
      if (!conta) return nega();
      await migrarSenhaSeLegada(supabase, conta.id, f.senha, resultado);
      await limparLimite(supabase, chaveConta);

      const vincPerfil = conta.usuario_perfis.find((up) => up.perfis?.nome === "morador");
      const vincUnidade = (conta.pessoas?.pessoa_vinculos || []).find((v) => v.papel === "morador");
      const condominioId = vincPerfil?.condominio_id || null;
      const token = assinarToken({ sub: conta.id, nome: conta.pessoas.nome, perfil: "morador",
        condominio_id: condominioId }, secret);
      await emitirRefresh(supabase, res, { usuarioId: conta.id, perfil: "morador", condominioId });
      return res.status(200).json({ token, conta: {
        nome: conta.pessoas.nome, condominioId,
        unidade: vincUnidade?.unidades ? `${vincUnidade.unidades.numero}-${vincUnidade.unidades.blocos?.nome || "?"}` : null,
      } });
    }

    /* demais perfis entram pelo e-mail */
    if (!f.email) return res.status(400).json({ error: "Informe as credenciais." });
    const { data, error } = await supabase.from("usuarios")
      .select("id, email, senha_hash, pessoas(nome), usuario_perfis(condominio_id, perfis(nome))")
      .eq("email", f.email).maybeSingle();
    if (error) throw new Error(error.message);
    const resultado = data ? verificarSenha(f.senha, data.senha_hash) : { ok: false };
    if (!data || !resultado.ok) return nega();

    let vinculo = (data.usuario_perfis || []).find((up) => up.perfis?.nome === f.perfil);
    /* diretor recém-cadastrado (sem perfil ainda) também é diretor */
    if (!vinculo && !(f.perfil === "diretor" && !(data.usuario_perfis || []).length)) return nega();

    await migrarSenhaSeLegada(supabase, data.id, f.senha, resultado);
    await limparLimite(supabase, chaveConta);

    const nome = data.pessoas?.nome || "Diretor";
    const condominioId = vinculo?.condominio_id || null;
    const token = assinarToken({ sub: data.id, email: f.email, nome, perfil: f.perfil,
      condominio_id: condominioId }, secret);
    await emitirRefresh(supabase, res, { usuarioId: data.id, perfil: f.perfil, condominioId });
    return res.status(200).json({ token, conta: { nome, email: f.email, condominioId } });
  } catch (e) {
    logSeguro("[auth/login]", e);
    return res.status(500).json({ error: "Erro ao entrar." });
  }
}
