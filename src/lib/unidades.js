/* Expansão da criação de unidades em LOTE e o RÓTULO de exibição da unidade
   (tela Unidades) — extraídos de criarUnidade e da listagem para serem puros
   e sondáveis sem app nem banco (mesmo racional de caixa.js/encargos.js).
   Sem imports de propósito: arrastar `norm` da planilha traria i18n.js e os
   12 dicionários de idioma para dentro de um módulo que é só regra.

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

/* ═══════════════ RÓTULO DE EXIBIÇÃO: andar + letra ═══════════════

   A criação em lote grava o andar DENTRO do número ("1-A" com andares 1 a 12
   vira 101-A … 1201-A), então a listagem mostrava "1001-A" — um número que
   embute o andar e uma sequência "01" que não diz nada a quem lê. O rótulo
   devolve o que identifica a unidade para uma pessoa: andar e letra.

   Só colapsa quando dá para provar que o número embute o andar. Na dúvida
   devolve null e quem chama fica com o número cru — um condomínio numerado
   101/102/103 (sem letra) não muda em nada. */

/* box e depósito numeram por conta própria: "B12" é o box 12, não o andar 12
   com a letra B — e expandirUnidades espelha o andar da letra (linha 83),
   então eles chegariam aqui com andar 12 e colapsariam errado */
const SEM_ANDAR_NO_NUMERO = new Set(["box", "deposito"]);

export function rotuloCurto(u) {
  if (!u || SEM_ANDAR_NO_NUMERO.has(u.tipo)) return null;
  if (!Number.isInteger(u.andar) || u.andar < 0) return null; // sem andar não há o que colapsar
  const m = partes(u.numero);
  if (!m) return null;
  const [, prefixo, digitos, sufixo] = m;
  const pre = prefixo.replace(/[^A-Za-z]/g, ""), suf = sufixo.replace(/[^A-Za-z]/g, "");
  if (!!pre === !!suf) return null;              // sem letra nenhuma, ou letra dos DOIS lados ("A101B")
  const letra = pre || suf;
  if (!/^[A-Za-z]{1,2}$/.test(letra)) return null;
  const andar = String(u.andar);
  if (!digitos.startsWith(andar)) return null;   // o número não embute este andar
  /* o que sobra depois do andar é a sequência da unidade no andar: vazia
     ("1A" no andar 1) ou com os dois dígitos que o lote usa ("1001A" no
     andar 10 → "01"). Um dígito só é ambíguo — "12D" no andar 1 sobraria
     "2" e viraria "1-D", comendo o 12. */
  const resto = digitos.slice(andar.length);
  if (resto.length === 1) return null;
  return `${u.andar}-${letra.toUpperCase()}`;
}

/* Mapa "numero|bloco" → rótulo curto, montado uma vez sobre TODAS as unidades
   do condomínio. Existe por dois motivos: a colisão só é visível olhando o
   bloco inteiro, e as outras consultas trazem a unidade aninhada sem `andar`
   nem `tipo` — com o mapa elas resolvem o rótulo só com (numero, bloco), que
   é único pelo constraint do banco.
   Entrada: [{ numero, bloco, andar, tipo }]. */
export function mapaRotulos(unidades) {
  const itens = [], repetida = new Set(), quantos = new Map();
  const vistos = new Set();
  for (const u of unidades || []) {
    const chave = `${u.numero}|${u.bloco}`;
    /* bloco homônimo (blocos não tem unique(condominio, nome), e criar em
       corrida duplica "A"): a chave deixa de ser única, então nem tenta */
    if (vistos.has(chave)) { repetida.add(chave); continue; }
    vistos.add(chave);
    const curto = rotuloCurto(u);
    itens.push({ chave, bloco: u.bloco, curto });
    if (curto) {
      const k = `${u.bloco}|${curto}`;
      quantos.set(k, (quantos.get(k) || 0) + 1);
    }
  }
  const mapa = new Map();
  for (const it of itens) {
    if (!it.curto || repetida.has(it.chave)) continue;
    /* duas unidades do mesmo bloco colapsando no mesmo rótulo: as duas
       voltam ao número cru — duas linhas iguais seriam pior que o "1001-A" */
    if (quantos.get(`${it.bloco}|${it.curto}`) > 1) continue;
    mapa.set(it.chave, it.curto);
  }
  return mapa;
}

