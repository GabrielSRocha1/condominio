/* Sondas do HISTÓRICO DE COBRANÇAS POR PLANILHA.

   Bloco A (sem banco): gera um .xlsx com cabeçalhos FORA do padrão
   ("Apto", "Mês", "Cobrado", "Recebido") e confere que o app descobre
   sozinho as colunas, os tipos, o papel de cada uma e concilia.

   Bloco B (banco): roda contra as tabelas do supabase-planilhas.sql com
   o MESMO caminho do navegador — cliente anon + JWT do diretor, logo
   passando pelo RLS. Detecta sozinho se o SQL ainda não rodou e pula com
   ⏭️ em vez de falhar. O que ele prova: dedupe da 2ª carga, edição de
   célula, criação das cobranças que faltam e — o mais importante — que
   NENHUM lançamento entra no caixa.

   Uso: node scripts/testar-planilha-cobrancas.mjs   (dev server de pé) */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import {
  lerPlanilhaLivre, resolverLinha, conciliarPlanilha, valorCalculado,
  carregarExcelJS, normalizarCompetencia, paraNumero,
} from "../src/lib/planilha.js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const URL_SB = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const admin = createClient(URL_SB, env.SUPABASE_SERVICE_ROLE_KEY);
const clienteApp = (token) => createClient(URL_SB, env.VITE_SUPABASE_ANON_KEY,
  { global: { headers: { Authorization: `Bearer ${token}` } } });
const BASE = process.env.BASE || "http://localhost:5173";
const COND = "87e6ade7-264e-4b3a-9eef-30b4d78b83fb";   // condomínio TESTE Manuais
const COMP_TESTE = ["2019-01", "2019-02", "2019-03"];   // longe do cenário vivo

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };

/* ══ A · leitura de planilha com colunas livres (sem banco) ══ */
console.log("━━ A · planilha com as colunas do condomínio ━━");

const ExcelJS = await carregarExcelJS();
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Cobranças 2019");
ws.addRow(["Apto", "Mês", "Cobrado", "Recebido", "Vencimento"]);
ws.addRow(["101-A", "01/2019", "R$ 450,00", "450", "10/01/2019"]);
ws.addRow(["102-A", "01/2019", "R$ 450,00", "0", "10/01/2019"]);
ws.addRow(["101-A", "02/2019", "1.234,56", "1.234,56", "10/02/2019"]);
ws.addRow(["Total", "", "2.134,56", "1.684,56", ""]);   // linha sem unidade: não concilia
const buf = await wb.xlsx.writeBuffer();
const arquivo = { name: "historico-2019.xlsx", size: buf.byteLength, arrayBuffer: async () => buf };

const lido = await lerPlanilhaLivre(arquivo);
ok("lê a planilha sem modelo fixo", lido.linhas.length === 4 && lido.colunas.length === 5,
  `${lido.colunas.length} coluna(s), ${lido.linhas.length} linha(s) ${lido.errosGerais.join(" ")}`);
const porTitulo = Object.fromEntries(lido.colunas.map((c) => [c.titulo, c]));
ok("descobre o papel de cada coluna pelo cabeçalho",
  porTitulo.Apto?.papel === "unidade" && porTitulo["Mês"]?.papel === "competencia"
  && porTitulo.Cobrado?.papel === "valor" && porTitulo.Recebido?.papel === "pago"
  && porTitulo.Vencimento?.papel === "vencimento",
  lido.colunas.map((c) => `${c.titulo}→${c.papel || "—"}`).join(" "));
ok("infere o tipo das colunas", porTitulo.Cobrado?.tipo === "numero" && porTitulo.Vencimento?.tipo === "data",
  lido.colunas.map((c) => `${c.titulo}:${c.tipo}`).join(" "));
ok("converte \"R$ 1.234,56\" em número, não em texto",
  lido.linhas[2].dados[porTitulo.Cobrado.chave] === 1234.56,
  String(lido.linhas[2].dados[porTitulo.Cobrado.chave]));

