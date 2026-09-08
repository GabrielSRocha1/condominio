/* TEMPORÁRIO — confere se os objetos da conciliação manual existem no banco
   (hoje fazem parte do supabase-schema.sql): enum 'pagamento_informado',
   tabela pagamentos_informados, RPCs registrar_pagamento_manual /
   rejeitar_pagamento_informado, e mostra se o cenário do seed já existe.
   Só leitura + chamadas com id inexistente (não altera nada). */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const ok = (nome, passou, extra = "") => console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);

/* RUN 1: enum aceita 'pagamento_informado'? */
const enumTeste = await supabase.from("cobrancas").select("id").eq("status", "pagamento_informado").limit(1);
ok("RUN 1 · enum 'pagamento_informado'", !enumTeste.error, enumTeste.error?.message);

/* RUN 2: tabela pagamentos_informados */
const tab = await supabase.from("pagamentos_informados").select("id").limit(1);
ok("RUN 2 · tabela pagamentos_informados", !tab.error, tab.error?.message);

/* RUN 2: RPCs (id inexistente → erro de negócio, nunca 'does not exist') */
const NIL = "00000000-0000-0000-0000-000000000000";
const r1 = await supabase.rpc("registrar_pagamento_manual", {
  p_cobranca_id: NIL, p_forma: "dinheiro", p_valor: 1,
  p_pago_em: new Date().toISOString(), p_justificativa: "probe", p_tx: null, p_informado_id: null,
});
ok("RUN 2 · RPC registrar_pagamento_manual", !r1.error && r1.data?.erro === "cobranca_inexistente",
  r1.error?.message || JSON.stringify(r1.data));
const r2 = await supabase.rpc("rejeitar_pagamento_informado", { p_informado_id: NIL, p_motivo: "probe" });
ok("RUN 2 · RPC rejeitar_pagamento_informado", !r2.error && r2.data?.erro === "informe_inexistente",
  r2.error?.message || JSON.stringify(r2.data));

/* cenário do seed já existe? */
const { data: cond } = await supabase.from("condominios")
  .select("id, nome, regras_internas").eq("nome", "Condominio TESTE Manuais").maybeSingle();
if (!cond) { console.log("\nℹ️ cenário do seed: NÃO existe ainda (rodar o seed)"); process.exit(0); }
console.log(`\nℹ️ cenário do seed: existe — ${cond.id}`);
console.log(`   moeda=${cond.regras_internas?.moeda} carteira=${cond.regras_internas?.pagamentos?.verum_wallet || "—"}`);
const { data: assin } = await supabase.from("saas_assinaturas").select("status").eq("condominio_id", cond.id).maybeSingle();
console.log(`   licença: ${assin?.status || "—"}`);
const { data: cobr } = await supabase.from("cobrancas")
  .select("id, valor_original, status").eq("condominio_id", cond.id).order("criado_em");
for (const c of cobr || []) console.log(`   cobrança ${c.id.slice(0, 8)} US$ ${c.valor_original} → ${c.status}`);
const { data: infs } = await supabase.from("pagamentos_informados")
  .select("id, forma, valor_informado, situacao, tx_hash").eq("condominio_id", cond.id);
for (const i of infs || []) console.log(`   informe ${i.id.slice(0, 8)} ${i.forma} US$ ${i.valor_informado} → ${i.situacao}`);
