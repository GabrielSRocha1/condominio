/* Sondas da FATURA DA LICENÇA — "paga a conta, não mata a conta".

   O administrador predial passou a ver e pagar a mensalidade da plataforma
   (22/11/2026). A fronteira é estreita e inteira do lado do servidor, então é
   ela que estas sondas provam, com uma conta de administrador DE VERDADE:

     · ele LÊ as faturas e abre o portal — e o portal dele é o RESTRITO
       (subscription_cancel e subscription_update desligados na configuração
       que a sessão aponta; não basta checar o 200);
     · ele NÃO contrata, NÃO troca de plano e NÃO cancela — os três endpoints
       do CONTRATO devolvem 403.

   Cancelar a assinatura é a única ação do app que de fato destrói a conta do
   condomínio (webhook marca "cancelada" → o paywall tranca para sempre):
   um 403 que virasse 200 aqui seria a falha mais cara do módulo.

   Bloco U (puro): a fronteira declarada no JS e nos endpoints.
   Bloco B (banco + API + Stripe, exige `npm run dev` e STRIPE_SECRET_KEY).

   Tudo que cria é removido no fim. Uso: node scripts/testar-fatura-licenca.mjs */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { MATRIZ_PADRAO, PERMS_VEDADAS_AO_ADMIN, sanearPerms, mesmoConjunto } from "../src/lib/permissoes.js";
import { FEATURES_PORTAL_RESTRITO, MARCA_PORTAL_RESTRITO } from "../api/stripe/_lib/comum.js";
import { liberarEmailDaSonda } from "./_contas-de-sonda.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const URL_SB = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const admin = createClient(URL_SB, env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = process.env.BASE || "http://localhost:5173";
const COND = "87e6ade7-264e-4b3a-9eef-30b4d78b83fb";   // condomínio TESTE Manuais
const EMAIL_ADM = "admin.fatura@teste.condomaster.dev";
const SENHA = "teste12345";
const SENHA_DIRETOR = "teste123";                       // fixture dos manuais

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };
const post = async (rota, body, token) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  }).catch(() => null);
  if (!r) return { http: 0 };
  return { http: r.status, ...(await r.json().catch(() => ({}))) };
};
const arquivo = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/* ══════════ U · a fronteira declarada (puro) ══════════ */
console.log("━━ U · conta ≠ contrato (puro) ━━");

const adm = MATRIZ_PADRAO.administrador_predial || [];
ok("o administrador tem tela.fatura e licenca.pagar",
  ["tela.fatura", "licenca.pagar"].every((c) => adm.includes(c)));
ok("e NÃO tem tela.planos nem licenca.gerir",
  !["tela.planos", "licenca.gerir"].some((c) => adm.includes(c)));
ok("as duas do CONTRATO seguem vedadas",
  ["tela.planos", "licenca.gerir"].every((c) => PERMS_VEDADAS_AO_ADMIN.includes(c)));
ok("as duas da CONTA não são vedadas",
  !["tela.fatura", "licenca.pagar"].some((c) => PERMS_VEDADAS_AO_ADMIN.includes(c)));
{
  const misto = sanearPerms("administrador_predial",
    ["tela.fatura", "licenca.pagar", "tela.planos", "licenca.gerir"]);
  ok("sanear deixa passar a conta e descarta o contrato",
    mesmoConjunto(misto, ["licenca.pagar", "tela.fatura"]), misto.join(","));
}

/* a configuração restrita é o que impede o cancelamento pelo portal: se
   alguém a afrouxar no código, o 200 do portal continua igual e só isto pega */
ok("a configuração restrita desliga cancelar e trocar de plano",
  FEATURES_PORTAL_RESTRITO.subscription_cancel.enabled === false
  && FEATURES_PORTAL_RESTRITO.subscription_update.enabled === false);
ok("e liga faturas e troca de cartão",
  FEATURES_PORTAL_RESTRITO.invoice_history.enabled === true
  && FEATURES_PORTAL_RESTRITO.payment_method_update.enabled === true);

/* guardas dos endpoints, lidas do arquivo: a sonda de permissões já prova
   que os três do contrato não conhecem licenca.pagar — aqui o outro lado, os
   dois da conta precisam conhecer as DUAS */
for (const f of ["faturas.js", "portal.js"]) {
  const txt = arquivo(`api/stripe/${f}`);
  ok(`${f} autoriza pelas duas permissões`,
    txt.includes('"licenca.gerir"') && txt.includes('"licenca.pagar"'));
}
ok("portal.js nega quando a configuração restrita falta (não cai no padrão)",
  /configPortalRestrito[\s\S]{0,400}503/.test(arquivo("api/stripe/portal.js")));

