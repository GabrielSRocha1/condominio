/* REPARO: competências "1905-xx" nascidas do ano solto lido como serial do
   Excel ("Correspondiente al mes/año" = 2020 → 07/1905) e competências
   nulas cujo texto o parser novo entende ("corresponde-julio 2012").

   O que faz, por condomínio:
   1. recalcula a competência de CADA linha da planilha a partir do dado
      cru, com o parser corrigido (normalizarCompetencia);
   2. linha 1905-xx → mês real quando o texto o traz; senão fica SEM
      competência (ano solto não diz o mês — honestidade > chute);
   3. cobrança vinculada a linha 1905-xx: ganha o mês real, ou é APAGADA
      quando não há mês — ela é artefato do bug (o app nunca deleta
      cobrança, mas estas nasceram do parser e não têm pagamento);
      se o mês real já tem cobrança ordinária ativa na unidade, a 1905 é
      duplicata e também sai;
   4. conflitos com o unique (planilha_id, unidade_id, competencia) viram
      competência nula + aviso, nunca erro.

   Uso:  node scripts/corrigir-competencias-planilha.mjs <trecho do nome>            (ensaio)
         node scripts/corrigir-competencias-planilha.mjs <trecho do nome> --aplicar  (grava) */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { normalizarCompetencia, norm } from "../src/lib/planilha.js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const admin = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const alvoNome = process.argv[2];
const APLICAR = process.argv.includes("--aplicar");
const bogus = (c) => !!c && c < "1970"; // 1905-07 etc.: nenhum condomínio cobra expensas de 1905

