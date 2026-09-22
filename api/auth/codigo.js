/* POST /api/auth/codigo  (Authorization: Bearer — só tesouraria e morador)
   A PRÓPRIA conta gera seu código de recuperação PERMANENTE — é o que o
   app sugere logo após o primeiro login (login devolve
   temCodigoRecuperacao=false). Com ele a pessoa usa "Esqueci minha senha"
   sozinha, sem depender do diretor; o diretor só entra em cena se ela
   perder a senha E o código (aí gera um de 24h em Gerenciar Acessos).
   DIRETOR e SÍNDICO não usam código (Etapa 5): redefinem a senha por
   link enviado ao e-mail (/api/auth/esqueci) e recebem 403 aqui.

   Um código ativo por conta: este substitui qualquer anterior não usado.
   Só o sha256 vai ao banco; o código puro aparece uma única vez aqui.
   Geração é auditada (o JWT de acesso dura 1h — um token roubado que gere
   código deixa trilha em auditoria_eventos). Sem a tabela
   (supabase-seguranca4.sql não rodado) responde 503 sem derrubar nada. */
import { createClient } from "@supabase/supabase-js";
import {
  lerClaimsReq, gerarCodigoRecuperacao, guardarCodigoRecuperacao, erroSemTabela,
  origemBloqueada, logSeguro, auditar, ipDoRequest,
} from "../_lib/seguranca.js";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const serviceKey = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey)
    return res.status(503).json({ error: "Configure SUPABASE_SERVICE_ROLE_KEY no servidor." });

  const claims = lerClaimsReq(req);
  if (!claims?.sub) return res.status(401).json({ error: "Entre novamente para gerar o código." });
  if (claims.perfil === "diretor" || claims.perfil === "sindico")
    return res.status(403).json({ error: "Diretor e síndico recuperam a senha por link enviado ao e-mail — o código vale só para tesouraria e morador." });
  if (origemBloqueada(req, res)) return;
  const supabase = createClient(envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL, serviceKey);

  try {
    const codigo = gerarCodigoRecuperacao();
    const eCod = await guardarCodigoRecuperacao(supabase,
      { usuarioId: claims.sub, criadoPor: claims.sub, expiraEm: null, codigo });
    if (erroSemTabela(eCod))
      return res.status(503).json({ error: "Recuperação de senha ainda não habilitada — rode o supabase-seguranca4.sql." });
    if (eCod) throw new Error(eCod.message);

    await auditar(supabase, { evento: "codigo_recuperacao_gerado", severidade: "aviso",
      usuarioId: claims.sub, condominioId: claims.condominio_id || null, ip: ipDoRequest(req),
      detalhe: { usuario_alvo: claims.sub, permanente: true, proprio: true, perfil: claims.perfil } });
    return res.status(200).json({ codigo, expiraEm: null });
  } catch (e) {
    logSeguro("[auth/codigo]", e);
    return res.status(500).json({ error: "Erro ao gerar o código de recuperação." });
  }
}
