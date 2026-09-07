/* Reseta o cenário de teste dos pagamentos manuais (condomínio TESTE
   Manuais) para um teste visual no navegador: apaga pagamentos, lançamentos
   e informes, volta as 4 cobranças a 'emitida' (o hash USDC fica livre de
   novo) e gera dois comprovantes PNG únicos para os uploads.
   Uso: node scripts/resetar-manuais.mjs
   Roteiro que ele rearma: 390.10 = cripto auto-baixa · 100 = transferência
   exata · 120 = divergente (informe 110) · 50 = dinheiro (Receber). */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
if (!env.STRIPE_SECRET_KEY?.startsWith("sk_test")) { console.error("Chave Stripe não é de teste — abortado."); process.exit(1); }
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const COND = "87e6ade7-264e-4b3a-9eef-30b4d78b83fb";

await admin.from("pagamentos").delete().eq("condominio_id", COND);
await admin.from("lancamentos").delete().eq("condominio_id", COND);
await admin.from("pagamentos_informados").delete().eq("condominio_id", COND);
const { error } = await admin.from("cobrancas")
  .update({ status: "emitida", comprovante_documento_id: null, provider_charge_id: null })
  .eq("condominio_id", COND);
if (error) { console.error(error.message); process.exit(1); }

const { data: cobrs } = await admin.from("cobrancas")
  .select("valor_original, status").eq("condominio_id", COND).order("criado_em");
for (const c of cobrs || []) console.log(`cobrança US$ ${c.valor_original} → ${c.status}`);

/* comprovantes: PNG 1x1 válido + bytes únicos no final (o SHA-256 repetido
   marcaria divergência por duplicidade) */
const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");
const nonce = Date.now().toString(36);
for (const nome of ["comprovante-100", "comprovante-110"]) {
  const caminho = join(tmpdir(), `${nome}.png`);
  writeFileSync(caminho, Buffer.concat([png1x1, Buffer.from(`${nome}-${nonce}`)]));
  console.log(`gerado ${caminho}`);
}
console.log(`reset OK — marco temporal p/ auditoria: ${new Date().toISOString()}`);
