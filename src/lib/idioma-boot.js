/* Decide o idioma ANTES do primeiro render, para ninguém ver a tela num
   idioma e ela trocar logo em seguida (em árabe a troca ainda viraria o
   layout inteiro para a direita).

   Ordem: escolha da pessoa (cm_lang) → detecção anterior (cm_lang_auto) →
   país do IP (/api/geo) → espanhol. Os dois primeiros já são resolvidos de
   forma síncrona no carregamento de src/lib/i18n.js, então em toda visita
   repetida não se espera nada — a ida ao servidor só acontece na primeira.

   A preferência salva no banco entra depois, no login (App.entrar), e a
   partir daí grava cm_lang e passa a mandar neste aparelho. */
import { idiomaResolvido, setLangAuto } from "./i18n.js";
import { obterGeo } from "./geo.js";

/* ms é o tempo máximo que vale a pena segurar a tela em branco. Estourado o
   prazo, renderiza em espanhol; se a resposta chegar depois, setLangAuto
   avisa o App e a tela se ajusta. */
export const resolverIdiomaInicial = (ms = 700) => {
  if (idiomaResolvido()) return Promise.resolve();
  const detectar = obterGeo().then((g) => { if (g?.idioma) setLangAuto(g.idioma); });
  return Promise.race([detectar, new Promise((pronto) => setTimeout(pronto, ms))]);
};
