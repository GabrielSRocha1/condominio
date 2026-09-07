/* POST /api/cobrancas/informar-pagamento
   (Authorization: Bearer — QUALQUER perfil do condomínio da cobrança,
    inclusive morador; toda a escrita acontece aqui com a service role)

   O morador informa um pagamento manual de cobrança:
   · forma "transferencia": { cobrancaId, valorInformado, pagoEm,
       arquivoBase64, nomeArquivo, mime } — o comprovante vai para o bucket
       "documentos" (tipo 'comprovante', hash SHA-256), a cobrança vira
       'pagamento_informado' (valor confere) ou 'pagamento_divergente'
       (valor difere OU comprovante repetido) e o gestor confirma depois
       (o caixa só é lançado na confirmação, via registrar_pagamento_manual).
   · forma "verum_pay": { cobrancaId, txHash } — verifica ON-CHAIN
       (api/_lib/cripto.js): destino = carteira cadastrada + confirmada;
       se o valor também confere (stablecoin/USD) → BAIXA AUTOMÁTICA
       (RPC com origem 'reconciliacao' e o hash como idempotência);
       senão fica 'pagamento_informado' para o gestor confirmar. */
import { randomUUID, createHash } from "crypto";
import { supabaseAdmin, corpoJson, lerClaims } from "../stripe/_lib/comum.js";
import { verificarTransacao } from "../_lib/cripto.js";
import { corpoValidado } from "../_lib/validar.js";
import { limitar, origemBloqueada, prepararIdempotencia, logSeguro } from "../_lib/seguranca.js";