/* ── a cor diz o que aconteceu (22/11/2026, da tela) ──
   VERMELHO é para erro de verdade. "Ainda não há fatura" não é erro, e nem
   falha de carregamento é: em ambos a licença está em dia e não há nada para
   a pessoa consertar — isso é âmbar. A primeira versão pintava de vermelho e
   ainda mostrava a caixa JUNTO com "Nenhuma fatura emitida até agora",
   afirmando duas coisas contraditórias na mesma tela. */
{
  const jsx = arquivo("CondoMasterPro.jsx");
  const comp = jsx.slice(jsx.indexOf("function FaturaLicenca"), jsx.indexOf("/* ══════════════ PAYWALL"));
  ok("a tela Fatura existe e foi isolada para a sonda", comp.length > 500, `${comp.length} chars`);
  ok("nenhum estado da tela Fatura é pintado de vermelho", !comp.includes("t.danger"));
  /* os quatro estados sem lista moram num ramo só — é o que impede a volta
     da mensagem dupla */
  ok("os estados sem lista são mutuamente exclusivos",
    /erro \|\| semCliente \|\| clienteAusente \|\| !faturas\.length/.test(comp));
  ok("sem fatura, a tela mostra o próximo vencimento", comp.includes("proximoVenc"));
  /* o provedor é detalhe de implementação nosso: a plataforma atende em
     domínio próprio e não anuncia de quem é a API que processa o cartão.
     Vale para o que a PESSOA lê — comentário de código citando Stripe é
     documentação, e continua certo. */
  const visiveis = [...comp.matchAll(/L\("((?:[^"\\]|\\.)*)"\)/g)].map(([, s]) => s);
  const comProvedor = visiveis.filter((s) => /stripe/i.test(s));
  ok("a tela Fatura não nomeia o provedor de pagamento",
    comProvedor.length === 0, comProvedor.join(" · "));

  /* e a regra vale para o APP INTEIRO (varredura de 22/11/2026): eram 11
     textos — onboarding de recebimento, QR do Pix, confirmação de pagamento,
     Planos e paywall. Ficam de fora, de propósito:
       · os COMENTÁRIOS de código, que são documentação e devem nomear o que
         de fato está sendo integrado;
       · as PÁGINAS LEGAIS (src/legal/*), onde identificar o processador de
         pagamento é disclosure devido, não cópia de produto;
       · a página hospedada do checkout, que é do provedor e não é nossa. */
  const todas = [...jsx.matchAll(/L\("((?:[^"\\]|\\.)*)"\)/g)].map(([, s]) => s);
  const vazando = [...new Set(todas.filter((s) => /stripe/i.test(s)))];
  ok("nenhum texto de UI do app nomeia o provedor de pagamento",
    vazando.length === 0, vazando.map((s) => s.slice(0, 40)).join(" · "));
  const rotulos = arquivo("src/lib/api.js");
  ok("o rótulo da forma de pagamento também não", !/Pagamento online \(Stripe\)/.test(rotulos));
}

/* ══════════ B · endpoints com uma conta de administrador real ══════════ */
console.log("\n━━ B · o administrador contra /api/stripe/* (banco + API + Stripe) ━━");
const NOMES_B = [
  "administrador LÊ as faturas da licença",
  "administrador ABRE o portal",
  "o portal dele é o RESTRITO (cancelar/trocar desligados na Stripe)",
  "administrador NÃO cancela a assinatura",
  "administrador NÃO contrata assinatura",
  "administrador NÃO troca de plano",
];

const temStripe = Boolean((env.STRIPE_SECRET_KEY || "").trim() && !(env.STRIPE_SECRET_KEY || "").startsWith("COLE_AQUI"));
const login = await post("auth/login", { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: SENHA_DIRETOR });