/* unidades e cobranças de mentira, só para a conciliação */
const ctxFake = { unidades: [{ id: "u1", label: "101-A" }, { id: "u2", label: "102-A" }] };
const resolvidas = lido.linhas.map((l) => ({ ...l, ...resolverLinha(lido.colunas, l.dados, ctxFake) }));
ok("resolve unidade e competência das linhas",
  resolvidas[0].unidadeId === "u1" && resolvidas[0].competencia === "2019-01" && resolvidas[0].valor === 450,
  JSON.stringify({ u: resolvidas[0].unidadeId, c: resolvidas[0].competencia, v: resolvidas[0].valor }));
ok("linha de total (sem unidade) não finge ter chave", !resolvidas[3].unidadeId && resolvidas[3].competencia === "");

const cobrancasFake = [
  { unidadeId: "u1", competencia: "2019-01", valor: 450 },     // confere
  { unidadeId: "u2", competencia: "2019-01", valor: 430 },     // difere
  { unidadeId: "u2", competencia: "2019-02", valor: 450 },     // só no sistema
];
const conc = conciliarPlanilha(resolvidas, cobrancasFake);
const sit = (s) => conc.linhas.filter((l) => l.situacao === s).length;
ok("concilia nos quatro estados",
  sit("confere") === 1 && sit("difere") === 1 && sit("so_planilha") === 1 && sit("sem_chave") === 1 && conc.soSistema.length === 1,
  `confere ${sit("confere")} · difere ${sit("difere")} · só planilha ${sit("so_planilha")} · sem chave ${sit("sem_chave")} · só sistema ${conc.soSistema.length}`);
ok("pagamento vira status: 450 recebido = pago, 0 = em aberto",
  resolvidas[0].pago === true && resolvidas[1].pago === false);
const colCalc = { chave: "saldo", calculada: { esq: porTitulo.Cobrado.chave, op: "-", dir: porTitulo.Recebido.chave } };
ok("coluna calculada (Cobrado − Recebido)", valorCalculado(lido.linhas[1].dados, colCalc) === 450,
  String(valorCalculado(lido.linhas[1].dados, colCalc)));
ok("competência aceita os formatos do mundo real",
  normalizarCompetencia("set/2026") === "2026-09" && normalizarCompetencia("2026-09") === "2026-09"
  && normalizarCompetencia("9/2026") === "2026-09" && normalizarCompetencia("2026-09-15") === "2026-09");
ok("número não confunde milhar com decimal",
  paraNumero("1.234") === 1234 && paraNumero("1.23") === 1.23 && paraNumero("1,234.56") === 1234.56);

/* ══ B · banco, pelo caminho do navegador (anon + JWT, com RLS) ══ */
console.log("\n━━ B · gravação e conciliação no banco ━━");

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: "teste123" }),
}).then((r) => r.json()).catch(() => ({}));

