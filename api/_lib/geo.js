/* País do visitante pelo IP — só o que a Vercel já injeta na borda.
   Nenhum serviço externo é consultado (a CSP do vercel.json só permite
   connect-src 'self', e mandar o IP de todo visitante para terceiro seria
   problema de LGPD/GDPR). O IP em si nunca é lido, guardado nem devolvido:
   aqui só chega o código de país de duas letras que a borda calculou.

   Usado em dois lugares: /api/geo (idioma e moeda da primeira visita) e
   api/auth/condominio.js (semente da moeda de gestão na criação do prédio). */

/* x-vercel-ip-country: ISO-3166-1 alpha-2, presente em funções serverless.
   Valores degenerados a descartar: vazio, XX (desconhecido) e T1 (Tor). */
export const paisDoRequest = (req) => {
  const p = String(req.headers["x-vercel-ip-country"] || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(p) && p !== "XX" && p !== "T1" ? p : null;
};

/* País → um dos 15 idiomas de LANGS (src/lib/i18n.js). Cuidado com códigos
   que parecem idioma e não são: AR é Argentina (espanhol), BN é Brunei
   (não bengali — esse é BD), IN é Índia (hi).

   Países cujo idioma o app ainda não fala (dinamarquês, polonês, tailandês,
   ucraniano…) entram como "en": saber que a pessoa está na Dinamarca e
   mostrar inglês é decidir pelo IP, e é bem melhor do que cair no espanhol.
   O espanhol fica para quando NÃO se sabe o país. Todos os países onde a
   Stripe abre conta estão mapeados, para nenhum cliente de verdade cair no
   vazio. */
export const IDIOMA_POR_PAIS = {
  /* português */
  BR: "pt", PT: "pt", AO: "pt", MZ: "pt", CV: "pt", GW: "pt", ST: "pt", TL: "pt",
  /* espanhol */
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es", EC: "es",
  GT: "es", CU: "es", BO: "es", DO: "es", HN: "es", PY: "es", SV: "es", NI: "es",
  CR: "es", PA: "es", UY: "es", PR: "es", GQ: "es",
  /* inglês — nativo ou franca */
  US: "en", GB: "en", CA: "en", AU: "en", NZ: "en", IE: "en", ZA: "en", NG: "en",
  KE: "en", GH: "en", PH: "en", SG: "en", MT: "en", ZW: "en", UG: "en", ZM: "en",
  JM: "en", TT: "en", PK: "en",
  /* inglês por falta de dicionário do idioma local */
  NL: "en", FI: "en", GR: "en", CY: "en", DK: "en", SE: "en", NO: "en", IS: "en",
  PL: "en", CZ: "en", SK: "en", HU: "en", RO: "en", BG: "en", HR: "en", SI: "en",
  EE: "en", LV: "en", LT: "en", RS: "en", TH: "en", VN: "en", IL: "en", UA: "en",
  /* francês */
  FR: "fr", BE: "fr", LU: "fr", MC: "fr", SN: "fr", CI: "fr", CM: "fr", ML: "fr",
  BF: "fr", NE: "fr", TD: "fr", TG: "fr", BJ: "fr", GA: "fr", CG: "fr", CD: "fr",
  MG: "fr", HT: "fr", GN: "fr", DJ: "fr",
  /* alemão, italiano */
  DE: "de", AT: "de", CH: "de", LI: "de",
  IT: "it", SM: "it", VA: "it",
  /* Ásia */
  CN: "zh", TW: "zh", HK: "zh", MO: "zh",
  JP: "ja", KR: "ko", KP: "ko",
  IN: "hi", BD: "bn",
  ID: "id", MY: "id", BN: "id",
  /* russo, turco */
  RU: "ru", BY: "ru", KZ: "ru", KG: "ru", TM: "ru", TJ: "ru", UZ: "ru",
  TR: "tr", AZ: "tr",
  /* árabe (o app vira para dir="rtl") */
  SA: "ar", AE: "ar", EG: "ar", MA: "ar", DZ: "ar", TN: "ar", LY: "ar", JO: "ar",
  LB: "ar", SY: "ar", IQ: "ar", KW: "ar", QA: "ar", BH: "ar", OM: "ar", YE: "ar",
  SD: "ar", MR: "ar", PS: "ar",
};

/* País → moeda de gestão. Espelho de PAISES_CONNECT (api/stripe/_lib/comum.js)
   mais AR e PY, que a Stripe não atende mas seguem nos meios manuais.
   Duplicado de propósito: importar comum.js puxaria o SDK da Stripe e o
   supabase-js para dentro de /api/geo, que está no caminho do primeiro paint. */
export const MOEDA_POR_PAIS = {
  BR: "BRL", US: "USD", CA: "CAD", MX: "MXN",
  PT: "EUR", ES: "EUR", FR: "EUR", DE: "EUR", IT: "EUR", NL: "EUR", BE: "EUR",
  AT: "EUR", IE: "EUR", LU: "EUR", FI: "EUR", GR: "EUR", CY: "EUR", MT: "EUR",
  SK: "EUR", SI: "EUR", EE: "EUR", LV: "EUR", LT: "EUR", HR: "EUR",
  GB: "GBP", CH: "CHF", DK: "DKK", SE: "SEK", NO: "NOK", PL: "PLN",
  CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN", AU: "AUD", NZ: "NZD",
  JP: "JPY", SG: "SGD", HK: "HKD", MY: "MYR", TH: "THB", AE: "AED",
  AR: "ARS", PY: "PYG",
};

/* países em que a Stripe abre conta conectada — espelho das chaves de
   PAISES_CONNECT; serve só para pré-selecionar o seletor do onboarding */
const PAISES_STRIPE = new Set([
  "BR", "US", "CA", "MX", "PT", "ES", "FR", "DE", "IT", "NL", "BE", "AT", "IE",
  "LU", "FI", "GR", "CY", "MT", "SK", "SI", "EE", "LV", "LT", "HR", "GB", "CH",
  "DK", "SE", "NO", "PL", "CZ", "HU", "RO", "BG", "AU", "NZ", "JP", "SG", "HK",
  "MY", "TH", "AE",
]);

/* Sem país resolvido, todos os campos voltam null e quem chama decide o
   padrão — o cliente cai no espanhol, a criação de condomínio cai em USD
   (o mesmo default de src/lib/api.js e de checkout-cobranca.js). */
export const resolverGeo = (req) => {
  const pais = paisDoRequest(req);
  return {
    pais,
    idioma: (pais && IDIOMA_POR_PAIS[pais]) || null,
    moeda: (pais && MOEDA_POR_PAIS[pais]) || null,
    paisStripe: pais && PAISES_STRIPE.has(pais) ? pais : null,
    fonte: pais ? "vercel" : "ausente",
  };
};
