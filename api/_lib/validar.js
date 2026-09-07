/* Validação deny-by-default dos payloads da /api.
   validar(corpo, esquema) → { ok, dados, erro }
   · campos fora do esquema são DESCARTADOS (nunca chegam ao handler);
   · cada campo declara tipo + regras; obrigatório falha se ausente;
   · nenhuma mensagem ecoa o valor recebido (sem reflexão de payload).

   Tipos: uuid | email | texto | numero | inteiro | enum | data | base64 | bool
   Regras: obrigatorio, max (texto: chars; base64: bytes decodificados),
           min/maximo (numero), valores (enum), padrao (regex de texto). */

const RX = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  email: /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/,
  data: /^\d{4}-\d{2}-\d{2}$/,
};

export function validar(corpo, esquema) {
  const origem = corpo && typeof corpo === "object" && !Array.isArray(corpo) ? corpo : {};
  const dados = {};
  for (const [campo, regra] of Object.entries(esquema)) {
    let v = origem[campo];
    const vazio = v === undefined || v === null || v === "";
    if (vazio) {
      if (regra.obrigatorio) return { ok: false, erro: `Campo obrigatório ausente: ${campo}.` };
      continue;
    }
    switch (regra.tipo) {
      case "uuid":
        if (typeof v !== "string" || !RX.uuid.test(v)) return { ok: false, erro: `Campo inválido: ${campo}.` };
        break;
      case "email":
        v = String(v).trim().toLowerCase();
        if (v.length > 254 || !RX.email.test(v)) return { ok: false, erro: `Campo inválido: ${campo}.` };
        break;
      case "texto":
        if (typeof v !== "string") return { ok: false, erro: `Campo inválido: ${campo}.` };
        v = v.trim();
        if (v.length > (regra.max || 200)) return { ok: false, erro: `Campo acima do limite: ${campo}.` };
        if (regra.padrao && !regra.padrao.test(v)) return { ok: false, erro: `Campo inválido: ${campo}.` };
        break;
      case "numero":
      case "inteiro": {
        const n = Number(v);
        if (!Number.isFinite(n)) return { ok: false, erro: `Campo inválido: ${campo}.` };
        if (regra.tipo === "inteiro" && !Number.isInteger(n)) return { ok: false, erro: `Campo inválido: ${campo}.` };
        if (regra.min !== undefined && n < regra.min) return { ok: false, erro: `Campo abaixo do mínimo: ${campo}.` };
        if (regra.maximo !== undefined && n > regra.maximo) return { ok: false, erro: `Campo acima do limite: ${campo}.` };
        v = n;
        break;
      }
      case "enum":
        if (!regra.valores.includes(v)) return { ok: false, erro: `Campo inválido: ${campo}.` };
        break;
      case "data":
        if (typeof v !== "string" || !RX.data.test(v) || Number.isNaN(Date.parse(v)))
          return { ok: false, erro: `Campo inválido: ${campo}.` };
        break;
      case "base64": {
        if (typeof v !== "string") return { ok: false, erro: `Campo inválido: ${campo}.` };
        const semPrefixo = v.replace(/^data:[^;]+;base64,/, "");
        /* tamanho decodificado aproximado, sem decodificar ainda */
        if ((semPrefixo.length * 3) / 4 > (regra.max || 4 * 1024 * 1024))
          return { ok: false, erro: `Arquivo acima do limite em ${campo}.` };
        break;
      }
      case "bool":
        if (typeof v !== "boolean") return { ok: false, erro: `Campo inválido: ${campo}.` };
        break;
      default:
        return { ok: false, erro: `Esquema sem tipo para ${campo}.` };
    }
    dados[campo] = v;
  }
  return { ok: true, dados };
}

/* atalho para handlers: valida e responde 400 sozinho quando falha */
export function corpoValidado(res, corpo, esquema) {
  const r = validar(corpo, esquema);
  if (!r.ok) { res.status(400).json({ error: r.erro }); return null; }
  return r.dados;
}
