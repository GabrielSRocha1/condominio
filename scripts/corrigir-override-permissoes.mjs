/* REPARO: override de permissões CONGELADO no tempo. O override substitui o
   padrão inteiro (permsEfetivas), então todo código que entra na
   MATRIZ_PADRAO depois que o diretor salvou a customização nunca chega ao
   condomínio — foi assim que o menu do Administrador do Progreso I ficou sem
   Reservas/Assembleias (09/11), Fatura+licenca.pagar (22/11) e Histórico
   (23/11), com o override parado em 07/11.

   O que faz, por condomínio e perfil:
   1. se o perfil NÃO tem override, não faz nada (o padrão já vale);
   2. calcula o que falta: códigos do PADRÃO ATUAL do perfil que não estão
      no override, passados por sanearPerms — o mesmo funil do editor da
      tela (vedadas ao admin, fixas e códigos inexistentes ficam de fora);
   3. ADICIONA só esses. Não remove nada: o que o diretor tirou ou pôs de
      propósito permanece como está.

   Uso:  node scripts/corrigir-override-permissoes.mjs <trecho do nome>                        (ensaio, perfil administrador_predial)
         node scripts/corrigir-override-permissoes.mjs <trecho do nome> --perfil=sindico       (outro perfil)
         node scripts/corrigir-override-permissoes.mjs <trecho do nome> --aplicar              (grava) */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { norm } from "../src/lib/planilha.js";
import { permsPadrao, sanearPerms, infoPermissao, PERFIS_EDITAVEIS } from "../src/lib/permissoes.js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const admin = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const alvoNome = process.argv[2];
const APLICAR = process.argv.includes("--aplicar");
const perfilNome = (process.argv.find((a) => a.startsWith("--perfil=")) || "--perfil=administrador_predial").slice(9);

if (!alvoNome || !PERFIS_EDITAVEIS.includes(perfilNome)) {
  console.log(`uso: node scripts/corrigir-override-permissoes.mjs <trecho do nome do condomínio> [--perfil=${PERFIS_EDITAVEIS.join("|")}] [--aplicar]`);
  process.exitCode = 1;
} else {
  const { data: conds } = await admin.from("condominios").select("id, nome_fantasia");
  const cond = (conds || []).find((c) => norm(c.nome_fantasia || "").includes(norm(alvoNome)));
  if (!cond) { console.log(`condomínio "${alvoNome}" não encontrado — tem: ${(conds || []).map((c) => c.nome_fantasia).join(" · ")}`); process.exitCode = 1; }
  else {
    console.log(`${APLICAR ? "✍️  APLICANDO em" : "👓 ENSAIO (nada será gravado) —"} ${cond.nome_fantasia} · perfil ${perfilNome}`);
    const { data: perfil } = await admin.from("perfis").select("id, nome").eq("nome", perfilNome).single();
    if (!perfil) { console.log(`perfil "${perfilNome}" não existe na tabela perfis`); process.exitCode = 1; }
    else {
      const { data: ov } = await admin.from("perfil_overrides").select("id, atualizado_em")
        .eq("condominio_id", cond.id).eq("perfil_id", perfil.id).maybeSingle();
      if (!ov) { console.log("sem override para este perfil — o padrão já vale por inteiro, nada a fazer"); }
      else {
        const { data: pp } = await admin.from("perfil_permissoes").select("permissoes(id, codigo)")
          .eq("condominio_id", cond.id).eq("perfil_id", perfil.id);
        const atuais = new Set((pp || []).map((x) => x.permissoes?.codigo).filter(Boolean));
        const faltam = sanearPerms(perfilNome, [...atuais, ...permsPadrao(perfilNome)])
          .filter((c) => !atuais.has(c));
        console.log(`override de ${ov.atualizado_em?.slice(0, 10)} com ${atuais.size} código(s)`);
        if (!faltam.length) console.log("nenhum código do padrão atual está faltando — override em dia");
        else {
          for (const c of faltam) console.log(`  + ${c} — ${infoPermissao(c)?.rotulo || "?"}`);
          if (APLICAR) {
            /* ids do catálogo no banco — só dos que vamos inserir */
            const { data: cat } = await admin.from("permissoes").select("id, codigo").in("codigo", faltam);
            const porCodigo = new Map((cat || []).map((p) => [p.codigo, p.id]));
            const semCatalogo = faltam.filter((c) => !porCodigo.has(c));
            if (semCatalogo.length) console.log(`  ⚠️ fora do catálogo do banco (rode supabase-permissoes.sql): ${semCatalogo.join(", ")}`);
            const rows = faltam.filter((c) => porCodigo.has(c))
              .map((c) => ({ condominio_id: cond.id, perfil_id: perfil.id, permissao_id: porCodigo.get(c) }));
            const { error: eIns } = await admin.from("perfil_permissoes").insert(rows);
            if (eIns) { console.log(`  ⚠️ insert: ${eIns.message}`); process.exitCode = 1; }
            else {
              await admin.from("perfil_overrides").update({ atualizado_em: new Date().toISOString() }).eq("id", ov.id);
              console.log(`\ngravado: ${rows.length} código(s) adicionados ao override — sessões pegam no próximo login/renovação (≤1h)`);
            }
          } else console.log(`\nensaio: ${faltam.length} código(s) a adicionar · nada removido`);
        }
      }
    }
  }
}
process.exitCode = process.exitCode || 0;
