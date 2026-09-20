import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import App from "../CondoMasterPro.jsx";
import { resolverIdiomaInicial } from "./lib/idioma-boot.js";
import "./index.css";

/* O idioma é decidido antes de montar (a primeira visita consulta o país pelo
   IP). O #root está vazio no index.html, então esperar não mostra nada errado
   — mostra a tela em branco por mais alguns instantes, o que é melhor do que
   pintar num idioma e trocar em seguida. */
resolverIdiomaInicial().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
      <Analytics />
    </React.StrictMode>
  );
});

/* PWA: registra o service worker só no build de produção (em dev atrapalharia o HMR) */
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("[PWA] service worker não registrado:", e));
  });
}