const MAX_ARQUIVO = 4 * 1024 * 1024; // 4 MB
const EXT_OK = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const supabase = supabaseAdmin();

  try {
    const body = corpoValidado(res, corpoJson(req), {
      cobrancaId:     { tipo: "uuid", obrigatorio: true },
      forma:          { tipo: "enum", valores: ["transferencia", "verum_pay"] },
      txHash:         { tipo: "texto", max: 120, padrao: /^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{40,90})$/ },
      valorInformado: { tipo: "numero", min: 0.01, maximo: 999999999 },
      pagoEm:         { tipo: "data" },
      arquivoBase64:  { tipo: "base64", max: 6 * 1024 * 1024 }, // teto bruto; o limite fino (4 MB) segue abaixo
      nomeArquivo:    { tipo: "texto", max: 140 },
      mime:           { tipo: "texto", max: 60, padrao: /^[\w.+-]+\/[\w.+-]+$/ },
    });
    if (!body) return;
    const { cobrancaId, txHash } = body;
    const forma = body.forma === "verum_pay" ? "verum_pay" : "transferencia";
    const claims = lerClaims(req);
    if (!claims?.condominio_id) return res.status(401).json({ error: "Sessão inválida — entre de novo." });
    if (origemBloqueada(req, res)) return;

    /* retry de rede com a mesma Idempotency-Key devolve a resposta original
       sem registrar um segundo informe (conexão instável ≠ pagamento duplo) */
    const idem = await prepararIdempotencia(supabase, req, res,
      { usuarioId: claims.sub, rota: "cobrancas/informar-pagamento" });
    if (idem.repetida) return;

    /* rate-limit por conta: a verificação cripto consulta RPCs externos e o
       upload grava storage — nenhum dos dois pode virar brinquedo de flood */
    const ritmo = await limitar(supabase, `informar:${forma}:${claims.sub}`,
      forma === "verum_pay"
        ? { janelaSeg: 10 * 60, max: 10, bloqueioSeg: 10 * 60 }
        : { janelaSeg: 60 * 60, max: 30, bloqueioSeg: 30 * 60 });
    if (ritmo.bloqueado)
      return res.status(429).json({ error: "Muitas tentativas — aguarde alguns minutos e tente de novo." });

    const { data: cobranca, error } = await supabase.from("cobrancas")
      .select("id, condominio_id, competencia, valor_original, vencimento, status")
      .eq("id", cobrancaId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!cobranca || cobranca.condominio_id !== claims.condominio_id)
      return res.status(404).json({ error: "Cobrança não encontrada." });
    if (["paga", "paga_em_atraso"].includes(cobranca.status))
      return res.status(409).json({ error: "Esta cobrança já está paga." });
    if (!["emitida", "vencida", "rascunho", "pagamento_informado", "pagamento_divergente"].includes(cobranca.status))
      return res.status(409).json({ error: "Esta cobrança não está aberta para pagamento." });

    const { data: pendente } = await supabase.from("pagamentos_informados")
      .select("id").eq("cobranca_id", cobranca.id).eq("situacao", "pendente").limit(1).maybeSingle();
    if (pendente)
      return res.status(409).json({ error: "Já existe um pagamento informado aguardando confirmação para esta cobrança." });

    const { data: cond } = await supabase.from("condominios")
      .select("regras_internas").eq("id", cobranca.condominio_id).maybeSingle();
    const valorCobranca = Number(cobranca.valor_original);

    /* ───────────────────────── CRIPTO (hash on-chain) ───────────────────── */
    if (forma === "verum_pay") {
      const hash = String(txHash || "").trim();
      if (!hash) return res.status(400).json({ error: "Cole o hash da transação." });
      const carteira = cond?.regras_internas?.pagamentos?.verum_wallet || "";
      if (!carteira)
        return res.status(409).json({ error: "O condomínio não cadastrou a carteira de recebimento cripto." });

      /* hash já usado em qualquer baixa? (idempotência global) */
      const { data: jaUsado } = await supabase.from("pagamentos")
        .select("id").eq("provider_event_id", hash).limit(1).maybeSingle();
      if (jaUsado) return res.status(409).json({ error: "Este hash de transação já foi utilizado em outra baixa." });
      const { data: jaInformado } = await supabase.from("pagamentos_informados")
        .select("id").eq("tx_hash", hash).neq("situacao", "rejeitado").limit(1).maybeSingle();
      if (jaInformado) return res.status(409).json({ error: "Este hash já foi informado em outra cobrança." });

      const moedaGestao = cond?.regras_internas?.moeda || "USD";
      const v = await verificarTransacao(hash, carteira, valorCobranca, moedaGestao);
      if (!v.ok) return res.status(400).json({ error: v.motivo });
      if (!v.confirmada)
        return res.status(400).json({ error: "A transação ainda não está confirmada na rede — tente novamente em instantes." });
      if (!v.destinoConfere)
        return res.status(400).json({ error: "A transação não tem a carteira do condomínio como destino." });

      if (v.valorConferido) {
        /* destino + valor conferidos on-chain → baixa automática */
        const { data: r, error: eRpc } = await supabase.rpc("registrar_pagamento_manual", {
          p_cobranca_id: cobranca.id,
          p_forma: "verum_pay",
          p_valor: valorCobranca,
          p_pago_em: new Date().toISOString(),
          p_justificativa: `Cripto verificada on-chain (${v.chain}): ${v.quantia} ${v.token}, hash ${hash}`,
          p_tx: hash,
          p_informado_id: null,
        });
        if (eRpc) throw new Error(eRpc.message);
        if (r?.ok === false) return res.status(409).json({ error: `Baixa recusada: ${r.erro}` });
        return res.status(200).json({ ok: true, pago: true, status: r?.status, chain: v.chain, quantia: v.quantia, token: v.token });
      }

      /* transação real para a carteira, mas valor não conferível sozinho →
         pendência para o gestor (que vê quantia/token e o link do explorer) */
      const { error: eInf } = await supabase.from("pagamentos_informados").insert({
        condominio_id: cobranca.condominio_id, cobranca_id: cobranca.id,
        forma: "verum_pay", valor_informado: Math.round(v.quantia * 100) / 100,
        pago_em_informado: new Date().toISOString().slice(0, 10),
        tx_hash: hash, chain: v.chain,
      });
      if (eInf) throw new Error(eInf.message);
      await supabase.from("cobrancas").update({ status: "pagamento_informado" }).eq("id", cobranca.id);
      return res.status(200).json({ ok: true, pago: false, pendente: true, chain: v.chain, quantia: v.quantia, token: v.token });
    }

    /* ─────────────────────── TRANSFERÊNCIA (comprovante) ────────────────── */
    const { arquivoBase64, nomeArquivo, mime } = body;
    const valorInformado = Number(body.valorInformado);
    const pagoEm = body.pagoEm || new Date().toISOString().slice(0, 10);
    if (!arquivoBase64) return res.status(400).json({ error: "Anexe o comprovante da transferência." });
    if (!valorInformado || valorInformado <= 0) return res.status(400).json({ error: "Informe o valor pago." });
    const ext = EXT_OK[mime] || (nomeArquivo || "").split(".").pop()?.toLowerCase();
    if (!ext || !["pdf", "jpg", "jpeg", "png", "webp"].includes(ext))
      return res.status(400).json({ error: "Formato do comprovante não suportado — envie PDF, JPG, PNG ou WEBP." });

    const buffer = Buffer.from(String(arquivoBase64).replace(/^data:[^;]+;base64,/, ""), "base64");
    if (!buffer.length) return res.status(400).json({ error: "Arquivo vazio." });
    if (buffer.length > MAX_ARQUIVO) return res.status(400).json({ error: "Comprovante acima de 4 MB — envie uma versão menor." });
    const hashArquivo = createHash("sha256").update(buffer).digest("hex");

    /* duplicidade: o MESMO arquivo já foi usado neste condomínio? */
    const { data: duplicado } = await supabase.from("documentos")
      .select("id").eq("condominio_id", cobranca.condominio_id)
      .eq("hash_sha256", hashArquivo).limit(1).maybeSingle();

    const caminho = `${cobranca.condominio_id}/comprovantes/${randomUUID()}.${ext}`;
    const { error: eUp } = await supabase.storage.from("documentos")
      .upload(caminho, buffer, { contentType: mime || "application/octet-stream" });
    if (eUp) throw new Error(`upload do comprovante: ${eUp.message}`);
    const url = supabase.storage.from("documentos").getPublicUrl(caminho).data.publicUrl;

    const compBR = `${cobranca.competencia.slice(5, 7)}/${cobranca.competencia.slice(0, 4)}`;
    const retencao = new Date(); retencao.setFullYear(retencao.getFullYear() + 5);
    const { data: doc, error: eDoc } = await supabase.from("documentos").insert({
      condominio_id: cobranca.condominio_id, tipo: "comprovante",
      titulo: `Comprovante de transferência — cobrança ${compBR}`,
      arquivo_url: url, hash_sha256: hashArquivo, template_versao: "comprovante-v1",
      emitido_por: claims.sub, retencao_ate: retencao.toISOString().slice(0, 10),
    }).select("id").single();
    if (eDoc) throw new Error(eDoc.message);

    const valorOk = Math.abs(valorInformado - valorCobranca) < 0.005;
    const statusNovo = duplicado || !valorOk ? "pagamento_divergente" : "pagamento_informado";
    const { error: eInf } = await supabase.from("pagamentos_informados").insert({
      condominio_id: cobranca.condominio_id, cobranca_id: cobranca.id,
      forma: "transferencia", valor_informado: valorInformado,
      pago_em_informado: pagoEm, documento_id: doc.id,
      ...(duplicado ? { motivo_rejeicao: "atenção: comprovante idêntico a um arquivo já enviado" } : {}),
    });
    if (eInf) throw new Error(eInf.message);
    await supabase.from("cobrancas")
      .update({ comprovante_documento_id: doc.id, status: statusNovo }).eq("id", cobranca.id);

    return res.status(200).json({
      ok: true, pago: false, status: statusNovo,
      divergente: statusNovo === "pagamento_divergente",
      motivo: duplicado ? "comprovante repetido" : (!valorOk ? "valor diferente da cobrança" : null),
    });
  } catch (e) {
    logSeguro("[cobrancas/informar-pagamento]", e);
    return res.status(500).json({ error: "Erro ao registrar o pagamento informado." });
  }
}
