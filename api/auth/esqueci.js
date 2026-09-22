/* POST /api/auth/esqueci  { perfil: diretor|sindico, email }  (sem autenticação)
   "Esqueci minha senha" do DIRETOR e do SÍNDICO — método tradicional: a
   pessoa informa o e-mail da conta e recebe um LINK de redefinição por
   e-mail (SMTP próprio), válido por 60 minutos e de uso único, consumido
   em /api/auth/redefinir. Tesouraria e morador continuam com o código da
   Etapa 4 (/api/auth/recuperar).

   Blindagem (Etapa 5):
   · resposta SEMPRE neutra ({ok:true}) — conta inexistente, e-mail
     sintético (.local) e até falha de envio respondem igual, para não
     revelar se o e-mail tem conta (a falha de envio fica no log e na
     auditoria com severidade alta);
   · config ausente é 503 ANTES de qualquer consulta — nunca vira oráculo;
   · rate-limit em que TODO pedido conta (cada um pode disparar e-mail):
     3/h por e-mail e 10/h por IP;
   · só o sha256 do token vai ao banco; um token ativo por conta;
   · fora da idempotência (replay só substitui o token — inofensivo);
   · sem o supabase-seguranca5.sql responde 503 sem derrubar nada. */
import { createClient } from "@supabase/supabase-js";
import { corpoValidado } from "../_lib/validar.js";
import {
  gerarTokenEmail, guardarTokenEmail, erroSemTabela,
  limitar, ipDoRequest, origemBloqueada, logSeguro, auditar,
} from "../_lib/seguranca.js";
import { smtpConfigurado, enviarEmail, emailRedefinicao } from "../_lib/email.js";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
const LOCK_EMAIL = { janelaSeg: 3600, max: 3, bloqueioSeg: 3600 };   // por e-mail alvo
const LOCK_IP = { janelaSeg: 3600, max: 10, bloqueioSeg: 3600 };     // por IP

/* mesma tolerância do login: a coluna preferencias pode não existir ainda */
const semColunaPreferencias = (e) =>
  !!e && /preferencias/i.test(e.message || "") && /does not exist|schema cache|column/i.test(e.message || "");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const serviceKey = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey)
    return res.status(503).json({ error: "Configure SUPABASE_SERVICE_ROLE_KEY no servidor." });
  /* config ausente responde 503 antes de olhar o corpo — assim o 503 nunca
     depende de a conta existir e não serve de oráculo */
  if (!smtpConfigurado())
    return res.status(503).json({ error: "Envio de e-mail não configurado — defina SMTP_HOST, SMTP_PORT, SMTP_USER e SMTP_PASS no servidor." });
  if (origemBloqueada(req, res)) return;
  const supabase = createClient(envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL, serviceKey);

  try {
    const f = corpoValidado(res, typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}), {
      perfil: { tipo: "enum", valores: ["diretor", "sindico"], obrigatorio: true },
      email:  { tipo: "email", obrigatorio: true },
    });
    if (!f) return;

    const ip = ipDoRequest(req);
    /* todo pedido conta (não só falhas): cada chamada pode disparar um e-mail */
    const [porEmail, porIp] = await Promise.all([
      limitar(supabase, `esqueci:${f.perfil}:${f.email}`, LOCK_EMAIL),
      limitar(supabase, `esqueci:ip:${ip}`, LOCK_IP),
    ]);
    if (porEmail.bloqueado || porIp.bloqueado) {
      await auditar(supabase, { evento: "recuperacao_email_bloqueada", severidade: "aviso", ip,
        detalhe: { perfil: f.perfil, email: f.email } });
      return res.status(429).json({ error: "Muitas tentativas — aguarde alguns minutos e tente de novo." });
    }

    const neutro = () => res.status(200).json({ ok: true });

    /* e-mail sintético interno (morador) nunca recebe link — recusa silenciosa */
    if (f.email.endsWith(".local")) {
      await auditar(supabase, { evento: "recuperacao_email_solicitada", ip,
        detalhe: { perfil: f.perfil, email: f.email, recusado: "sintetico" } });
      return neutro();
    }

    /* localiza a conta — mesma regra de perfil do login: vínculo com o
       perfil pedido, ou diretor recém-cadastrado sem vínculo nenhum */
    const buscar = (pref) => supabase.from("usuarios")
      .select(`id, ${pref}usuario_perfis(condominio_id, perfis(nome))`)
      .eq("email", f.email).maybeSingle();
    let { data, error } = await buscar("preferencias, ");
    if (semColunaPreferencias(error)) ({ data, error } = await buscar(""));
    if (error) throw new Error(error.message);
    const vinculo = (data?.usuario_perfis || []).find((up) => up.perfis?.nome === f.perfil);
    const perfilOk = vinculo || (f.perfil === "diretor" && !(data?.usuario_perfis || []).length);
    if (!data || !perfilOk) {
      /* equaliza o tempo com o caminho que grava e envia — resposta idêntica */
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 800));
      await auditar(supabase, { evento: "recuperacao_email_solicitada", ip,
        detalhe: { perfil: f.perfil, email: f.email, encontrado: false } });
      return neutro();
    }

    const token = gerarTokenEmail();
    const eTok = await guardarTokenEmail(supabase, { usuarioId: data.id, token });
    if (erroSemTabela(eTok))
      return res.status(503).json({ error: "Recuperação por e-mail ainda não habilitada — rode o supabase-seguranca5.sql." });
    if (eTok) throw new Error(eTok.message);

    const origem = req.headers.origin || `https://${req.headers.host}`;
    const link = `${origem}/redefinir-senha?token=${token}`;
    const idioma = ["pt", "es", "en"].includes(data.preferencias?.idioma) ? data.preferencias.idioma : "es";
    try {
      await enviarEmail({ para: f.email, ...emailRedefinicao({ link, perfil: f.perfil, idioma }) });
    } catch (e) {
      /* falha de ENVIO ≠ conta inexistente: um 500 aqui só aconteceria quando
         a conta existe, virando oráculo. Responde neutro; o operador vê a
         falha no log e na auditoria; o token órfão expira em 60 min. */
      logSeguro("[auth/esqueci] envio falhou:", e);
      await auditar(supabase, { evento: "recuperacao_email_falha_envio", severidade: "alta",
        usuarioId: data.id, condominioId: vinculo?.condominio_id || null, ip,
        detalhe: { perfil: f.perfil, email: f.email } });
      return neutro();
    }

    await auditar(supabase, { evento: "recuperacao_email_solicitada",
      usuarioId: data.id, condominioId: vinculo?.condominio_id || null, ip,
      detalhe: { perfil: f.perfil, email: f.email, encontrado: true } });
    return neutro();
  } catch (e) {
    if (e.semTabela || erroSemTabela(e))
      return res.status(503).json({ error: "Recuperação por e-mail ainda não habilitada — rode o supabase-seguranca5.sql." });
    logSeguro("[auth/esqueci]", e);
    return res.status(500).json({ error: "Erro ao processar a solicitação." });
  }
}
