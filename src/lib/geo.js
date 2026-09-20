/* País do aparelho, vindo de /api/geo (mesma origem — a CSP não permite
   consultar serviço de geolocalização de terceiro, e nem seria desejável).
   O resultado fica em cache no próprio aparelho, então só a primeira visita
   paga a ida ao servidor. Nada aqui lança: sem resposta, quem chama segue
   com o padrão. */
const K_GEO = "cm_geo";
const TTL_OK = 7 * 24 * 60 * 60 * 1000;  // 7 dias — país raramente muda
const TTL_FALHA = 60 * 60 * 1000;        // 1 h — não martela o servidor fora do ar
const TIMEOUT = 1200;

const ler = () => { try { return JSON.parse(localStorage.getItem(K_GEO)) || null; } catch { return null; } };
const grava = (o) => { try { localStorage.setItem(K_GEO, JSON.stringify(o)); } catch { /* sem storage */ } };

/* Leitura SÍNCRONA do cache — devolve null se nunca consultou, se falhou ou
   se venceu. Usada onde não dá para esperar (valor inicial de um <select>). */
export const geoCache = () => {
  const c = ler();
  if (!c || !c.em) return null;
  const venceu = Date.now() - c.em > (c.falhou ? TTL_FALHA : TTL_OK);
  if (venceu || c.falhou) return null;
  return c;
};

let emVoo = null; // uma consulta por carregamento de página, no máximo

export const obterGeo = (ms = TIMEOUT) => {
  const cache = geoCache();
  if (cache) return Promise.resolve(cache);
  const recente = ler();
  if (recente?.falhou && Date.now() - recente.em <= TTL_FALHA) return Promise.resolve(null);
  if (emVoo) return emVoo;

  const ctrl = new AbortController();
  /* setTimeout explícito em vez de AbortSignal.timeout: o app roda como PWA e
     pode cair em WebView antiga */
  const corta = setTimeout(() => ctrl.abort(), ms);
  emVoo = fetch("/api/geo", { cache: "no-store", credentials: "omit", signal: ctrl.signal })
    .then((r) => (r.ok ? r.json() : null))
    .then((g) => {
      if (!g || typeof g !== "object") throw new Error("resposta inesperada");
      const info = { ...g, em: Date.now() };
      grava(info);
      return info;
    })
    .catch(() => { grava({ falhou: true, em: Date.now() }); return null; })
    .finally(() => { clearTimeout(corta); emVoo = null; });
  return emVoo;
};
