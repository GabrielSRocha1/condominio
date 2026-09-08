/* Verificação ON-CHAIN de pagamentos cripto (multi-chain), usada pelo
   endpoint /api/cobrancas/informar-pagamento. O morador cola o HASH da
   transação; aqui detectamos a rede pelo formato do hash e consultamos RPCs
   PÚBLICOS (sem chave de API) para conferir:
     · a transação existe e está confirmada;
     · o destino é a carteira cadastrada do condomínio;
     · o valor, quando é stablecoin conhecida (USDT/USDC) e a moeda de
       gestão é USD — nesses casos a baixa pode ser automática.
   RPCs podem ser trocados por env: EVM_RPC_ETH, EVM_RPC_BNB,
   EVM_RPC_POLYGON, SOLANA_RPC. O prefixo "_" impede esta pasta de virar
   rota (mesmo padrão de api/stripe/_lib). */
import { envVal } from "../stripe/_lib/comum.js";

const EVM_CHAINS = [
  {
    id: "ethereum", rpcEnv: "EVM_RPC_ETH", rpc: "https://ethereum-rpc.publicnode.com",
    explorer: "https://etherscan.io/tx/", nativo: "ETH",
    stables: {
      "0xdac17f958d2ee523a2206206994597c13d831ec7": { simbolo: "USDT", dec: 6 },
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { simbolo: "USDC", dec: 6 },
    },
  },
  {
    id: "bnb", rpcEnv: "EVM_RPC_BNB", rpc: "https://bsc-rpc.publicnode.com",
    explorer: "https://bscscan.com/tx/", nativo: "BNB",
    stables: {
      "0x55d398326f99059ff775485246999027b3197955": { simbolo: "USDT", dec: 18 },
      "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": { simbolo: "USDC", dec: 18 },
    },
  },
  {
    id: "polygon", rpcEnv: "EVM_RPC_POLYGON", rpc: "https://polygon-bor-rpc.publicnode.com",
    explorer: "https://polygonscan.com/tx/", nativo: "POL",
    stables: {
      "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": { simbolo: "USDT", dec: 6 },
      "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": { simbolo: "USDC", dec: 6 },
    },
  },
];
const SOLANA = {
  id: "solana", rpcEnv: "SOLANA_RPC", rpc: "https://api.mainnet-beta.solana.com",
  explorer: "https://solscan.io/tx/",
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  usdtMint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
};
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const rpcCall = async (url, method, params) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
    const j = await r.json();
    return j?.result ?? null;
  } catch { return null; }
  finally { clearTimeout(timer); }
};

/* valor confere quando é stablecoin (≈ USD), a moeda de gestão é USD e a
   diferença fica dentro de 1% (ou 1 centavo) */
const valorBate = (quantia, valorCobranca, ehStable, moedaGestao) =>
  ehStable && String(moedaGestao).toUpperCase() === "USD" &&
  Math.abs(quantia - valorCobranca) <= Math.max(0.01, valorCobranca * 0.01);

async function verificarEVM(hash, carteira, valorCobranca, moedaGestao) {
  const alvo = carteira.toLowerCase();
  for (const chain of EVM_CHAINS) {
    const url = envVal(chain.rpcEnv) || chain.rpc;
    const tx = await rpcCall(url, "eth_getTransactionByHash", [hash]);
    if (!tx) continue; // não está nesta rede — tenta a próxima
    const receipt = await rpcCall(url, "eth_getTransactionReceipt", [hash]);
    const confirmada = receipt?.status === "0x1";
    let destinoConfere = false, quantia = 0, token = chain.nativo, ehStable = false;

    /* transferência nativa (ETH/BNB/POL) direto para a carteira */
    if ((tx.to || "").toLowerCase() === alvo && tx.value && tx.value !== "0x0") {
      destinoConfere = true;
      quantia = Number(BigInt(tx.value)) / 1e18;
    }
    /* transferência de token (ERC-20): evento Transfer com destino = carteira */
    for (const log of receipt?.logs || []) {
      if (log.topics?.[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
      const para = "0x" + log.topics[2].slice(-40).toLowerCase();
      if (para !== alvo) continue;
      destinoConfere = true;
      const info = chain.stables[(log.address || "").toLowerCase()];
      if (info) {
        ehStable = true; token = info.simbolo;
        quantia = Number(BigInt(log.data)) / 10 ** info.dec;
      } else {
        token = "token"; quantia = 0; // token desconhecido: valor fica para conferência manual
      }
    }
    return {
      ok: true, chain: chain.id, explorerUrl: chain.explorer + hash,
      confirmada, destinoConfere,
      valorConferido: destinoConfere && valorBate(quantia, valorCobranca, ehStable, moedaGestao),
      quantia, token,
    };
  }
  return { ok: false, motivo: "Transação não encontrada nas redes EVM suportadas (Ethereum, BNB Chain, Polygon)." };
}

async function verificarSolana(hash, carteira, valorCobranca, moedaGestao) {
  const url = envVal(SOLANA.rpcEnv) || SOLANA.rpc;
  const tx = await rpcCall(url, "getTransaction", [hash, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
  if (!tx) return { ok: false, motivo: "Transação não encontrada na rede Solana." };
  const confirmada = tx.meta && tx.meta.err === null;
  let destinoConfere = false, quantia = 0, token = "SOL", ehStable = false;

  /* SPL tokens: saldo da carteira aumentou? (pre/post token balances) */
  const posDe = (lista) => (lista || []).filter((b) => b.owner === carteira);
  for (const pos of posDe(tx.meta?.postTokenBalances)) {
    const pre = posDe(tx.meta?.preTokenBalances).find((b) => b.accountIndex === pos.accountIndex);
    const delta = (pos.uiTokenAmount?.uiAmount || 0) - (pre?.uiTokenAmount?.uiAmount || 0);
    if (delta > 0) {
      destinoConfere = true; quantia = delta;
      if (pos.mint === SOLANA.usdcMint) { token = "USDC"; ehStable = true; }
      else if (pos.mint === SOLANA.usdtMint) { token = "USDT"; ehStable = true; }
      else token = "token";
    }
  }
  /* SOL nativo: instrução system transfer com destino = carteira */
  if (!destinoConfere) {
    const instrucoes = tx.transaction?.message?.instructions || [];
    for (const i of instrucoes) {
      const p = i?.parsed;
      if (p?.type === "transfer" && p?.info?.destination === carteira) {
        destinoConfere = true;
        quantia = Number(p.info.lamports || 0) / 1e9;
      }
    }
  }
  return {
    ok: true, chain: "solana", explorerUrl: SOLANA.explorer + hash,
    confirmada, destinoConfere,
    valorConferido: destinoConfere && valorBate(quantia, valorCobranca, ehStable, moedaGestao),
    quantia, token,
  };
}

/* entrada única: detecta a rede pelo formato do hash */
export async function verificarTransacao(hash, carteira, valorCobranca, moedaGestao) {
  const h = String(hash || "").trim();
  if (!carteira) return { ok: false, motivo: "O condomínio não cadastrou a carteira de recebimento." };
  if (/^0x[0-9a-fA-F]{64}$/.test(h))
    return verificarEVM(h, carteira, valorCobranca, moedaGestao);
  if (/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(h))
    return verificarSolana(h, carteira, valorCobranca, moedaGestao);
  return { ok: false, motivo: "Formato de hash não reconhecido — cole o hash completo da transação (EVM 0x… ou Solana)." };
}