if (!alvoNome) { console.log("uso: node scripts/corrigir-competencias-planilha.mjs <trecho do nome do condomínio> [--aplicar]"); process.exitCode = 1; }
else {
  const { data: conds } = await admin.from("condominios").select("id, nome_fantasia");
  const cond = (conds || []).find((c) => norm(c.nome_fantasia || "").includes(norm(alvoNome)));
  if (!cond) { console.log(`condomínio "${alvoNome}" não encontrado — tem: ${(conds || []).map((c) => c.nome_fantasia).join(" · ")}`); process.exitCode = 1; }
  else {
    console.log(`${APLICAR ? "✍️  APLICANDO em" : "👓 ENSAIO (nada será gravado) —"} ${cond.nome_fantasia}`);
    const { data: pls } = await admin.from("planilhas_cobranca").select("id, nome, colunas").eq("condominio_id", cond.id);
    let corrigidas = 0, semMes = 0, cobrAjustadas = 0, cobrApagadas = 0, conflitos = 0, intactas = 0;

    for (const pl of pls || []) {
      const kComp = (pl.colunas || []).find((c) => c.papel === "competencia")?.chave;
      if (!kComp) { console.log(`  planilha "${pl.nome}": sem coluna de competência`); continue; }

      const linhas = [];
      for (let de = 0; ; de += 1000) {
        const { data: lote, error } = await admin.from("planilha_cobranca_linhas")
          .select("id, unidade_id, competencia, cobranca_id, dados").eq("planilha_id", pl.id).range(de, de + 999);
        if (error) { console.log("  ⚠️ linhas:", error.message); break; }
        linhas.push(...(lote || []));
        if (!lote || lote.length < 1000) break;
      }
      /* chaves já ocupadas no unique da planilha — atualizadas conforme movemos */
      const chaves = new Set(linhas.filter((l) => l.unidade_id && l.competencia)
        .map((l) => `${l.unidade_id}|${l.competencia}`));

      for (const l of linhas) {
        const alvo = normalizarCompetencia(l.dados?.[kComp]) || null;
        const mexer = bogus(l.competencia) || (!l.competencia && alvo);
        if (!mexer) { intactas++; continue; }
        const cru = JSON.stringify(l.dados?.[kComp] ?? "");

        let novo = alvo;
        if (novo && l.unidade_id && chaves.has(`${l.unidade_id}|${novo}`)) {
          conflitos++;
          console.log(`  linha ${l.competencia || "—"} (${cru}): mês real ${novo} JÁ tem linha nesta unidade — fica sem competência`);
          novo = null;
        }
        if (l.competencia) chaves.delete(`${l.unidade_id}|${l.competencia}`);
        if (novo) { chaves.add(`${l.unidade_id}|${novo}`); corrigidas++; }
        else semMes++;

        if (APLICAR) {
          const { error: eL } = await admin.from("planilha_cobranca_linhas")
            .update({ competencia: novo, atualizado_em: new Date().toISOString() }).eq("id", l.id);
          if (eL) { console.log(`  ⚠️ linha ${l.id}: ${eL.message}`); continue; }
        }

        /* a cobrança vinculada acompanha — ou sai, se é artefato sem mês */
        if (l.cobranca_id && bogus(l.competencia)) {
          if (novo) {
            const { data: jaTem } = await admin.from("cobrancas").select("id")
              .eq("unidade_id", l.unidade_id).eq("competencia", novo)
              .eq("tipo", "ordinaria").neq("status", "cancelada").neq("id", l.cobranca_id).limit(1);
            if (jaTem?.length) {
              cobrApagadas++;
              console.log(`  cobrança 1905 de ${cru}: ${novo} já tem cobrança ativa — artefato ${APLICAR ? "apagado" : "a apagar"}`);
              if (APLICAR) {
                const { error: eD } = await admin.from("cobrancas").delete().eq("id", l.cobranca_id);
                if (eD) console.log(`  ⚠️ apagar cobrança ${l.cobranca_id}: ${eD.message}`);
              }
            } else {
              cobrAjustadas++;
              if (APLICAR) {
                const { error: eC } = await admin.from("cobrancas")
                  .update({ competencia: novo, atualizado_em: new Date().toISOString() }).eq("id", l.cobranca_id);
                if (eC) console.log(`  ⚠️ cobrança ${l.cobranca_id}: ${eC.message}`);
              }
            }
          } else {
            cobrApagadas++;
            if (APLICAR) {
              const { error: eD } = await admin.from("cobrancas").delete().eq("id", l.cobranca_id);
              if (eD) console.log(`  ⚠️ apagar cobrança ${l.cobranca_id}: ${eD.message}`);
            }
          }
        }
      }
    }

    /* cobranças pré-1970 ÓRFÃS (a planilha foi recarregada e o vínculo
       linha→cobrança se perdeu): mesmos artefatos do bug — saem também.
       Quem tiver pagamento registrado trava no FK e fica, reportada. */
    const { data: soltas } = await admin.from("cobrancas").select("id, competencia, status")
      .eq("condominio_id", cond.id).lt("competencia", "1970-01");
    let orfasApagadas = 0, orfasPresas = 0;
    for (const c of soltas || []) {
      if (APLICAR) {
        const { error: eD } = await admin.from("cobrancas").delete().eq("id", c.id);
        if (eD) { orfasPresas++; console.log(`  ⚠️ cobrança órfã ${c.competencia} (${c.id}) ficou: ${eD.message}`); }
        else orfasApagadas++;
      } else orfasApagadas++;
    }
    console.log(`\n${APLICAR ? "gravado" : "ensaio"}: ${corrigidas} linha(s) com mês real recuperado · ${semMes} ficam sem competência (ano solto) · ${conflitos} conflito(s) de chave`);
    console.log(`cobranças vinculadas: ${cobrAjustadas} ajustada(s) para o mês real · ${cobrApagadas} artefato(s) ${APLICAR ? "apagado(s)" : "a apagar"}`);
    console.log(`cobranças órfãs pré-1970: ${orfasApagadas} ${APLICAR ? "apagada(s)" : "a apagar"}${orfasPresas ? ` · ${orfasPresas} presa(s) por pagamento/FK` : ""}`);
    console.log(`linhas intactas: ${intactas}`);
  }
}
process.exitCode = process.exitCode || 0;
