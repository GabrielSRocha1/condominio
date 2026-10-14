/* Expansão da criação de unidades em LOTE (tela Unidades) — extraída de
   criarUnidade para ser pura e sondável sem app nem banco (mesmo racional
   de caixa.js/encargos.js).

   Entrada (strings cruas do formulário): { numero, numeroAte, andar, andarAte }
   Saída: [{ numero, andar }]  — lança Error com mensagem de tela ao validar.

   Regras:
   · SEM letra: como sempre — intervalo simples (1 até 100) ou, com intervalo
     de andares, o produto andar × sequência (1 até 4 com andares 1 a 12 →
     101…104, 201…204 … 1201…1204).
   · COM letra (prefixo "A1" ou sufixo "1A"), a letra identifica UMA unidade
     por andar:
     — sem andar informado, o andar ESPELHA o número (1A→1, 2A→2, 3A→3);
     — com andar único informado, vale o informado (como sempre);
     — com INTERVALO de andares e faixa de unidades, pareia um-a-um
       (1A até 3A com andares 1 a 3 → 101A/1, 202A/2, 303A/3) e exige as
       duas faixas com a MESMA quantidade;
     — com intervalo de andares e número único, replica a mesma sequência
       em cada andar (1A com andares 1 a 3 → 101A/1, 201A/2, 301A/3). */

/* decompõe o número em prefixo + dígitos + sufixo (ex.: "1D" → "", "1", "D") */
const partes = (s) => String(s).trim().match(/^(\D*)(\d+)(\D*)$/);

export function expandirUnidades(f) {
  const ate = String(f.numeroAte || "").trim();
  const andarIni = String(f.andar ?? "").trim() ? parseInt(f.andar, 10) : null;
  const andarFim = String(f.andarAte ?? "").trim() ? parseInt(f.andarAte, 10) : null;

  let itens; // [{ numero, andar }]
  if (andarFim != null) {
    /* intervalo de andares: numeradas como andar + sequência, cada uma já
       com o próprio andar */
    if (andarIni == null) throw new Error("Informe o andar inicial do intervalo (ex.: 1 até 12).");
    if (andarFim < andarIni) throw new Error("O andar final deve ser maior ou igual ao inicial.");
    const m1 = partes(f.numero);
    const m2 = ate ? partes(ate) : m1;
    if (!m1 || !m2) throw new Error("Para criar por andares, use números nas unidades (ex.: 1 até 4).");
    const [, prefixo, n1, sufixo] = m1;
    if ((m2[1] && m2[1] !== prefixo) || (m2[3] && m2[3] !== sufixo))
      throw new Error("As letras do início e do fim do intervalo devem ser iguais (ex.: 1D até 4D).");
    const ini = parseInt(n1, 10), fim = parseInt(m2[2], 10);
    if (fim < ini) throw new Error("O número final deve ser maior ou igual ao inicial.");
    const pad = Math.max(2, n1.startsWith("0") ? n1.length : 0); // 1º andar + unidade 1 → 101
    const temLetra = !!(prefixo || sufixo);
    itens = [];
    if (temLetra && fim > ini) {
      /* letra = UMA unidade por andar: pareia a i-ésima unidade com o
         i-ésimo andar (1A até 3A com andares 1 a 3 → 101A/1, 202A/2, 303A/3) */
      if (fim - ini !== andarFim - andarIni)
        throw new Error("Com letra no número, a faixa de unidades e a de andares precisam ter a mesma quantidade (ex.: 1A até 3A com andares 1 até 3).");
      for (let i = 0; i <= fim - ini; i++) {
        const a = andarIni + i, n = ini + i;
        itens.push({ numero: `${prefixo}${a}${String(n).padStart(pad, "0")}${sufixo}`, andar: a });
      }
    } else {
      /* sem letra (ou número único): as unidades do intervalo em CADA andar */
      for (let a = andarIni; a <= andarFim; a++)
        for (let n = ini; n <= fim; n++)
          itens.push({ numero: `${prefixo}${a}${String(n).padStart(pad, "0")}${sufixo}`, andar: a });
    }
  } else {
    let numeros = [String(f.numero).trim()];
    if (ate) {
      /* aceita letras junto com o número (ex.: 1D até 4D → 1D, 2D, 3D, 4D; ou A1 até A10) */
      const m1 = partes(f.numero);
      const m2 = partes(ate);
      if (!m1 || !m2) throw new Error("Para criar um intervalo, use um número com ou sem letras (ex.: 1 até 100, ou 1D até 4D).");
      const [, prefixo, n1, sufixo] = m1;
      const [, p2, n2, s2] = m2;
      if ((p2 && p2 !== prefixo) || (s2 && s2 !== sufixo))
        throw new Error("As letras do início e do fim do intervalo devem ser iguais (ex.: 1D até 4D).");
      const ini = parseInt(n1, 10), fim = parseInt(n2, 10);
      if (fim < ini) throw new Error("O número final deve ser maior ou igual ao inicial.");
      const pad = n1.startsWith("0") ? n1.length : 0; // preserva zeros à esquerda (ex.: 001 a 010)
      numeros = Array.from({ length: fim - ini + 1 }, (_, i) => `${prefixo}${String(ini + i).padStart(pad, "0")}${sufixo}`);
    }
    /* letra SEM andar informado: o andar espelha o número (1A→1, 2A→2…) */
    itens = numeros.map((numero) => {
      let andar = andarIni;
      if (andar == null) {
        const m = partes(numero);
        if (m && (m[1] || m[3])) andar = parseInt(m[2], 10);
      }
      return { numero, andar };
    });
  }
  if (itens.length > 500) throw new Error("Máximo de 500 unidades por vez.");
  return itens;
}
