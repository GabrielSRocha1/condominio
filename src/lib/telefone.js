/* Telefones por país — DDI, faixa de dígitos nacionais e máscara de exibição.
   Fonte única para o PhoneInput (CondoMasterPro.jsx), a exibição na tabela de
   pessoas (api.js), o link de WhatsApp das cobranças e o importador de
   planilha. Sem lib externa de propósito: libphonenumber custa ~150 KB gz e o
   app só precisa de DDI + contagem de dígitos + agrupamento visual.

   Formato gravado no banco (pessoas.telefone, varchar(20)): E.164 sem espaços
   — "+5511912345678" (16 chars no máximo). Valor legado sem "+" é tratado
   como número nacional do país do condomínio (regras_internas.pais). */

/* [ISO-2, nome, DDI, mín. de dígitos, máx., máscaras por quantidade]
   Máscara: "#" é dígito, o resto é literal; quantidade sem máscara própria
   agrupa de 3 em 3. Cobre os países de MOEDA_POR_PAIS (api/_lib/geo.js), a
   América Latina inteira e os lusófonos — ordem alfabética (é a ordem dos
   seletores). Nomes em PT como em PAISES_STRIPE (CondoMasterPro.jsx). */
export const PAISES_TEL = [
  ["DE", "Alemanha", "49", 7, 11],
  ["AO", "Angola", "244", 9, 9, { 9: "### ### ###" }],
  ["AR", "Argentina", "54", 10, 11, { 10: "## ####-####" }],
  ["AU", "Austrália", "61", 9, 9, { 9: "### ### ###" }],
  ["AT", "Áustria", "43", 7, 12],
  ["BE", "Bélgica", "32", 8, 9, { 9: "### ## ## ##" }],
  ["BO", "Bolívia", "591", 8, 8, { 8: "# ### ####" }],
  ["BR", "Brasil", "55", 10, 11, { 10: "(##) ####-####", 11: "(##) #####-####" }],
  ["BG", "Bulgária", "359", 8, 9],
  ["CV", "Cabo Verde", "238", 7, 7, { 7: "### ## ##" }],
  ["CA", "Canadá", "1", 10, 10, { 10: "(###) ###-####" }],
  ["CL", "Chile", "56", 9, 9, { 9: "# #### ####" }],
  ["CY", "Chipre", "357", 8, 8, { 8: "## ######" }],
  ["CO", "Colômbia", "57", 10, 10, { 10: "### ### ####" }],
  ["CR", "Costa Rica", "506", 8, 8, { 8: "#### ####" }],
  ["HR", "Croácia", "385", 8, 9],
  ["CU", "Cuba", "53", 8, 8, { 8: "# ### ####" }],
  ["DK", "Dinamarca", "45", 8, 8, { 8: "## ## ## ##" }],
  ["SV", "El Salvador", "503", 8, 8, { 8: "#### ####" }],
  ["AE", "Emirados Árabes", "971", 8, 9, { 9: "## ### ####" }],
  ["EC", "Equador", "593", 8, 9, { 9: "## ### ####" }],
  ["SK", "Eslováquia", "421", 9, 9, { 9: "### ### ###" }],
  ["SI", "Eslovênia", "386", 8, 8, { 8: "## ### ###" }],
  ["ES", "Espanha", "34", 9, 9, { 9: "### ### ###" }],
  ["US", "Estados Unidos", "1", 10, 10, { 10: "(###) ###-####" }],
  ["EE", "Estônia", "372", 7, 8],
  ["FI", "Finlândia", "358", 6, 10],
  ["FR", "França", "33", 9, 9, { 9: "# ## ## ## ##" }],
  ["GR", "Grécia", "30", 10, 10, { 10: "### ### ####" }],
  ["GT", "Guatemala", "502", 8, 8, { 8: "#### ####" }],
  ["HN", "Honduras", "504", 8, 8, { 8: "#### ####" }],
  ["NL", "Holanda", "31", 9, 9],
  ["HK", "Hong Kong", "852", 8, 8, { 8: "#### ####" }],
  ["HU", "Hungria", "36", 8, 9, { 9: "## ### ####" }],
  ["IE", "Irlanda", "353", 7, 9, { 9: "## ### ####" }],
  ["IT", "Itália", "39", 8, 11, { 10: "### ### ####" }],
  ["JP", "Japão", "81", 10, 10, { 10: "##-####-####" }],
  ["LV", "Letônia", "371", 8, 8, { 8: "#### ####" }],
  ["LT", "Lituânia", "370", 8, 8, { 8: "### #####" }],
  ["LU", "Luxemburgo", "352", 6, 9],
  ["MY", "Malásia", "60", 9, 10, { 9: "##-### ####" }],
  ["MT", "Malta", "356", 8, 8, { 8: "#### ####" }],
  ["MX", "México", "52", 10, 10, { 10: "## #### ####" }],
  ["MZ", "Moçambique", "258", 9, 9, { 9: "## ### ####" }],
  ["NI", "Nicarágua", "505", 8, 8, { 8: "#### ####" }],
  ["NO", "Noruega", "47", 8, 8, { 8: "### ## ###" }],
  ["NZ", "Nova Zelândia", "64", 8, 10],
  ["PA", "Panamá", "507", 7, 8, { 8: "####-####" }],
  ["PY", "Paraguai", "595", 8, 9, { 8: "## ### ###", 9: "### ### ###" }],
  ["PE", "Peru", "51", 9, 9, { 9: "### ### ###" }],
  ["PL", "Polônia", "48", 9, 9, { 9: "### ### ###" }],
  ["PT", "Portugal", "351", 9, 9, { 9: "### ### ###" }],
  ["GB", "Reino Unido", "44", 10, 10, { 10: "#### ######" }],
  ["DO", "República Dominicana", "1", 10, 10, { 10: "(###) ###-####" }],
  ["RO", "Romênia", "40", 9, 9, { 9: "### ### ###" }],
  ["SG", "Singapura", "65", 8, 8, { 8: "#### ####" }],
  ["SE", "Suécia", "46", 7, 10],
  ["CH", "Suíça", "41", 9, 9, { 9: "## ### ## ##" }],
  ["TH", "Tailândia", "66", 8, 9, { 9: "## ### ####" }],
  ["CZ", "Tchéquia", "420", 9, 9, { 9: "### ### ###" }],
  ["UY", "Uruguai", "598", 8, 9, { 8: "#### ####", 9: "## ### ####" }],
  ["VE", "Venezuela", "58", 10, 10, { 10: "### ###-####" }],
];

