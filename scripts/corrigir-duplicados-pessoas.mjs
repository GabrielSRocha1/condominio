/* REPARO: funde cadastros DUPLICADOS da mesma pessoa — o que o reparo dos
   pagadores deixou para trás: o dono de vários apartamentos virou várias
   pessoas de mesmo nome, uma com o documento real e as outras presas no
   provisório "P-…" ("doc já usado"); e a unificação pela tela, quando
   abortava no meio, deixava um cadastro sem vínculos sobrando.

   A decisão de quem funde com quem é PURA (planoDeDuplicados em
   src/lib/pessoas.js, sondada): mesmo nome + no máximo UM documento real.
   Nome igual com DOIS documentos reais não decide — reporta.

   Para cada fusão (origem → destino):
   · reponta pessoa_vinculos (UPDATE — preserva os ids, chamados os usam),
     unidades.responsavel_financeiro_id, cobrancas.responsavel_id,
     penalidades.infrator_id, usuarios.pessoa_id (service role pode);
   · deduplica vínculo vigente idêntico (mesma unidade+papel, fica o mais
     antigo; funcionário/prestador nunca saem);
   · preenche telefone/e-mail/documento_url VAZIOS do destino com os da origem;
   · apaga a origem (FK imprevisto → ela fica e é reportada).

   Uso:  node scripts/corrigir-duplicados-pessoas.mjs <trecho do nome>            (ensaio)
         node scripts/corrigir-duplicados-pessoas.mjs <trecho do nome> --aplicar  (grava) */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { planoDeDuplicados, camposQueFaltam } from "../src/lib/pessoas.js";
import { norm } from "../src/lib/planilha.js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const admin = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const alvoNome = process.argv[2];
const APLICAR = process.argv.includes("--aplicar");
if (!alvoNome) { console.log("uso: node scripts/corrigir-duplicados-pessoas.mjs <trecho do nome do condomínio> [--aplicar]"); process.exitCode = 1; }
else {
  const { data: conds } = await admin.from("condominios").select("id, nome_fantasia");
  const cond = (conds || []).find((c) => norm(c.nome_fantasia || "").includes(norm(alvoNome)));
  if (!cond) { console.log(`condomínio "${alvoNome}" não encontrado — tem: ${(conds || []).map((c) => c.nome_fantasia).join(" · ")}`); process.exitCode = 1; }
  else {
    console.log(`${APLICAR ? "✍️  APLICANDO em" : "👓 ENSAIO (nada será gravado) —"} ${cond.nome_fantasia}`);

    const { data: pessoas } = await admin.from("pessoas")
      .select("id, nome, cpf_cnpj, telefone, email, documento_url, criado_em").eq("condominio_id", cond.id);
    const porId = new Map((pessoas || []).map((p) => [p.id, p]));
    const { fusoes, ambiguas } = planoDeDuplicados((pessoas || []).map((p) => ({
      id: p.id, nome: p.nome, doc: p.cpf_cnpj, criadoEm: p.criado_em,
    })));

    for (const ids of ambiguas)
      console.log(`  ⚖️ "${porId.get(ids[0])?.nome}": ${ids.length} cadastros com documento REAL — pode ser gente diferente, decida na tela Pessoas`);

    let fundidas = 0, presas = 0;
    for (const { destino, origens } of fusoes) {
      const d = porId.get(destino);
      for (const oId of origens) {
        const o = porId.get(oId);
        console.log(`  "${o.nome}" (${o.cpf_cnpj}) → "${d.nome}" (${d.cpf_cnpj})`);
        if (!APLICAR) { fundidas++; continue; }

        await admin.from("pessoa_vinculos").update({ pessoa_id: destino }).eq("pessoa_id", oId);
        await admin.from("unidades").update({ responsavel_financeiro_id: destino }).eq("responsavel_financeiro_id", oId);
        await admin.from("cobrancas").update({ responsavel_id: destino }).eq("responsavel_id", oId);
        await admin.from("penalidades").update({ infrator_id: destino }).eq("infrator_id", oId);
        await admin.from("usuarios").update({ pessoa_id: destino }).eq("pessoa_id", oId);

        const falta = camposQueFaltam(d, o);
        if (Object.keys(falta).length) {
          await admin.from("pessoas").update(falta).eq("id", destino);
          Object.assign(d, falta); // o próximo origem do mesmo destino enxerga o preenchido
        }

        const { error: eDel } = await admin.from("pessoas").delete().eq("id", oId);
        if (eDel) { presas++; console.log(`    ⚠️ origem ficou (FK): ${eDel.message}`); }
        else fundidas++;
      }

      if (APLICAR) {
        /* vínculos vigentes idênticos que a repontagem juntou: fica o mais antigo */
        const { data: vig } = await admin.from("pessoa_vinculos")
          .select("id, unidade_id, papel, criado_em").eq("pessoa_id", destino).is("fim", null);
        const vistos = new Set();
        for (const v of (vig || []).sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)))) {
          const k = `${v.unidade_id || ""}|${v.papel}`;
          if (vistos.has(k) && !["funcionario", "prestador"].includes(v.papel))
            await admin.from("pessoa_vinculos").delete().eq("id", v.id);
          else vistos.add(k);
        }
      }
    }
    console.log(`\n${APLICAR ? "gravado" : "ensaio"}: ${fundidas} cadastro(s) fundido(s)${presas ? ` · ${presas} origem(ns) presa(s) por FK` : ""} · ${ambiguas.length} grupo(s) ambíguo(s)`);
  }
}
process.exitCode = process.exitCode || 0;
