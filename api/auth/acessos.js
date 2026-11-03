/* POST /api/auth/acessos  (Authorization: Bearer — quem tem `acesso.gerir`)
   Gerenciar Acessos do condomínio, agora 100% no servidor:
     { acao: "criar",   perfil, nome?, email?, senha, unidadeId? }
     { acao: "listar" }
     { acao: "remover", usuarioId }
     { acao: "codigo",  usuarioId }   → código de recuperação de 24h para
       TESOURARIA ou MORADOR do condomínio — a pessoa o usa em "Esqueci
       minha senha" na tela de entrada (/api/auth/recuperar). Diretor e
       síndico não usam código (Etapa 5): redefinem a senha por link
       enviado ao e-mail, então o caminho "permanente para si" saiu daqui.

   Por que saiu do navegador: com escrita client-side em usuarios e
   usuario_perfis, qualquer perfil de gestão conseguia se promover a diretor
   e ler hashes de senha via supabase-js. Aqui a service role executa, mas a
   AUTORIZAÇÃO é conferida no topo (permissão `acesso.gerir` no próprio
   condomínio), o perfil criável é whitelist — e o de DIRETOR só o diretor
   cria, remove ou enxerga — e a senha nasce em scrypt+salt.

   Este arquivo é onde moram duas das quatro exceções do Administrador
   (criar e remover acesso de diretor), e é aqui porque ele roda com service
   role: nenhum gatilho de banco alcança o que passa por aqui, e o navegador
   não tem outro caminho para `usuarios`/`usuario_perfis`. A terceira
   exceção (não excluir a pessoa do diretor) é gatilho, porque esse caminho
   sai direto do navegador — seção E do supabase-aprovacoes.sql. */
import { createClient } from "@supabase/supabase-js";
import { corpoValidado } from "../_lib/validar.js";
import {
  lerClaimsReq, gerarHashSenha, gerarCodigoRecuperacao, guardarCodigoRecuperacao, erroSemTabela,
  origemBloqueada, prepararIdempotencia, logSeguro, auditar, ipDoRequest,
} from "../_lib/seguranca.js";
import { carregarPerms, doClaims } from "../_lib/permissoes.js";
import {
  PERFIS_CRIAVEIS, PERFIL_SO_DIRETOR_CRIA, PERFIL_TUDO, podeCriarPerfil,
} from "../../src/lib/permissoes.js";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
/* papel do morador NA UNIDADE (pessoa_vinculos.papel) — eixo diferente do
   perfil de acesso: todo mundo aqui entra como "morador", e é o papel que
   diz se a conta é do dono. O enum vinculo_papel do schema aceita mais
   valores (coproprietario, dependente…); aqui ficam só os três que o
   diretor escolhe na tela. */
const PAPEIS_UNIDADE = ["proprietario", "inquilino", "morador"];
const CODIGO_TTL_MS = 24 * 3600 * 1000; // código gerado para outra pessoa vale 24h

/* vínculo que carrega a unidade da conta. NÃO procurar por papel ==
   'morador': desde que o diretor pode marcar o morador como proprietário,
   filtrar por papel fazia a unidade (e com ela boletos, multas e entregas
   do portal) desaparecer. */
const vinculoDaUnidade = (vinculos) =>
  (vinculos || []).find((v) => v.unidades || v.unidade_id) || (vinculos || [])[0] || null;