if (!login.token) {
  for (const n of NOMES_B) pula(n, `login do diretor falhou — dev server de pé em ${BASE}? (npm run dev)`);
} else if (!temStripe) {
  for (const n of NOMES_B) pula(n, "STRIPE_SECRET_KEY ausente no .env");
} else {
  const tokenDiretor = login.token;
  /* A conta sai pelo SERVICE ROLE, não pelo endpoint: /api/auth/acessos tem
     idempotência por (usuário, rota, corpo) e duas execuções seguidas da
     suíte viravam no-op, deixando a conta de ontem para trás.
     E o LOGIN desta conta grava em `auditoria`, que é append-only — a partir
     daí nenhum delete passa, e o que libera a execução seguinte é soltar o
     e-mail, não apagar o rastro. Ver scripts/_contas-de-sonda.mjs. */
  const limpar = () => liberarEmailDaSonda(admin, EMAIL_ADM);

  try {
    await limpar();
    await post("auth/acessos", { acao: "criar", perfil: "administrador_predial", email: EMAIL_ADM, senha: SENHA }, tokenDiretor);
    const lg = await post("auth/login", { perfil: "administrador_predial", email: EMAIL_ADM, senha: SENHA });

    if (!lg.token) {
      for (const n of NOMES_B) pula(n, "login do administrador de teste falhou");
    } else {
      const tk = lg.token;

      /* 1 · lê as faturas */
      const fat = await post("stripe/faturas", { condominioId: COND }, tk);
      ok(NOMES_B[0], fat.http === 200 && Array.isArray(fat.faturas),
        `${fat.http}${fat.http === 200 ? ` · ${fat.faturas?.length ?? "?"} fatura(s)${fat.semCliente ? " (sem cliente na Stripe)" : ""}` : ` · ${fat.error || ""}`}`);
      /* valor na moeda da fatura: com Adaptive Pricing ela pode vir em PYG,
         que não tem centavos — nunca dividido por 100 */
      if (fat.http === 200 && (fat.faturas || []).length) {
        const f = fat.faturas[0];
        ok("a fatura traz valor decimal e moeda",
          typeof f.total === "number" && /^[A-Z]{3}$/.test(String(f.moeda || "")),
          `${f.total} ${f.moeda}`);
      } else puladas++;

      /* 2 e 3 · abre o portal, e ele é o restrito */
      const portal = await post("stripe/portal", { condominioId: COND }, tk);
      const semCliente = portal.http === 404;
      if (semCliente) {
        /* condomínio de teste sem customer na Stripe: não há portal para
           abrir. Pular é honesto — mas as negativas abaixo seguem valendo. */
        pula(NOMES_B[1], "condomínio de teste ainda não tem cliente na Stripe");
        pula(NOMES_B[2], "sem portal para inspecionar");
      } else {
        ok(NOMES_B[1], portal.http === 200 && Boolean(portal.url),
          portal.http === 200
            ? `200 · ${portal.restrito ? "restrito" : "PADRÃO (!)"}`
            : `${portal.http} · ${portal.error || ""}`);
        const stripe = new Stripe(env.STRIPE_SECRET_KEY);
        const configs = await stripe.billingPortal.configurations.list({ limit: 100 }).catch(() => null);
        const restrita = configs?.data.find((c) => c.metadata?.condomaster === MARCA_PORTAL_RESTRITO);
        const f = restrita?.features;
        ok(NOMES_B[2],
          portal.restrito === true && Boolean(restrita)
          && f?.subscription_cancel?.enabled === false
          && f?.subscription_update?.enabled === false
          && f?.invoice_history?.enabled === true,
          restrita ? `${restrita.id} · cancel=${f?.subscription_cancel?.enabled} update=${f?.subscription_update?.enabled}` : "configuração restrita não encontrada na Stripe");
      }

      /* 4, 5 e 6 · o CONTRATO continua fechado. São o coração da sonda:
         403 em cada um dos três caminhos que mexem na assinatura. */
      const canc = await post("stripe/cancelar-assinatura", { condominioId: COND }, tk);
      ok(NOMES_B[3], canc.http === 403, `${canc.http} · ${canc.error || ""}`);
      const ass = await post("stripe/assinatura", { condominioId: COND, ciclo: "mensal", troca: false }, tk);
      ok(NOMES_B[4], ass.http === 403, `${ass.http} · ${ass.error || ""}`);
      const pl = await post("stripe/plano", { condominioId: COND, plano: "Premium" }, tk);
      ok(NOMES_B[5], pl.http === 403, `${pl.http} · ${pl.error || ""}`);

      /* e o status da licença segue legível por qualquer perfil (é o botão
         "Já paguei — verificar" do paywall) */
      const lic = await post("stripe/licenca", { condominioId: COND }, tk);
      ok("verificar licença continua aberto a qualquer perfil", lic.http === 200, `${lic.http}`);
    }
  } finally {
    await limpar();
  }
}

console.log(`\n${falhas ? "❌" : "✅"} fatura da licença: ${falhas} falha(s), ${puladas} pulada(s)`);
process.exit(falhas ? 1 : 0);
