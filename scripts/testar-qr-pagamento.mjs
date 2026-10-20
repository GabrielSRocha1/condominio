/* Sondas do QR DE PAGAMENTO (módulo puro src/lib/qr-pagamento.js — sem banco):
   detecção da família da carteira pelo formato do endereço (EVM 0x+40 hex,
   Solana base58 32–44, lixo = desconhecida, vazia = ""), o URI verum: byte a
   byte como o portal do morador sempre emitiu, e os metadados de exibição.

   Uso: node scripts/testar-qr-pagamento.mjs */
import { familiaCarteira, uriVerumPay, redesDaFamilia } from "../src/lib/qr-pagamento.js";

let falhas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};

console.log("━━ Q · QR de pagamento (puro) ━━");

const EVM = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
ok("Q1 endereço EVM (0x + 40 hex, case misto e lowercase)",
  familiaCarteira(EVM) === "evm" && familiaCarteira(EVM.toLowerCase()) === "evm"
  && familiaCarteira(`  ${EVM}  `) === "evm");

ok("Q2 0x com 39/41 hex e tx hash (0x + 64) NÃO são endereço EVM",
  familiaCarteira("0x" + "a".repeat(39)) === "desconhecida"
  && familiaCarteira("0x" + "a".repeat(41)) === "desconhecida"
  && familiaCarteira("0x" + "a".repeat(64)) === "desconhecida");

ok("Q3 endereço Solana (base58 de 44 e de 32 chars)",
  familiaCarteira("DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK") === "solana"
  && familiaCarteira("1".repeat(32)) === "solana");

ok("Q4 base58 com 0/O/I/l, 31 e 45 chars = desconhecida",
  familiaCarteira("0".repeat(40)) === "desconhecida"
  && familiaCarteira("O" + "1".repeat(39)) === "desconhecida"
  && familiaCarteira("I" + "1".repeat(39)) === "desconhecida"
  && familiaCarteira("l" + "1".repeat(39)) === "desconhecida"
  && familiaCarteira("1".repeat(31)) === "desconhecida"
  && familiaCarteira("1".repeat(45)) === "desconhecida");

ok("Q5 vazia/espaços/null/undefined = \"\"; texto livre = desconhecida",
  familiaCarteira("") === "" && familiaCarteira("   ") === ""
  && familiaCarteira(null) === "" && familiaCarteira(undefined) === ""
  && familiaCarteira("banana") === "desconhecida");

ok("Q6 uriVerumPay: amount com 2 casas, moeda default USD, wallet aparada",
  uriVerumPay("0xAB", 1234.5, "BRL", "id-1") === "verum:0xAB?amount=1234.50&currency=BRL&ref=id-1"
  && uriVerumPay("0xAB", "99", "", "r") === "verum:0xAB?amount=99.00&currency=USD&ref=r"
  && uriVerumPay("  0xAB ", 1, "USD", "r") === "verum:0xAB?amount=1.00&currency=USD&ref=r");

ok("Q7 redesDaFamilia: evm lista as 3 redes, solana a sua, resto null",
  redesDaFamilia("evm")?.legenda.includes("Polygon")
  && redesDaFamilia("solana")?.legenda.includes("Solana")
  && redesDaFamilia("desconhecida") === null && redesDaFamilia("") === null);

console.log(falhas ? `\n${falhas} sonda(s) falharam.` : "\nTodas as sondas passaram.");
process.exit(falhas ? 1 : 0);
