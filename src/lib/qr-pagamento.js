/* QR de pagamento (tela Cobranças e portal do morador) — módulo puro,
   sondável em Node (scripts/testar-qr-pagamento.mjs). Sem React, sem api.js. */

/* Família da carteira pelo FORMATO do endereço cadastrado em
   regras_internas.pagamentos.verum_wallet — mesmo espírito da detecção de
   hash do backend (api/_lib/cripto.js), aqui para ENDEREÇOS:
   · "evm"          0x + 40 hex (Ethereum/BNB/Polygon — endereço único);
   · "solana"       base58 de 32–44 chars (sem 0 O I l);
   · "desconhecida" preenchida fora dos formatos (QR sai, sem ícone);
   · ""             vazia (sem QR cripto). */
export function familiaCarteira(wallet) {
  const w = String(wallet ?? "").trim();
  if (!w) return "";
  if (/^0x[0-9a-fA-F]{40}$/.test(w)) return "evm";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) return "solana";
  return "desconhecida";
}

/* URI proprietário da Verum Wallet — byte a byte o que o portal do morador
   sempre emitiu: carteira + valor devido (2 casas) + moeda + ref da cobrança. */
export function uriVerumPay(wallet, valor, moeda, ref) {
  return `verum:${String(wallet ?? "").trim()}?amount=${Number(valor || 0).toFixed(2)}&currency=${moeda || "USD"}&ref=${ref ?? ""}`;
}

/* Metadados de exibição da família (strings em PT — a UI passa pelo L()). */
export function redesDaFamilia(familia) {
  if (familia === "evm")    return { nome: "Ethereum", legenda: "Redes aceitas: Ethereum · BNB · Polygon (USDT/USDC)" };
  if (familia === "solana") return { nome: "Solana",   legenda: "Rede aceita: Solana (SOL/USDT/USDC)" };
  return null;
}