const POR_PAIS = Object.fromEntries(PAISES_TEL.map((p) => [p[0], p]));

/* País desconhecido (ou vazio) cai no Brasil — mesmo pressuposto do código
   antigo do WhatsApp, que assumia DDI 55 */
export const telInfo = (pais) => {
  const [, nome, ddi, min, max, padroes] = POR_PAIS[pais] || POR_PAIS.BR;
  return { nome, ddi, min, max, padroes };
};

const soDigitos = (s) => String(s || "").replace(/\D/g, "");

/* agrupamento neutro para quantidades sem máscara própria: 3 em 3 */
const generico = (n) =>
  Array.from({ length: n }, (_, i) => "#" + ((i + 1) % 3 === 0 && i + 1 < n ? " " : "")).join("");

/* "11912345678" + BR → "(11) 91234-5678"; parcial formata até onde deu */
export const formatarTelNacional = (dig, pais) => {
  if (!dig) return "";
  const i = telInfo(pais);
  const pat = i.padroes?.[dig.length] || i.padroes?.[i.max] || generico(i.max);
  let out = "", n = 0;
  for (const ch of pat) {
    if (n >= dig.length) break;
    out += ch === "#" ? dig[n++] : ch;
  }
  return out + dig.slice(n); // dígitos além da máscara saem crus (valor legado)
};

export const validarTel = (dig, pais) => {
  const i = telInfo(pais);
  return dig.length >= i.min && dig.length <= i.max;
};

/* formato de gravação: "+5511912345678" */
export const normalizarTel = (dig, pais) => (dig ? `+${telInfo(pais).ddi}${dig}` : "");

/* placeholder do campo: a máscara do tamanho máximo do país */
export const exemploTel = (pais) => {
  const i = telInfo(pais);
  return i.padroes?.[i.max] || generico(i.max);
};

/* Valor armazenado → { pais, digitos }. Com "+", o DDI mais longo vence e o
   empate (ex.: +1 EUA/Canadá/Rep. Dominicana) fica com o país padrão; sem
   "+", é número nacional do país padrão (valor legado). */
export const separarTel = (valor, paisPadrao = "BR") => {
  const v = String(valor || "").trim();
  const pp = POR_PAIS[paisPadrao] ? paisPadrao : "BR";
  const dig = soDigitos(v);
  if (!v.startsWith("+")) return { pais: pp, digitos: dig };
  let m = null;
  for (const [iso, , ddi] of PAISES_TEL)
    if (dig.startsWith(ddi) && (!m || ddi.length > m.ddi.length || (ddi.length === m.ddi.length && iso === pp)))
      m = { iso, ddi };
  return m ? { pais: m.iso, digitos: dig.slice(m.ddi.length) } : { pais: pp, digitos: dig };
};

/* exibição em tabelas: "+55 (11) 91234-5678"; legado sem "+" sai só nacional */
export const telExibicao = (valor, paisPadrao = "BR") => {
  const v = String(valor || "").trim();
  if (!v) return "—";
  const { pais, digitos } = separarTel(v, paisPadrao);
  if (!digitos) return "—";
  const nacional = formatarTelNacional(digitos, pais);
  return v.startsWith("+") ? `+${telInfo(pais).ddi} ${nacional}` : nacional;
};

/* número para o link wa.me: DDI + nacional, só dígitos */
export const telParaWhats = (valor, paisPadrao = "BR") => {
  const v = String(valor || "").trim();
  const dig = soDigitos(v);
  if (!dig) return "";
  if (v.startsWith("+")) return dig;
  const i = telInfo(paisPadrao);
  /* legado gravado com DDI mas sem "+" (ex.: "5511912345678") passa direto */
  if (dig.length > i.max && dig.startsWith(i.ddi)) return dig;
  return i.ddi + dig;
};
