/* REPARO: pessoas provisórias "Responsável X" criadas pela materialização
   da planilha ANTES do papel "nome" existir ganham o nome (e o documento)
   do pagador que a própria planilha traz.

   O que faz, por condomínio:
   1. corrige o papel das colunas da planilha cujo título é de pagador
      ("Datos"→nome, "RUC"→documento) — inferirPapel decide;
   2. por unidade, pega o pagador da linha mais RECENTE (coluna de data);
   3. renomeia cada pessoa placeholder (nome "Responsável …", cpf "P-…")
      que seja a responsável financeira da unidade, preenche o documento
      quando a planilha o traz (e ninguém mais o usa) e promove o vínculo
      morador→proprietario;
   4. se já EXISTE uma pessoa cadastrada com aquele nome ou documento,
      NÃO duplica: pula e reporta, para o diretor decidir na tela Unidades.

   Uso:  node scripts/corrigir-pagadores-planilha.mjs <trecho do nome>            (ensaio, só mostra)
         node scripts/corrigir-pagadores-planilha.mjs <trecho do nome> --aplicar  (grava)  */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { inferirPapel, docUtil, norm } from "../src/lib/planilha.js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const admin = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const alvoNome = process.argv[2];
const APLICAR = process.argv.includes("--aplicar");
if (!alvoNome) { console.log("uso: node scripts/corrigir-pagadores-planilha.mjs <trecho do nome do condomínio> [--aplicar]"); process.exitCode = 1; }
else {
  const { data: conds } = await admin.from("condominios").select("id, nome_fantasia");
  const cond = (conds || []).find((c) => norm(c.nome_fantasia || "").includes(norm(alvoNome)));
  if (!cond) { console.log(`condomínio "${alvoNome}" não encontrado — tem: ${(conds || []).map((c) => c.nome_fantasia).join(" · ")}`); process.exitCode = 1; }
  else {
    console.log(`${APLICAR ? "✍️  APLICANDO em" : "👓 ENSAIO (nada será gravado) —"} ${cond.nome_fantasia}`);

    /* 1 · colunas da planilha: título de pagador com papel errado */
    const { data: pls } = await admin.from("planilhas_cobranca").select("id, nome, colunas").eq("condominio_id", cond.id);
    const porUnidade = new Map(); // unidade_id → { quando, nome, doc }
    for (const pl of pls || []) {
      let mudou = false;
      const colunas = (pl.colunas || []).map((c) => {
        const certo = inferirPapel(c.titulo);
        if ((certo === "nome" || certo === "documento") && c.papel !== certo) {
          console.log(`  coluna "${c.titulo}" (${pl.nome}): papel ${c.papel || "—"} → ${certo}`);
          mudou = true;
          return { ...c, papel: certo };
        }
        return c;
      });
      if (mudou && APLICAR) {
        const { error } = await admin.from("planilhas_cobranca").update({ colunas, atualizado_em: new Date().toISOString() }).eq("id", pl.id);
        if (error) console.log("  ⚠️ colunas:", error.message);
      }
      const chaveDe = (papel) => colunas.find((c) => c.papel === papel)?.chave;
      const kNome = chaveDe("nome"), kDoc = chaveDe("documento"), kData = chaveDe("vencimento");
      if (!kNome) { console.log(`  planilha "${pl.nome}": sem coluna de pagador — nada a aproveitar`); continue; }

      /* 2 · pagador mais recente por unidade (paginado: >1000 linhas) */
      for (let de = 0; ; de += 1000) {
        const { data: lote, error } = await admin.from("planilha_cobranca_linhas")
          .select("unidade_id, dados").eq("planilha_id", pl.id).range(de, de + 999);
        if (error) { console.log("  ⚠️ linhas:", error.message); break; }
        for (const l of lote || []) {
          const nome = String(l.dados?.[kNome] ?? "").trim().slice(0, 160);
          if (!l.unidade_id || nome.length < 2) continue;
          const quando = String(l.dados?.[kData] ?? "");
          const atual = porUnidade.get(l.unidade_id);
          if (!atual || quando > atual.quando)
            porUnidade.set(l.unidade_id, { quando, nome, doc: docUtil(l.dados?.[kDoc]) });
        }
        if (!lote || lote.length < 1000) break;
      }
    }
    console.log(`pagador encontrado para ${porUnidade.size} unidade(s)`);

    /* 3 · placeholders que são responsáveis financeiros */
    const { data: pessoas } = await admin.from("pessoas").select("id, nome, cpf_cnpj").eq("condominio_id", cond.id);
    const docsUsados = new Set((pessoas || []).map((p) => p.cpf_cnpj));
    const nomesReais = new Map((pessoas || [])
      .filter((p) => !(/^responsável /i.test(p.nome) && /^P-/.test(p.cpf_cnpj)))
      .map((p) => [norm(p.nome), p]));
    const placeholders = new Map((pessoas || [])
      .filter((p) => /^responsável /i.test(p.nome) && /^P-/.test(p.cpf_cnpj))
      .map((p) => [p.id, p]));
    const { data: unidades } = await admin.from("unidades")
      .select("id, numero, responsavel_financeiro_id, blocos(nome)").eq("condominio_id", cond.id).is("deletado_em", null);

    let renomeadas = 0, comDoc = 0, puladas = 0, semPagador = 0;
    for (const u of unidades || []) {
      const ph = placeholders.get(u.responsavel_financeiro_id);
      if (!ph) continue;
      const rot = `${u.numero}-${u.blocos?.nome || "?"}`;
      const pag = porUnidade.get(u.id);
      if (!pag) { semPagador++; console.log(`  ${rot}: planilha sem pagador para esta unidade — fica "${ph.nome}"`); continue; }

      const jaExiste = nomesReais.get(norm(pag.nome));
      if (jaExiste) { puladas++; console.log(`  ${rot}: "${pag.nome}" JÁ cadastrado (${jaExiste.cpf_cnpj}) — placeholder mantido, troque na tela Unidades`); continue; }

      const docLivre = pag.doc && !docsUsados.has(pag.doc) ? pag.doc : null;
      console.log(`  ${rot}: "${ph.nome}" → "${pag.nome}"${docLivre ? ` · doc ${docLivre}` : pag.doc ? " · doc já usado, mantém P-…" : ""} · vínculo → proprietario`);
      if (APLICAR) {
        const { error: eP } = await admin.from("pessoas")
          .update({ nome: pag.nome, ...(docLivre ? { cpf_cnpj: docLivre } : {}), atualizado_em: new Date().toISOString() })
          .eq("id", ph.id);
        if (eP) { console.log("    ⚠️", eP.message); continue; }
        await admin.from("pessoa_vinculos").update({ papel: "proprietario" })
          .eq("pessoa_id", ph.id).eq("unidade_id", u.id).eq("papel", "morador");
      }
      if (docLivre) { docsUsados.add(docLivre); comDoc++; }
      renomeadas++;
    }
    console.log(`\n${APLICAR ? "gravado" : "ensaio"}: ${renomeadas} renomeada(s) (${comDoc} com documento) · ${puladas} pulada(s) por já existir · ${semPagador} sem pagador na planilha`);
  }
}
process.exitCode = process.exitCode || 0;
