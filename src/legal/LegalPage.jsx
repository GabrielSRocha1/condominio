import React from "react";
import PT from "./conteudo.pt.js";
import ES from "./conteudo.es.js";
import EN from "./conteudo.en.js";

/* URLs reais servidas pela SPA (rewrites no vercel.json) → chave do documento */
export const LEGAL_PATHS = {
  "/termos": "termos",
  "/privacidade": "privacidade",
  "/termos-de-uso": "termosDeUso",
};

/* Os documentos completos existem em pt/es/en; os demais idiomas da UI leem
   a versão em inglês (a prevalência do português está no próprio texto). */
const PACOTES = { pt: PT, es: ES };

export default function LegalPage({ docKey, t, dark, setDark, lang, seletor }) {
  const pacote = PACOTES[lang] || EN;
  const langDoc = PACOTES[lang] ? lang : "en";
  const doc = pacote[docKey];
  const data = new Date(doc.atualizado + "T12:00:00").toLocaleDateString(pacote.ui.locale, { dateStyle: "long" });
  return (
    <div className="min-h-screen" style={{ background: t.bg, color: t.text, fontFamily: "'Inter',system-ui,sans-serif" }}>
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 pt-6">
        <a href="/" className="text-sm font-semibold" style={{ color: t.gold }}>← {pacote.ui.voltar}</a>
        <div className="flex items-center gap-3">
          <button onClick={() => setDark(!dark)} className="text-xs" style={{ color: t.dim, background: "transparent", border: "none" }}>
            {dark ? pacote.ui.temaClaro : pacote.ui.temaEscuro}</button>
          {seletor}
        </div>
      </header>
      {/* dir/lang locais: pt/es/en são LTR mesmo com a UI em árabe (RTL) */}
      <main dir="ltr" lang={langDoc} className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "'Sora',sans-serif" }}>{doc.titulo}</h1>
        <p className="mt-1 text-xs" style={{ color: t.dim }}>{pacote.ui.atualizado}: {data}</p>
        {doc.secoes.map((s, i) => (
          <section key={i} className="mt-6">
            <h2 className="text-base font-semibold" style={{ fontFamily: "'Sora',sans-serif" }}>{s.h}</h2>
            {(s.p || []).map((p, j) => <p key={j} className="mt-2 text-sm leading-relaxed" style={{ color: t.dim }}>{p}</p>)}
            {s.itens && <ul className="mt-2 list-disc pl-5 text-sm leading-relaxed" style={{ color: t.dim }}>
              {s.itens.map((it, j) => <li key={j} className="mt-1">{it}</li>)}</ul>}
            {(s.p2 || []).map((p, j) => <p key={j} className="mt-2 text-sm leading-relaxed" style={{ color: t.dim }}>{p}</p>)}
          </section>
        ))}
        <nav className="mt-10 flex flex-wrap gap-4 border-t pt-4 text-xs" style={{ borderColor: t.borderSoft }}>
          {Object.entries(LEGAL_PATHS).filter(([, k]) => k !== docKey).map(([path, k]) => (
            <a key={path} href={path} style={{ color: t.gold }}>{pacote[k].titulo}</a>
          ))}
        </nav>
      </main>
    </div>
  );
}