/* ═══════════════ ORDEM da listagem ═══════════════

   O banco ordena `numero` como texto (é varchar): 10, 11 e 12 vinham antes
   do 2. Aqui a comparação é numérica por trechos (localeCompare numeric):
   1, 2, 3 … 10, 11 — e vale igual para os números do lote ("101A" do 1º
   andar antes de "1001A" do 10º, que a tela mostra como 1-A e 10-A) e para
   letra no prefixo ("A2" antes de "A10"). Desempate pelo bloco, para cada
   número repetir a mesma sequência de blocos.
   Entrada: { numero, bloco } (strings cruas). */
const cmpNat = (a, b) => String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
export const compararUnidades = (a, b) => cmpNat(a.numero, b.numero) || cmpNat(a.bloco, b.bloco);

/* ═══════════════ BUSCA da tela Unidades ═══════════════

   A busca antiga tratava todo termo começado em dígito como
   `numero.startsWith(termo)`: quem via "1001-A" e digitava "1-A" não achava
   nada, e quem digitava "A" caía no texto livre e casava com "apartamento",
   trazendo o prédio inteiro. */

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const compacto = (s) => norm(s).replace(/[^a-z0-9]+/g, "");

/* prefixos estruturados, nos idiomas em que o app é usado */
const PREF_BLOCO = new Set(["bloco", "blocos", "torre", "torres", "bloque", "bloques", "block", "blocks", "tower"]);
const PREF_ANDAR = new Set(["andar", "andares", "piso", "pisos", "pavimento", "floor"]);

/* letra do apartamento, de qualquer lado do número ("1001-A" e "A1001" → "a") */
export const letraDaUnidade = (numero) => {
  const m = partes(numero || "");
  return m ? norm((m[1] + m[3]).replace(/[^A-Za-z]/g, "")) : "";
};

const casaTermo = (u, t, curto, letra) => {
  const ct = compacto(t), andar = String(u.andar ?? "");
  if (t.length <= 2) {
    /* 1 ou 2 caracteres: só identificador EXATO. Qualquer afrouxamento aqui
       faz "a" casar com "apartamento", com "alugada" e com o bloco "A" que
       toda unidade herda quando o campo fica vazio. */
    return letra === t || andar === t || compacto(curto) === ct || compacto(u.num) === ct;
  }
  /* 3+ caracteres: rótulo e número por dentro (compactos, para "10-a", "10a"
     e "1001" caírem na mesma unidade), depois o texto livre */
  if (ct && (compacto(curto).includes(ct) || compacto(u.num).includes(ct))) return true;
  if (andar === t) return true;
  return norm([u.bloco, u.tipo, u.tipoRaw, u.status, u.resp].join(" ")).includes(t);
};

/* u = linha de db.unidades ({ num, rotulo, bloco, andar, tipo, tipoRaw, status, resp }) */
export function casaUnidade(u, termo) {
  const termos = norm(termo).split(/\s+/).filter(Boolean);
  if (!termos.length) return true;
  const curto = u.rotulo || u.num || "";
  const letra = letraDaUnidade(u.num);
  for (let i = 0; i < termos.length; i++) {
    const t = termos[i], valor = termos[i + 1];
    if (PREF_BLOCO.has(t)) {
      if (!valor) continue; // ainda digitando o bloco — não filtra nada
      if (!norm(u.bloco).startsWith(valor)) return false;
      i++; continue;
    }
    if (PREF_ANDAR.has(t)) {
      if (!valor) continue; // ainda digitando o andar
      /* comparação numérica: "andar 1" não traz o 10, e "andar 01" traz o 1 */
      if (!/^\d+$/.test(valor) || u.andar == null || Number(valor) !== Number(u.andar)) return false;
      i++; continue;
    }
    if (!casaTermo(u, t, curto, letra)) return false;
  }
  return true;
}