if (!login.token) {
  for (const n of ["tabelas do supabase-planilhas.sql", "grava a planilha", "dedupe da 2ª carga",
    "edição de célula", "cria as cobranças que faltam", "não lança no caixa"])
    pula(n, `login do diretor falhou — o dev server está de pé em ${BASE}? (npm run dev)`);
} else {
  const app = clienteApp(login.token);
  const { error: eTab } = await app.from("planilhas_cobranca").select("id").limit(1);
  const semSql = eTab && /does not exist|schema cache|PGRST205/i.test(`${eTab.message} ${eTab.code || ""}`);
  ok("tabelas do supabase-planilhas.sql existem", !eTab, semSql ? "rode o supabase-planilhas.sql no SQL Editor" : (eTab?.message || "ok"));

  if (eTab) {
    for (const n of ["grava a planilha", "dedupe da 2ª carga", "edição de célula",
      "cria as cobranças que faltam", "não lança no caixa"])
      pula(n, "sem as tabelas");
  } else {
    /* unidades reais do condomínio de teste */
    const { data: unidades } = await admin.from("unidades")
      .select("id, numero, responsavel_financeiro_id, blocos(nome)").eq("condominio_id", COND).is("deletado_em", null);
    const ctx = { condominioId: COND, unidades: (unidades || []).map((u) => ({
      id: u.id, label: `${u.numero}-${u.blocos?.nome || "?"}`, responsavelId: u.responsavel_financeiro_id })) };
    const alvo = ctx.unidades.find((u) => u.responsavelId);

    /* limpeza de uma execução anterior interrompida */
    await admin.from("cobrancas").delete().eq("condominio_id", COND).in("competencia", COMP_TESTE);
    const { data: antigas } = await admin.from("planilhas_cobranca").select("id").eq("condominio_id", COND);
    for (const p of antigas || []) await admin.from("planilhas_cobranca").delete().eq("id", p.id);

    if (!alvo) {
      for (const n of ["grava a planilha", "dedupe da 2ª carga", "edição de célula",
        "cria as cobranças que faltam", "não lança no caixa"])
        pula(n, "nenhuma unidade com responsável financeiro — rode scripts/testar-manuais-seed.mjs");
    } else {
      const colunas = [
        { chave: "apto", titulo: "Apto", tipo: "texto", papel: "unidade", ordem: 0 },
        { chave: "mes", titulo: "Mês", tipo: "texto", papel: "competencia", ordem: 1 },
        { chave: "cobrado", titulo: "Cobrado", tipo: "numero", papel: "valor", ordem: 2 },
      ];
      const linhasPlan = COMP_TESTE.map((comp, i) => ({
        condominio_id: COND, dados: { apto: alvo.label, mes: comp, cobrado: 100 + i },
        unidade_id: alvo.id, competencia: comp, origem: "planilha", ordem: i + 1,
      }));

      const { data: pl, error: eP } = await app.from("planilhas_cobranca")
        .insert({ condominio_id: COND, nome: "Sonda 2019", colunas }).select().single();
      ok("grava a planilha (RLS do diretor permite)", !eP && !!pl?.id, eP?.message || pl?.id || "");

      if (pl?.id) {
        const comPlanilha = linhasPlan.map((l) => ({ ...l, planilha_id: pl.id }));
        const { error: eL } = await app.from("planilha_cobranca_linhas")
          .upsert(comPlanilha, { onConflict: "planilha_id,unidade_id,competencia" });
        const cont = async () => (await app.from("planilha_cobranca_linhas")
          .select("id", { count: "exact", head: true }).eq("planilha_id", pl.id)).count;
        ok("grava as linhas", !eL && (await cont()) === 3, eL?.message || `${await cont()} linha(s)`);

        /* 2ª carga do MESMO período: atualiza, não duplica */
        const { error: eL2 } = await app.from("planilha_cobranca_linhas")
          .upsert(comPlanilha.map((l) => ({ ...l, dados: { ...l.dados, cobrado: 999 } })),
            { onConflict: "planilha_id,unidade_id,competencia" });
        const depois = await cont();
        const { data: umaLinha } = await app.from("planilha_cobranca_linhas")
          .select("dados").eq("planilha_id", pl.id).eq("competencia", COMP_TESTE[0]).maybeSingle();
        ok("2ª carga acrescenta sem duplicar (dedupe por unidade + competência)",
          !eL2 && depois === 3 && umaLinha?.dados?.cobrado === 999, eL2?.message || `${depois} linha(s), valor ${umaLinha?.dados?.cobrado}`);

        /* edição de célula */
        const { data: alvoLinha } = await app.from("planilha_cobranca_linhas")
          .select("*").eq("planilha_id", pl.id).eq("competencia", COMP_TESTE[1]).maybeSingle();
        const { data: editada, error: eE } = await app.from("planilha_cobranca_linhas")
          .update({ dados: { ...alvoLinha.dados, cobrado: 777 } }).eq("id", alvoLinha.id).select().maybeSingle();
        ok("edita uma célula", !eE && editada?.dados?.cobrado === 777, eE?.message || String(editada?.dados?.cobrado));

        /* criar as cobranças que faltam — e NÃO lançar no caixa */
        const { count: lancAntes } = await admin.from("lancamentos")
          .select("id", { count: "exact", head: true }).eq("condominio_id", COND);
        const novas = COMP_TESTE.map((comp) => ({
          condominio_id: COND, unidade_id: alvo.id, responsavel_id: alvo.responsavelId,
          competencia: comp, tipo: "ordinaria", valor_original: 100, vencimento: `${comp}-10`, status: "paga",
        }));
        const { data: criadas, error: eC } = await app.from("cobrancas").insert(novas).select();
        ok("cria as cobranças que faltam", !eC && criadas?.length === 3, eC?.message || `${criadas?.length || 0} criada(s)`);

        if (criadas?.length) {
          const porComp = new Map(criadas.map((c) => [c.competencia, c.id]));
          for (const comp of COMP_TESTE)
            await app.from("planilha_cobranca_linhas").update({ cobranca_id: porComp.get(comp) })
              .eq("planilha_id", pl.id).eq("competencia", comp);
          const { count: vinculadas } = await app.from("planilha_cobranca_linhas")
            .select("id", { count: "exact", head: true }).eq("planilha_id", pl.id).not("cobranca_id", "is", null);
          ok("a linha passa a apontar a cobrança criada", vinculadas === 3, `${vinculadas}/3`);

          /* conciliação volta a 'confere' para as três */
          const comoNoApp = criadas.map((c) => ({ unidadeId: c.unidade_id, competencia: c.competencia, valor: Number(c.valor_original) }));
          const { data: linhasBanco } = await app.from("planilha_cobranca_linhas").select("*").eq("planilha_id", pl.id);
          const resolvidasBanco = linhasBanco.map((l) => ({ ...l, unidadeId: l.unidade_id, competencia: l.competencia, valor: l.dados.cobrado }));
          const conc2 = conciliarPlanilha(resolvidasBanco, comoNoApp);
          ok("depois de criar, nenhuma linha fica \"só na planilha\"",
            conc2.linhas.filter((l) => l.situacao === "so_planilha").length === 0,
            conc2.linhas.map((l) => l.situacao).join(" "));
        }

        const { count: lancDepois } = await admin.from("lancamentos")
          .select("id", { count: "exact", head: true }).eq("condominio_id", COND);
        ok("NÃO lança receita no caixa (saldo do dashboard intocado)", lancAntes === lancDepois,
          `lançamentos antes ${lancAntes} · depois ${lancDepois}`);

        /* morador NÃO escreve na planilha (RLS) */
        const loginM = await fetch(`${BASE}/api/auth/login`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ perfil: "morador", nome: "Morador Manuais", senha: "teste123" }),
        }).then((r) => r.json()).catch(() => ({}));
        if (!loginM.token) pula("morador não escreve na planilha", "login do morador falhou");
        else {
          const appM = clienteApp(loginM.token);
          const { error: eM } = await appM.from("planilha_cobranca_linhas")
            .insert({ condominio_id: COND, planilha_id: pl.id, dados: { apto: "x" }, ordem: 99 });
          const { data: leu } = await appM.from("planilha_cobranca_linhas").select("id").eq("planilha_id", pl.id).limit(1);
          ok("morador lê, mas não escreve na planilha (tenant_escrita)", !!eM && !!leu?.length,
            `escrita ${eM ? "bloqueada" : "PERMITIDA"} · leitura ${leu?.length ? "ok" : "bloqueada"}`);
        }

        /* limpeza */
        await admin.from("planilha_cobranca_linhas").update({ cobranca_id: null }).eq("planilha_id", pl.id);
        await admin.from("cobrancas").delete().eq("condominio_id", COND).in("competencia", COMP_TESTE);
        await admin.from("planilhas_cobranca").delete().eq("id", pl.id);
        const { count: sobrou } = await admin.from("planilha_cobranca_linhas")
          .select("id", { count: "exact", head: true }).eq("planilha_id", pl.id);
        ok("limpeza: cenário da sonda removido (cascade nas linhas)", sobrou === 0, `${sobrou} linha(s) restante(s)`);
      }
    }
  }
}

console.log(falhas
  ? `\n❌ ${falhas} sonda(s) falharam${puladas ? ` · ${puladas} pulada(s)` : ""}`
  : `\n📗 PLANILHA DE COBRANÇAS OK${puladas ? ` · ${puladas} pulada(s)` : ""}`);
/* exitCode em vez de process.exit(): com os sockets do supabase-js ainda
   abertos, a saída abrupta derruba o libuv com assert no Windows */
process.exitCode = falhas ? 1 : 0;
