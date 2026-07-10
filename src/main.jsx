import React from "react";
import ReactDOM from "react-dom/client";
import App from "../CondoMasterPro.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

/* PWA: registra o service worker só no build de produção (em dev atrapalharia o HMR) */
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("[PWA] service worker não registrado:", e));
  });
}