/* e-mail sintético do morador (entra pelo nome) — mesmo formato do frontend */
const emailMorador = (nome, condominioId) =>
  `morador+${nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, ".")}@${condominioId.slice(0, 8)}.local`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const serviceKey = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey)
    return res.status(503).json({ error: "Configure SUPABASE_SERVICE_ROLE_KEY no servidor." });

  const claims = lerClaimsReq(req);
  if (!claims?.condominio_id)
    return res.status(403).json({ error: "Apenas o diretor gerencia os acessos." });
  if (origemBloqueada(req, res)) return;
  const condominioId = claims.condominio_id;
  const supabase = createClient(envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL, serviceKey);

  /* autorização pela MATRIZ (antes era `perfil === "diretor"` cravado): o
     diretor pode delegar acesso.gerir a um síndico. Sem o
     supabase-permissoes.sql, carregarPerms degrada no padrão — onde só o
     diretor tem a permissão, exatamente como antes. O perfil criável segue
     na whitelist PERFIS_CRIAVEIS: ninguém cria um diretor por aqui. */
  const perms = await carregarPerms(supabase, doClaims(claims));
  if (!perms.has("acesso.gerir"))
    return res.status(403).json({ error: "Seu perfil não pode gerenciar os acessos." });

  try {
    const f = corpoValidado(res, typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}), {
      acao:      { tipo: "enum", valores: ["criar", "listar", "remover", "codigo", "papel"], obrigatorio: true },
      perfil:    { tipo: "enum", valores: PERFIS_CRIAVEIS },
      papel:     { tipo: "enum", valores: PAPEIS_UNIDADE },
      nome:      { tipo: "texto", max: 120 },
      email:     { tipo: "email" },
      senha:     { tipo: "texto", max: 200 },
      cargo:     { tipo: "texto", max: 80 },
      unidadeId: { tipo: "uuid" },
      usuarioId: { tipo: "uuid" },
    });
    if (!f) return;

    /* ── acesso de DIRETOR: só outro diretor cria ──
       A 1ª das quatro exceções do Administrador, e é cravada pelo PERFIL de
       quem pede, não pela matriz: um diretor novo decide a matriz de
       permissões, mexe na licença e pode remover quem o criou. Não existe
       código de permissão para "criar um par com poder total" justamente
       porque ele não deve ser delegável.
       Todo o resto deste endpoint vale NA HORA para quem tem `acesso.gerir`
       — criar, remover, trocar o papel na unidade e gerar código de
       recuperação (02/11/2026; antes disso o Administrador e o síndico
       operavam sob aprovação e a remoção virava pendência). O limite mora
       aqui, e não no banco, porque este arquivo roda com service role: é o
       único caminho para `usuarios`/`usuario_perfis`, que o navegador não
       escreve. */
    if (f.acao === "criar" && f.perfil && !podeCriarPerfil(claims.perfil, f.perfil))
      return res.status(403).json({ error: `Somente um diretor cria acesso de ${PERFIL_SO_DIRETOR_CRIA}.` });

    /* mutações (criar/remover) com retry de rede não podem duplicar.
       "codigo" fica de fora: o replay gravaria o código PURO no corpo da
       api_idempotencia — e gerar de novo já substitui o anterior, então o
       retry é inofensivo por natureza. */
    if (f.acao !== "listar" && f.acao !== "codigo") {
      const idem = await prepararIdempotencia(supabase, req, res,
        { usuarioId: claims.sub, rota: `auth/acessos:${f.acao}` });
      if (idem.repetida) return;
    }

    /* ── listar ── */
    if (f.acao === "listar") {
      /* preferencias carrega o CARGO de exibição; sem o alter da coluna
         (supabase-schema.sql), a consulta é refeita sem ela */
      const selecionar = (pref) => supabase.from("usuario_perfis")
        .select(`perfis(nome), usuarios(id, email, ${pref}pessoas(nome, pessoa_vinculos(papel, unidade_id, unidades(numero, blocos(nome)))))`)
        .eq("condominio_id", condominioId);
      let { data: rows, error } = await selecionar("preferencias, ");
      if (error && /preferencias/i.test(error.message || "")) ({ data: rows, error } = await selecionar(""));
      if (error) throw new Error(error.message);
      /* conta de DIRETOR aparece só para DIRETOR: desde que ele pode criar
         outro, esconder deixaria um acesso invisível e não removível na
         tela. Para os demais a lista segue sem elas — eles não mexem nessas
         contas (ver o 403 em "remover"), e o que não aparece não tenta. */
      const acessos = (rows || [])
        .filter((r) => r.perfis?.nome && r.usuarios
          && (r.perfis.nome !== "diretor" || claims.perfil === PERFIL_TUDO))
        .map((r) => {
          const u = r.usuarios, p = u.pessoas;
          const vinc = vinculoDaUnidade(p?.pessoa_vinculos);
          return {
            id: u.id, role: r.perfis.nome, nome: p?.nome || null,
            email: u.email.endsWith(".local") ? null : u.email,
            unidade: vinc?.unidades ? `${vinc.unidades.numero}-${vinc.unidades.blocos?.nome || "?"}` : null,
            papel: vinc?.papel || null,
            cargo: u.preferencias?.cargo || null,
          };
        });
      return res.status(200).json({ acessos });
    }

    /* ── remover ── */
    if (f.acao === "remover") {
      if (!f.usuarioId) return res.status(400).json({ error: "Informe usuarioId." });
      /* ninguém tira o próprio acesso: no caso do diretor, seria o
         condomínio ficando sem o único perfil que não pode ser trancado */
      if (f.usuarioId === claims.sub)
        return res.status(403).json({ error: "Você não pode remover o seu próprio acesso." });
      /* o alvo precisa pertencer AO MEU condomínio */
      const { data: alvo } = await supabase.from("usuario_perfis")
        .select("id, perfis(nome)").eq("usuario_id", f.usuarioId).eq("condominio_id", condominioId);
      if (!alvo?.length) return res.status(404).json({ error: "Acesso não encontrado." });
      /* ── 2ª exceção: conta de DIRETOR só outro diretor remove ──
         Quem não é diretor nem a enxerga na listagem acima, e aqui também
         não a alcança. Junto com a 1ª (criar), é o que mantém o diretor
         como único dono do próprio nível. */
      if (alvo.some((a) => a.perfis?.nome === "diretor") && claims.perfil !== PERFIL_TUDO)
        return res.status(403).json({ error: "A conta do diretor só é removida por outro diretor." });

      const { data: u } = await supabase.from("usuarios")
        .select("pessoa_id, email, pessoas(nome)").eq("id", f.usuarioId).maybeSingle();

      await supabase.from("auth_sessoes").update({ revogada: true }).eq("usuario_id", f.usuarioId)
        .then(() => {}, () => {}); // derruba sessões vivas do removido
      await supabase.from("usuario_perfis").delete().eq("usuario_id", f.usuarioId).eq("condominio_id", condominioId);
      const { error: eDel } = await supabase.from("usuarios").delete().eq("id", f.usuarioId);
      /* a conta assinou operações do condomínio (cobranças, multas,
         comunicados, portaria): apagá-la apagaria esse histórico, e o
         "Erro ao gerenciar os acessos" genérico do catch não diz nada a
         quem está olhando a tela */
      if (eDel) {
        if (/foreign key|violates/i.test(eDel.message || "")) {
          logSeguro("acessos remover fk", eDel);
          return res.status(409).json({ error: "Esta conta assinou operações do condomínio (cobranças, multas, comunicados ou portaria) e apagá-la apagaria esse histórico. Troque a senha dela, em vez de remover." });
        }
        throw new Error(eDel.message);
      }
      if (u?.pessoa_id) {
        await supabase.from("pessoa_vinculos").delete().eq("pessoa_id", u.pessoa_id).eq("condominio_id", condominioId);
        await supabase.from("pessoas").delete().eq("id", u.pessoa_id).then(() => {}, () => {}); // falha se referenciada — ok
      }
      await auditar(supabase, { evento: "acesso_removido", severidade: "aviso", usuarioId: claims.sub,
        condominioId, ip: ipDoRequest(req), detalhe: { usuario_alvo: f.usuarioId } });
      return res.status(200).json({ ok: true });
    }

    /* ── codigo: gera código de recuperação de senha (uso único) ── */
    if (f.acao === "codigo") {
      /* Etapa 5: código vale só para TESOURARIA e MORADOR — diretor e
         síndico redefinem a senha por link enviado ao e-mail */
      const alvoId = f.usuarioId || claims.sub;
      if (alvoId === claims.sub)
        return res.status(403).json({ error: "Sua senha agora se recupera por link no e-mail — use \"Esqueci minha senha\" na tela de entrada." });
      /* o alvo precisa pertencer AO MEU condomínio e ser tesouraria/morador */
      const { data: alvo } = await supabase.from("usuario_perfis")
        .select("id, perfis(nome)").eq("usuario_id", alvoId).eq("condominio_id", condominioId);
      if (!alvo?.length) return res.status(404).json({ error: "Acesso não encontrado." });
      if (alvo.some((a) => ["diretor", "sindico"].includes(a.perfis?.nome)))
        return res.status(403).json({ error: "Diretor e síndico recuperam a senha por link enviado ao e-mail." });

      const codigo = gerarCodigoRecuperacao();
      const expiraEm = new Date(Date.now() + CODIGO_TTL_MS).toISOString();
      const eCod = await guardarCodigoRecuperacao(supabase,
        { usuarioId: alvoId, criadoPor: claims.sub, expiraEm, codigo });
      if (erroSemTabela(eCod))
        return res.status(503).json({ error: "Recuperação de senha ainda não habilitada — rode o supabase-seguranca4.sql." });
      if (eCod) throw new Error(eCod.message);

      await auditar(supabase, { evento: "codigo_recuperacao_gerado", severidade: "aviso",
        usuarioId: claims.sub, condominioId, ip: ipDoRequest(req),
        detalhe: { usuario_alvo: alvoId, permanente: false } });
      return res.status(200).json({ codigo, expiraEm });
    }

    /* ── papel: proprietário / inquilino / morador na unidade ──
       Só muda pessoa_vinculos.papel; o perfil de ACESSO não é tocado (nada
       de escalar privilégio por aqui). É o que destrava o dashboard de
       leitura do portal para o dono da unidade — e o que permite corrigir
       os acessos antigos, todos criados como "morador". */
    if (f.acao === "papel") {
      if (!f.usuarioId || !f.papel)
        return res.status(400).json({ error: "Informe usuarioId e papel." });
      const { data: alvo } = await supabase.from("usuario_perfis")
        .select("id, perfis(nome)").eq("usuario_id", f.usuarioId).eq("condominio_id", condominioId);
      if (!alvo?.length) return res.status(404).json({ error: "Acesso não encontrado." });
      if (!alvo.some((a) => a.perfis?.nome === "morador"))
        return res.status(403).json({ error: "O papel na unidade vale só para acessos de morador." });

      const { data: u } = await supabase.from("usuarios").select("pessoa_id").eq("id", f.usuarioId).maybeSingle();
      if (!u?.pessoa_id) return res.status(404).json({ error: "Acesso sem pessoa vinculada." });
      const { data: atualizados, error: ePap } = await supabase.from("pessoa_vinculos")
        .update({ papel: f.papel }).eq("pessoa_id", u.pessoa_id).eq("condominio_id", condominioId)
        .is("fim", null).select("id");
      if (ePap) throw new Error(ePap.message);
      if (!atualizados?.length) return res.status(404).json({ error: "Vínculo da pessoa não encontrado." });

      await auditar(supabase, { evento: "acesso_papel_alterado", severidade: "aviso", usuarioId: claims.sub,
        condominioId, ip: ipDoRequest(req), detalhe: { usuario_alvo: f.usuarioId, papel: f.papel } });
      return res.status(200).json({ ok: true, papel: f.papel });
    }

    /* ── criar ── */
    if (!f.perfil) return res.status(400).json({ error: "Informe o perfil do acesso." });
    const ehMorador = f.perfil === "morador";
    if (ehMorador && !f.nome) return res.status(400).json({ error: "Informe o nome do morador." });
    if (!ehMorador && !f.email) return res.status(400).json({ error: "Informe o e-mail do acesso." });
    if (!f.senha || f.senha.length < 8)
      return res.status(400).json({ error: "A senha precisa de pelo menos 8 caracteres." });

    const nome = ehMorador ? f.nome : f.email.split("@")[0];
    const email = ehMorador ? emailMorador(f.nome, condominioId) : f.email;

    const { data: dup } = await supabase.from("usuarios").select("id").eq("email", email).maybeSingle();
    if (dup) return res.status(409).json({ error: ehMorador
      ? "Já existe um morador cadastrado com este nome." : "Já existe um acesso cadastrado com este e-mail." });

    if (f.unidadeId) {
      const { data: un } = await supabase.from("unidades")
        .select("id").eq("id", f.unidadeId).eq("condominio_id", condominioId).maybeSingle();
      if (!un) return res.status(404).json({ error: "Unidade não encontrada." });
    }

    const { data: pessoa, error: eP } = await supabase.from("pessoas").insert({
      condominio_id: condominioId, nome, tipo_pessoa: "fisica",
      cpf_cnpj: `P-${crypto.randomUUID().slice(0, 12)}`, email: ehMorador ? null : email,
    }).select().single();
    if (eP) throw new Error(eP.message);

    /* cargo de gestão (aba Gestão) é só RÓTULO — vive em usuarios.preferencias;
       o poder do acesso continua sendo o perfil. Sem o alter da coluna,
       grava sem o cargo (degrada aberto). */
    const cargo = String(f.cargo || "").trim().slice(0, 80);
    const semPreferencias = (e) => !!e && /preferencias/i.test(e.message || "") && /does not exist|schema cache|column/i.test(e.message || "");
    let ins = await supabase.from("usuarios").insert({
      pessoa_id: pessoa.id, email, senha_hash: gerarHashSenha(f.senha),
      ...(cargo ? { preferencias: { cargo } } : {}),
    }).select("id").single();
    if (cargo && semPreferencias(ins.error))
      ins = await supabase.from("usuarios").insert({
        pessoa_id: pessoa.id, email, senha_hash: gerarHashSenha(f.senha),
      }).select("id").single();
    const { data: usuario, error: eU } = ins;
    if (eU) throw new Error(eU.message);

    const { data: perfil, error: ePf } = await supabase.from("perfis").select("id").eq("nome", f.perfil).single();
    if (ePf) throw new Error(ePf.message);
    const { error: eUp } = await supabase.from("usuario_perfis").insert({
      usuario_id: usuario.id, condominio_id: condominioId, perfil_id: perfil.id,
    });
    if (eUp) throw new Error(eUp.message);

    /* morador: o papel na unidade vem da tela (padrão "morador"); os demais
       perfis seguem com o papel igual ao perfil de acesso.
       O erro é CONFERIDO: este insert ficou falhando em silêncio quando
       `administrador_predial` entrou como perfil sem existir no enum
       vinculo_papel, e o acesso nascia sem vínculo nenhum — a pessoa
       aparecia na tela Pessoas sem papel e sem unidade, sem nada indicar
       que algo tinha dado errado. */
    const { error: eVinc } = await supabase.from("pessoa_vinculos").insert({
      condominio_id: condominioId, pessoa_id: pessoa.id, unidade_id: f.unidadeId || null,
      papel: ehMorador ? (f.papel || "morador") : f.perfil,
      inicio: new Date().toISOString().slice(0, 10),
    });
    if (eVinc) return res.status(500).json({ error: /invalid input value for enum/i.test(eVinc.message)
      ? `O papel "${f.perfil}" não existe no banco — rode o supabase-aprovacoes.sql atual para habilitá-lo.`
      : `vínculo da pessoa: ${eVinc.message}` });
    /* morador vinculado à unidade vira o responsável financeiro dela */
    if (ehMorador && f.unidadeId)
      await supabase.from("unidades").update({ responsavel_financeiro_id: pessoa.id }).eq("id", f.unidadeId);

    await auditar(supabase, { evento: "acesso_criado", usuarioId: claims.sub, condominioId,
      ip: ipDoRequest(req), detalhe: { usuario_alvo: usuario.id, perfil: f.perfil } });
    return res.status(200).json({ id: usuario.id });
  } catch (e) {
    logSeguro("[auth/acessos]", e);
    return res.status(500).json({ error: "Erro ao gerenciar os acessos." });
  }
}
