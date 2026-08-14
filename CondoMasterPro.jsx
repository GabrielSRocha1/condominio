import React, { useState, useEffect, useMemo, useCallback } from "react";
import QRCodeLib from "qrcode";
import {
  LayoutDashboard, Building2, Home, Users, Wallet, QrCode, Gavel, Megaphone,
  FileText, Wrench, ShieldCheck, LogOut, Sun, Moon, Search, Plus,
  ChevronRight, ChevronLeft, X, Check, Clock, AlertCircle, CheckCircle2,
  Download, Filter, Bell, Menu, Eye, Send, Printer, RefreshCw, TrendingUp,
  TrendingDown, CircleDot, User, KeyRound, Car, Package, DoorOpen, Star,
  CalendarClock, ListChecks, MoreHorizontal, Pencil, Ban,
  Mail, EyeOff, Trash2, UserPlus, Upload, Copy, MapPin, Banknote
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend
} from "recharts";
import {
  loadAll, criarCondominio, criarUnidade, criarPessoa, criarLancamento, decidirLancamento, criarPenalidade, decidirPenalidade,
  criarComunicado, criarChamado, criarPreAutorizacao, gerarCobrancas, baixarPdfCobranca, loginDiretor,
  assinarLicencaCommet, verificarLicencaCommet, estenderTesteCommet, cancelarAssinaturaCommet, listarPlanos, trocarPlanoLicenca, registrarDiretor,
  criarAcesso, listarAcessos, removerAcesso, loginUsuario, setAuthToken,
  salvarLogoCondominio, removerLogoCondominio, obterCondominio, salvarCondominio, salvarAreaUnidade, salvarResponsavelUnidade, atualizarUnidade, excluirUnidade,
  atualizarPessoa, removerPessoa, marcarLancamentoPago, enviarPenalidade, criarDocumento, atualizarChamado,
  gerarQrAcesso, validarQrAcesso, confirmarEntradaQr, registrarOcorrencia, registrarEntrega,
} from "./src/lib/api.js";

import { L, LANG, LANGS, setLang } from "./src/lib/i18n.js";

/* Traduz os filhos de texto de um componente, preservando ícones e espaços */
const trKids = (children) => React.Children.map(children, (c) => {
  if (typeof c !== "string") return c;
  const s = c.trim();
  return s ? c.replace(s, () => L(s)) : c;
});

const LangSel = ({ t, lang, onLang }) => (
  <select value={lang} onChange={(e) => onLang(e.target.value)} title={L("Idioma")}
    className="max-w-[110px] rounded-lg px-2 py-2 text-xs font-semibold"
    style={{ background: t.surface2, color: t.dim, border: "none", cursor: "pointer" }}>
    {LANGS.map(([code, nome]) => <option key={code} value={code}>{nome}</option>)}
  </select>
);

/* ══════════════ DESIGN TOKENS — Verum design system ══════════════ */
const THEMES = {
  dark: {
    bg: "#0A0E1A", surface: "#111827", surface2: "#18213A", sidebar: "#0D1220",
    border: "rgba(212,175,55,0.16)", borderSoft: "rgba(255,255,255,0.07)",
    text: "#ECEFF7", dim: "#8C94A9", gold: "#D4AF37", goldSoft: "rgba(212,175,55,0.12)",
    glass: "rgba(13,18,32,0.85)", shadow: "0 8px 30px rgba(0,0,0,0.45)",
    ok: "#22C55E", warn: "#EAB308", danger: "#EF4444", info: "#3B82F6", purple: "#A855F7",
  },
  light: {
    bg: "#F5F4EF", surface: "#FFFFFF", surface2: "#F0EEE6", sidebar: "#FFFFFF",
    border: "rgba(158,124,20,0.30)", borderSoft: "rgba(20,25,40,0.10)",
    text: "#171E2E", dim: "#68708A", gold: "#9E7C14", goldSoft: "rgba(158,124,20,0.10)",
    glass: "rgba(255,255,255,0.9)", shadow: "0 8px 24px rgba(23,30,46,0.10)",
    ok: "#16A34A", warn: "#CA8A04", danger: "#DC2626", info: "#2563EB", purple: "#9333EA",
  },
};

/* Moeda de gestão do condomínio — padrão: dólar (USD). O App chama setMoeda
   quando o cadastro do condomínio traz outra moeda salva nas configurações. */
const LOCALE_MOEDA = { BRL: "pt-BR", USD: "en-US", EUR: "de-DE", GBP: "en-GB", ARS: "es-AR", PYG: "es-PY" };
let MOEDA = "USD";
const setMoeda = (m) => { MOEDA = LOCALE_MOEDA[m] ? m : "USD"; };
const BRL = (v) => v.toLocaleString(LOCALE_MOEDA[MOEDA], { style: "currency", currency: MOEDA });
/* preços da licença SaaS: sempre em dólar (USD), independente da moeda de gestão */
const USD = (v) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
const uid = () => Math.random().toString(36).slice(2, 9);

/* ══════════════ CONTAS DE ACESSO (salvas neste navegador — modo demo) ══════════════ */
/* Todos os dados de contas e acessos vivem na tabela usuarios do Supabase.
   O localStorage guarda APENAS a sessão (perfil e nome de quem entrou — nunca
   a senha), para a pessoa não precisar logar de novo ao recarregar a página. */
const K_SESSAO = "cm_sessao";
const K_TELA = "cm_tela"; // tela ativa — sobrevive ao recarregar a página (por aba)
const lerSessao = () => { try { return JSON.parse(localStorage.getItem(K_SESSAO)) || null; } catch { return null; } };
const salvarSessao = (s) => { try { s ? localStorage.setItem(K_SESSAO, JSON.stringify(s)) : localStorage.removeItem(K_SESSAO); } catch { /* sem storage */ } };
setAuthToken(lerSessao()?.token || null); // restaura o token do RLS antes da primeira consulta

/* ══════════════ PERFIS E NAVEGAÇÃO ══════════════ */
const PROFILES = {
  diretor:       { label: "Diretor",        icon: Star,        desc: "Visão estratégica, aprovações e auditoria" },
  sindico:       { label: "Síndico",        icon: ShieldCheck, desc: "Operação, multas, comunicados e manutenção" },
  tesouraria:    { label: "Tesouraria",     icon: Wallet,      desc: "Financeiro, cobranças e conciliação" },
  morador:       { label: "Morador",        icon: Home,        desc: "Boletos, comprovantes, comunicados e chamados" },
};

const NAV = [
  { id: "dashboard",  label: "Dashboard",       icon: LayoutDashboard, roles: ["diretor","sindico","tesouraria"] },
  { id: "condominio", label: "Condomínio",      icon: Building2,       roles: ["diretor","sindico"] },
  { id: "unidades",   label: "Unidades",        icon: Home,            roles: ["diretor","sindico","tesouraria"] },
  { id: "pessoas",    label: "Pessoas",         icon: Users,           roles: ["diretor","sindico"] },
  { id: "financeiro", label: "Financeiro",      icon: Wallet,          roles: ["diretor","sindico","tesouraria"] },
  { id: "cobrancas",  label: "Cobranças QR",    icon: QrCode,          roles: ["diretor","sindico","tesouraria"] },
  { id: "multas",     label: "Multas",          icon: Gavel,           roles: ["diretor","sindico"] },
  { id: "comunicados",label: "Comunicados",     icon: Megaphone,       roles: ["diretor","sindico"] },
  { id: "documentos", label: "Documentos",      icon: FileText,        roles: ["diretor","sindico","tesouraria"] },
  { id: "chamados",   label: "Manutenção",      icon: Wrench,          roles: ["diretor","sindico"] },
  { id: "portaria",   label: "Portaria",        icon: DoorOpen,        roles: ["diretor","sindico"] },
  { id: "emails",     label: "Gerenciar Acessos",icon: Mail,            roles: ["diretor"] },
  { id: "planos",     label: "Planos",           icon: Star,            roles: ["diretor"] },
];

/* ══════════════ DADOS (Supabase) ══════════════ */
const DataCtx = React.createContext(null);
const useData = () => React.useContext(DataCtx);

/* Envia um formulário: coleta os campos com FormData, executa a ação e trata erros.
   Campos repetidos (ex.: input de arquivo com "multiple") viram array. */
const useSubmit = (action) => {
  const [saving, setSaving] = useState(false);
  const onSubmit = async (e) => {
    e.preventDefault();
    const f = {};
    for (const [k, v] of new FormData(e.currentTarget).entries()) f[k] = k in f ? [].concat(f[k], v) : v;
    setSaving(true);
    try { await action(f); } catch (err) { alert("Não foi possível salvar: " + (err?.message || err)); }
    finally { setSaving(false); }
  };
  return [onSubmit, saving];
};

/* Campo de valor monetário: formata enquanto digita, na moeda de gestão do
   condomínio. O valor submetido (input oculto) sai como "1234,56" — o formato
   que o parseBRL da camada de dados entende, independente da moeda exibida. */
function MoneyInput({ t, name, moeda = "USD", required, defaultCents = null }) {
  const [cents, setCents] = useState(defaultCents);
  const fmt = (c) => (c / 100).toLocaleString(LOCALE_MOEDA[moeda] || "en-US", { style: "currency", currency: moeda });
  return (<>
    <input inputMode="numeric" required={required} placeholder={fmt(0)}
      value={cents == null ? "" : fmt(cents)}
      onChange={(e) => { const dig = e.target.value.replace(/\D/g, "").slice(0, 15); setCents(dig ? parseInt(dig, 10) : null); }}
      style={inputStyle(t)} />
    <input type="hidden" name={name} value={cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",")} />
  </>);
}

/* Área privativa (m²): digite só números — o campo formata com vírgula e duas
   casas decimais (8650 → 86,50). O valor submetido (input oculto) sai como
   "86,50", o formato que o parseBRL da camada de dados entende. */
function AreaInput({ t, name, required, defaultValue = null, inputRef }) {
  const [cents, setCents] = useState(() => {
    const n = Number(String(defaultValue ?? "").replace(",", "."));
    return defaultValue != null && defaultValue !== "" && !Number.isNaN(n) ? Math.round(n * 100) : null;
  });
  const fmt = (c) => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (<>
    <input inputMode="numeric" required={required} placeholder="0,00"
      value={cents == null ? "" : fmt(cents)}
      onChange={(e) => { const dig = e.target.value.replace(/\D/g, "").slice(0, 9); setCents(dig ? parseInt(dig, 10) : null); }}
      style={inputStyle(t)} />
    <input type="hidden" name={name} ref={inputRef} value={cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",")} readOnly />
  </>);
}

/* Campo de anexo: input de arquivo real com o visual tracejado do app */
function FileField({ t, name, accept, multiple, height = 42, hint = "Anexar arquivo" }) {
  const [sel, setSel] = useState("");
  return (
    <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed px-2 text-xs"
      style={{ height, borderColor: sel ? t.gold : t.borderSoft, color: sel ? t.gold : t.dim }}>
      <input name={name} type="file" accept={accept} multiple={multiple} className="hidden"
        onChange={(e) => { const fs = [...(e.target.files || [])]; setSel(fs.length > 1 ? `${fs.length} arquivos selecionados` : fs[0]?.name || ""); }} />
      <Upload size={13} /> <span className="max-w-full truncate">{sel || hint}</span>
    </label>
  );
}

const STATUS_META = {
  pago:{c:"ok",l:"Pago"}, parcial:{c:"warn",l:"Parcial"}, aberto:{c:"info",l:"Em aberto"},
  aguardando:{c:"warn",l:"Aguardando"}, vencida:{c:"danger",l:"Vencida"}, emitida:{c:"info",l:"Emitida"},
  ocupada:{c:"ok",l:"Ocupada"}, alugada:{c:"info",l:"Alugada"}, vaga:{c:"warn",l:"Vaga"},
  ativo:{c:"ok",l:"Ativo"}, teste:{c:"warn",l:"Em teste"}, inadimplente:{c:"danger",l:"Inadimplente"},
  aguardando_defesa:{c:"warn",l:"Prazo de defesa"}, aprovada:{c:"danger",l:"Multa aplicada"}, advertencia:{c:"info",l:"Advertência"},
  pendente:{c:"warn",l:"Pendente — revisão do síndico"}, aprovada_envio:{c:"gold",l:"Aprovada — enviar ao responsável"},
  entregue:{c:"info",l:"Entregue"}, encerrada:{c:"ok",l:"Encerrada"}, paga:{c:"ok",l:"Paga"},
  andamento:{c:"info",l:"Em andamento"}, concluido:{c:"ok",l:"Concluído"},
  dentro:{c:"info",l:"No condomínio"}, saiu:{c:"ok",l:"Saiu"}, retirado:{c:"ok",l:"Retirado"}, ocorrencia:{c:"warn",l:"Ocorrência"},
  cancelada:{c:"danger",l:"Cancelada"}, cancelado:{c:"danger",l:"Cancelado"}, vendida:{c:"info",l:"Vendida"}, reservada:{c:"warn",l:"Reservada"}, inativa:{c:"danger",l:"Inativa"},
  alta:{c:"danger",l:"Alta"}, media:{c:"warn",l:"Média"}, baixa:{c:"ok",l:"Baixa"},
};

/* ══════════════ COMPONENTES BASE ══════════════ */
const Badge = ({ s, t }) => {
  const m = STATUS_META[s] || { c: "info", l: s };
  return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
    style={{ background: t[m.c] + "1E", color: t[m.c] }}><CircleDot size={9} /> {L(m.l)}</span>;
};

const Card = ({ t, children, className = "", pad = true, ...rest }) => (
  <div {...rest} className={`rounded-2xl border ${pad ? "p-4" : ""} ${className}`}
    style={{ background: t.surface, borderColor: t.borderSoft, boxShadow: t.shadow, color: t.text }}>{children}</div>
);

const StatCard = ({ t, icon: Ic, label, value, trend, color }) => (
  <Card t={t}>
    <div className="flex items-start justify-between">
      <div className="rounded-xl p-2" style={{ background: (color || t.gold) + "1A" }}><Ic size={17} color={color || t.gold} /></div>
      {trend != null && (
        <span className="flex items-center gap-0.5 text-xs font-semibold" style={{ color: trend >= 0 ? t.ok : t.danger }}>
          {trend >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{Math.abs(trend)}%
        </span>)}
    </div>
    <div className="mt-2 min-w-0 truncate text-lg font-bold sm:text-xl" title={String(value)} style={{ fontFamily: "'Sora',sans-serif", color: color || t.text }}>{value}</div>
    <div className="truncate text-xs" title={L(label)} style={{ color: t.dim }}>{L(label)}</div>
  </Card>
);

const SectionTitle = ({ t, children, action }) => (
  <div className="mb-3 flex items-center justify-between">
    <h2 className="text-sm font-semibold" style={{ fontFamily: "'Sora',sans-serif", color: t.text }}>{trKids(children)}</h2>{action}
  </div>
);

const Btn = ({ t, kind = "ghost", children, className = "", ...rest }) => {
  const s = {
    primary: { background: t.gold, color: "#131313", border: "1px solid transparent" },
    ghost:   { background: "transparent", color: t.dim, border: `1px solid ${t.borderSoft}` },
    danger:  { background: "transparent", color: t.danger, border: `1px solid ${t.danger}55` },
    soft:    { background: t.goldSoft, color: t.gold, border: `1px solid ${t.border}` },
  }[kind];
  return <button type="button" {...rest} style={s}
    className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50 ${className}`}>{trKids(children)}</button>;
};

const inputStyle = (t) => ({ background: t.surface2, color: t.text, border: `1px solid ${t.borderSoft}`, borderRadius: 10, padding: "8px 10px", width: "100%", fontSize: 14 });

/* Campo de senha com o "olho" para revelar/ocultar o que foi digitado */
const PasswordInput = ({ t, ...rest }) => {
  const [ver, setVer] = useState(false);
  return (
    <div className="relative">
      <input {...rest} type={ver ? "text" : "password"} style={{ ...inputStyle(t), paddingRight: 36 }} />
      <button type="button" tabIndex={-1} onClick={() => setVer((v) => !v)}
        aria-label={ver ? L("Ocultar senha") : L("Mostrar senha")}
        className="absolute inset-y-0 right-0 flex items-center px-2.5" style={{ color: t.dim, background: "transparent", border: "none" }}>
        {ver ? <EyeOff size={15} /> : <Eye size={15} />}</button>
    </div>
  );
};

const Field = ({ t, label, children }) => (
  <label className="block space-y-1 text-sm"><div className="text-xs font-medium" style={{ color: t.dim }}>{L(label)}</div>{children}</label>
);

const Modal = ({ t, onClose, children, wide }) => (
  <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)" }}
    onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className={`vfade max-h-[92vh] w-full ${wide ? "max-w-2xl" : "max-w-md"} overflow-y-auto rounded-t-3xl border p-5 sm:rounded-3xl`}
      style={{ background: t.surface, borderColor: t.border, boxShadow: t.shadow, color: t.text }} role="dialog" aria-modal="true">{children}</div>
  </div>
);

const ModalHeader = ({ t, title, onClose }) => (
  <div className="mb-4 flex items-center justify-between">
    <div className="text-base font-bold" style={{ fontFamily: "'Sora',sans-serif", color: t.text }}>{L(title)}</div>
    <button onClick={onClose} className="rounded-lg p-1.5" style={{ background: t.surface2 }}><X size={16} color={t.dim} /></button>
  </div>
);

const EmptyState = ({ t, icon: Ic = ListChecks, title, hint, action }) => (
  <Card t={t} className="p-10 text-center">
    <Ic size={30} color={t.dim} className="mx-auto mb-3" />
    <div className="text-sm font-semibold" style={{ color: t.text }}>{L(title)}</div>
    <div className="mx-auto mt-1 max-w-sm text-xs" style={{ color: t.dim }}>{L(hint)}</div>
    {action && <div className="mt-4">{action}</div>}
  </Card>
);

const ErrorState = ({ t, onRetry }) => (
  <Card t={t} className="p-8 text-center">
    <AlertCircle size={28} color={t.danger} className="mx-auto mb-2" />
    <div className="text-sm font-semibold" style={{ color: t.text }}>{L("Não foi possível carregar os dados")}</div>
    <div className="mt-1 text-xs" style={{ color: t.dim }}>{L("Verifique a conexão e tente novamente. Se o problema continuar, contate o suporte.")}</div>
    <div className="mt-4"><Btn t={t} kind="soft" onClick={onRetry}><RefreshCw size={14} /> Tentar novamente</Btn></div>
  </Card>
);

const Skeleton = ({ t, rows = 4 }) => (
  <div className="space-y-3">{Array.from({ length: rows }).map((_, i) => (
    <div key={i} className="vpulse rounded-2xl" style={{ height: i === 0 ? 110 : 68, background: t.surface, animationDelay: `${i * 0.1}s` }} />
  ))}</div>
);

/* Tabela responsiva: vira cards no mobile */
const Tbl = ({ t, cols, rows, renderCell, onRowClick, empty }) => {
  if (!rows.length) return empty;
  return (
    <>
      <Card t={t} pad={false} className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead><tr style={{ color: t.dim }} className="text-left text-xs">
            {cols.map((c) => <th key={c.k} className="px-4 py-3 font-medium">{L(c.l)}</th>)}
          </tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} onClick={() => onRowClick?.(r)}
              className={`border-t transition-colors ${onRowClick ? "cursor-pointer hover:bg-white/[0.02]" : ""}`}
              style={{ borderColor: t.borderSoft }}>
              {cols.map((c) => <td key={c.k} className="px-4 py-3">{renderCell(r, c.k)}</td>)}
            </tr>))}
          </tbody>
        </table>
      </Card>
      <div className="space-y-2 md:hidden">{rows.map((r) => (
        <Card t={t} key={r.id} className={onRowClick ? "cursor-pointer" : ""} onClick={() => onRowClick?.(r)}>
          <div className="space-y-1.5">{cols.map((c) => (
            <div key={c.k} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-xs" style={{ color: t.dim }}>{L(c.l)}</span>
              <span className="text-right">{renderCell(r, c.k)}</span>
            </div>))}
          </div>
        </Card>))}
      </div>
    </>
  );
};

const Toolbar = ({ t, q, setQ, placeholder, children, action }) => (
  <div className="mb-4 flex flex-wrap items-center gap-2">
    <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border px-3 py-2" style={{ background: t.surface, borderColor: t.borderSoft }}>
      <Search size={15} color={t.dim} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L(placeholder)} className="w-full bg-transparent text-sm" style={{ color: t.text }} />
      {q && <button onClick={() => setQ("")}><X size={14} color={t.dim} /></button>}
    </div>
    {children}{action}
  </div>
);

const Sel = ({ t, value, onChange, opts }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl border px-2 py-2 text-xs"
    style={{ background: t.surface, color: t.text, borderColor: t.borderSoft }}>
    {opts.map(([v, l]) => <option key={v} value={v}>{L(l)}</option>)}
  </select>
);

const chartTip = (t) => ({ contentStyle: { background: t.surface, border: `1px solid ${t.borderSoft}`, borderRadius: 10, color: t.text, fontSize: 12 } });

/* QR ilustrativo (placeholder visual — sem integração) */
const QRMock = ({ seed = "verum", size = 148 }) => {
  const cells = useMemo(() => {
    let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const g = []; for (let i = 0; i < 441; i++) { h = (h * 1103515245 + 12345) >>> 0; g.push((h >> 16) & 1); }
    return g;
  }, [seed]);
  const n = 21, c = size / n;
  const finder = (x, y) => (
    <g key={`${x}${y}`}><rect x={x*c} y={y*c} width={7*c} height={7*c} fill="#131313" />
      <rect x={(x+1)*c} y={(y+1)*c} width={5*c} height={5*c} fill="#fff" />
      <rect x={(x+2)*c} y={(y+2)*c} width={3*c} height={3*c} fill="#131313" /></g>);
  return (
    <svg width={size} height={size} className="rounded-lg" style={{ background: "#fff", padding: 6 }} aria-label="QR Code de pagamento (ilustrativo)">
      {cells.map((v, i) => { const x = i % n, y = Math.floor(i / n);
        if ((x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12)) return null;
        return v ? <rect key={i} x={x*c} y={y*c} width={c} height={c} fill="#131313" /> : null; })}
      {finder(0,0)}{finder(14,0)}{finder(0,14)}
    </svg>
  );
};

/* Documento timbrado — cabeçalho, CNPJ e assinatura vêm do cadastro do próprio condomínio */
const Timbrado = ({ t, tipo, corpo, unidade, valor, prazo }) => {
  const c = useData()?.db?.cond || {};
  const iniciais = (c.nome || "—").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  return (
  <div className="overflow-hidden rounded-xl border" style={{ borderColor: t.border, background: "#FDFCF7", color: "#1A1A1A" }}>
    <div className="flex items-center gap-3 px-5 pt-5">
      {c.logoUrl
        ? <img src={c.logoUrl} alt="Logo" className="h-10 w-10 rounded-full object-contain" style={{ background: "#0A0E1A" }} />
        : <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold" style={{ background: "#0A0E1A", color: "#D4AF37" }}>{iniciais || "?"}</div>}
      <div>
        <div className="text-sm font-bold" style={{ fontFamily: "'Sora',sans-serif" }}>{c.nome || "—"}</div>
        <div className="text-[11px]" style={{ color: "#666" }}>{[c.cnpj && `CNPJ ${c.cnpj}`, c.endereco].filter(Boolean).join(" · ") || "Complete o cadastro do condomínio"}</div>
      </div>
    </div>
    <div className="mx-5 mt-3 h-[2px]" style={{ background: "linear-gradient(90deg,#D4AF37,transparent)" }} />
    <div className="px-5 py-4 text-[13px] leading-relaxed">
      <div className="mb-2 text-xs font-bold uppercase tracking-widest" style={{ color: "#9E7C14" }}>{tipo}</div>
      <p style={{ whiteSpace: "pre-wrap" }}>{corpo}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs" style={{ color: "#444" }}>
        <div><b>Unidade:</b> {unidade}</div>
        {valor != null && <div><b>Valor:</b> {BRL(valor)}</div>}
        {prazo && <div><b>Prazo para defesa:</b> {prazo}</div>}
        <div><b>Data de emissão:</b> {new Date().toLocaleDateString("pt-BR")}</div>
      </div>
      <div className="mt-5 border-t pt-3 text-center text-xs" style={{ borderColor: "#DDD", color: "#666" }}>
        {c.sindico || "Síndico"} — Síndico · assinatura eletrônica registrada na plataforma
      </div>
    </div>
  </div>
  );
};

/* Hook: simula ciclo de carregamento por tela */
const useLoad = (screen) => {
  const [phase, setPhase] = useState("loading");
  useEffect(() => { setPhase("loading"); const id = setTimeout(() => setPhase("ready"), 600); return () => clearTimeout(id); }, [screen]);
  return [phase, () => setPhase("ready")];
};

/* ══════════════ LOGIN ══════════════ */
function Login({ t, onEnter, dark, setDark, lang, onLang }) {
  const [diretor, setDiretor] = useState(null); // conta do diretor desta sessão (a fonte é o banco)
  const [role, setRole] = useState(null);
  const [erro, setErro] = useState("");
  const [jaCadastrado, setJaCadastrado] = useState(false); // pula o cadastro quando o prédio já existe
  const [verificando, setVerificando] = useState(false);

  /* primeiro acesso: cria a conta que dará acesso ao perfil Diretor —
     gravada na tabela usuarios do Supabase — e já entra logado direto na
     tela de boas-vindas (cadastro do condomínio) */
  const registrar = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (f.senha.length < 4) return setErro(L("A senha deve ter pelo menos 4 caracteres."));
    if (f.senha !== f.confirma) return setErro(L("As senhas não conferem."));
    const conta = { nome: f.nome.trim(), email: f.email.trim().toLowerCase(), senha: f.senha };
    setVerificando(true);
    try {
      const nova = await registrarDiretor(conta);
      setDiretor(nova); setErro("");
      return onEnter("diretor", null, nova, nova.condominioId || null, nova.token);
    } catch (err) {
      setErro(err.message || L("Não foi possível concluir o cadastro agora."));
    } finally { setVerificando(false); }
  };

  const entrar = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (role === "morador") {
      /* morador entra com o nome cadastrado pelo diretor em Gerenciar Acessos */
      const nome = (f.nome || "").trim();
      setVerificando(true);
      try {
        const conta = await loginUsuario("morador", { nome, senha: f.senha });
        if (conta) { setErro(""); return onEnter(role, { nome: conta.nome, unidade: conta.unidade || null }, null, conta.condominioId, conta.token); }
        setErro(L("Nome ou senha incorretos. Peça ao diretor para conferir seu acesso em Gerenciar Acessos."));
      } catch (err) {
        setErro(L("Não foi possível verificar sua conta agora.") + " " + err.message);
      } finally { setVerificando(false); }
      return;
    }
    const email = f.email.trim().toLowerCase();
    if (role === "diretor") {
      if (diretor && email === diretor.email && f.senha === diretor.senha) { setErro(""); return onEnter(role, null, diretor, diretor.condominioId || null, diretor.token); }
      /* confere e-mail e senha na tabela usuarios */
      setVerificando(true);
      try {
        const conta = await loginDiretor(email, f.senha);
        if (conta) { setDiretor(conta); setErro(""); return onEnter(role, null, conta, conta.condominioId || null, conta.token); }
        setErro(L("E-mail ou senha incorretos."));
      } catch (err) {
        setErro(L("Não foi possível verificar sua conta agora.") + " " + err.message);
      } finally { setVerificando(false); }
      return;
    }
    setVerificando(true);
    try {
      const conta = await loginUsuario(role, { email, senha: f.senha });
      if (conta) { setErro(""); return onEnter(role, null, null, conta.condominioId, conta.token); }
      setErro(L("E-mail ou senha incorretos. Peça ao diretor para conferir seu acesso em Gerenciar Acessos."));
    } catch (err) {
      setErro(L("Não foi possível verificar sua conta agora.") + " " + err.message);
    } finally { setVerificando(false); }
  };

  const temAcesso = true; // acessos agora vivem no banco — a validação é feita no envio

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: t.bg, color: t.text, fontFamily: "'Inter',system-ui,sans-serif" }}>
      <div className="pointer-events-none fixed inset-0" style={{ background: `radial-gradient(600px 300px at 50% 0%, ${t.gold}14, transparent)` }} />
      <div className="vfade w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-bold"
            style={{ background: t.goldSoft, color: t.gold, border: `1px solid ${t.border}`, fontFamily: "'Sora',sans-serif" }}>CM</div>
          <h1 className="text-xl font-bold tracking-wide" style={{ fontFamily: "'Sora',sans-serif" }}>
            CONDOMASTER <span style={{ color: t.gold }}>PRO</span></h1>
          <p className="mt-1 text-xs" style={{ color: t.dim }}>{L("Gestão condominial premium · powered by Serve Now Global")}</p>
        </div>
        <Card t={t} className="p-5">
          {!diretor && !jaCadastrado ? (
            <form onSubmit={registrar} className="space-y-3">
              <div className="text-sm font-semibold">{L("Criar acesso do diretor")}</div>
              <div className="text-xs" style={{ color: t.dim }}>
                {L("Este é o primeiro acesso. A conta criada aqui será usada para entrar como")} <b style={{ color: t.text }}>{L("Diretor")}</b>
                {L(", que poderá cadastrar os e-mails e senhas dos demais perfis em Gerenciar Acessos.")}</div>
              <Field t={t} label="Nome completo"><input name="nome" required placeholder={L("Seu nome")} style={inputStyle(t)} /></Field>
              <Field t={t} label="E-mail"><input name="email" type="email" required placeholder={L("voce@exemplo.com")} style={inputStyle(t)} /></Field>
              <Field t={t} label="Senha"><PasswordInput t={t} name="senha" required placeholder={L("Mínimo 4 caracteres")} /></Field>
              <Field t={t} label="Confirmar senha"><PasswordInput t={t} name="confirma" required placeholder={L("Repita a senha")} /></Field>
              {erro && <div className="text-xs" style={{ color: t.danger }}>{erro}</div>}
              <Btn t={t} kind="primary" type="submit" className="w-full" disabled={verificando}>
                <UserPlus size={15} /> {verificando ? L("Salvando cadastro…") : L("Criar conta e continuar")}</Btn>
              <div className="pt-1 text-center">
                <button type="button" onClick={() => { setJaCadastrado(true); setRole(null); setErro(""); }}
                  className="text-xs font-semibold" style={{ color: t.gold }}>
                  {L("Já tem prédio cadastrado? Fazer login")}</button>
              </div>
            </form>
          ) : !role ? (
            <>
              {!diretor && (
                <button onClick={() => { setJaCadastrado(false); setErro(""); }}
                  className="mb-3 flex items-center gap-1 text-xs" style={{ color: t.dim }}>
                  <ChevronLeft size={14} /> {L("Voltar ao cadastro")}</button>)}
              <div className="mb-3 text-sm font-semibold">{L("Entrar como")}</div>
              <div className="space-y-2">
                {Object.entries(PROFILES).map(([k, p]) => (
                  <button key={k} onClick={() => { setRole(k); setErro(""); }}
                    className="vhover flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left"
                    style={{ background: t.surface2, borderColor: t.borderSoft }}>
                    <div className="rounded-lg p-2" style={{ background: t.goldSoft }}><p.icon size={16} color={t.gold} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{L(p.label)}</div>
                      <div className="truncate text-xs" style={{ color: t.dim }}>{L(p.desc)}</div>
                    </div>
                    <ChevronRight size={16} color={t.dim} />
                  </button>))}
              </div>
            </>
          ) : (
            <>
              <button onClick={() => { setRole(null); setErro(""); }} className="mb-3 flex items-center gap-1 text-xs" style={{ color: t.dim }}>
                <ChevronLeft size={14} /> {L("Trocar perfil")}</button>
              <div className="mb-4 flex items-center gap-2">
                {React.createElement(PROFILES[role].icon, { size: 18, color: t.gold })}
                <span className="text-sm font-semibold">{L(PROFILES[role].label)}</span>
              </div>
              <form onSubmit={entrar} className="space-y-3">
                {role === "morador" ? (
                  <Field t={t} label="Nome completo"><input name="nome" required placeholder={L("Seu nome")} style={inputStyle(t)} /></Field>
                ) : (
                  <Field t={t} label="E-mail"><input name="email" type="email" required placeholder={L("voce@exemplo.com")} style={inputStyle(t)} /></Field>
                )}
                <Field t={t} label="Senha"><PasswordInput t={t} name="senha" required placeholder="••••••••" /></Field>
                {erro && <div className="text-xs" style={{ color: t.danger }}>{erro}</div>}
                {!temAcesso && <div className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.warn + "55", background: t.warn + "12", color: t.warn }}>
                  {L("Nenhum acesso de")} {L(PROFILES[role].label)} {L("foi criado ainda. Peça ao diretor para cadastrá-lo em Gerenciar Acessos.")}</div>}
                <Btn t={t} kind="primary" type="submit" disabled={verificando} className="w-full">
                  <KeyRound size={15} /> {verificando ? "Verificando conta..." : "Entrar"}</Btn>
              </form>
            </>
          )}
        </Card>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button onClick={() => setDark(!dark)} className="text-xs" style={{ color: t.dim }}>
            {L(dark ? "Tema claro" : "Tema escuro")}</button>
          <LangSel t={t} lang={lang} onLang={onLang} />
        </div>
      </div>
    </div>
  );
}

/* ══════════════ PRIMEIRO ACESSO — BANCO VAZIO ══════════════ */
function SetupCondominio({ t, role, diretor, onCriado, onSair, dark, setDark }) {
  const [salvar, saving] = useSubmit(async (f) => { const r = await criarCondominio(f); await onCriado(r.id, r.token); });
  const [planos, setPlanos] = useState([]);
  useEffect(() => { listarPlanos().then(setPlanos).catch(() => {}); }, []);
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8" style={{ background: t.bg, color: t.text, fontFamily: "'Inter',system-ui,sans-serif" }}>
      <div className="pointer-events-none fixed inset-0" style={{ background: `radial-gradient(600px 300px at 50% 0%, ${t.gold}14, transparent)` }} />
      <div className="vfade w-full max-w-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: t.goldSoft, border: `1px solid ${t.border}` }}>
            <Building2 size={24} color={t.gold} /></div>
          <h1 className="text-lg font-bold" style={{ fontFamily: "'Sora',sans-serif" }}>Bem-vindo ao CondoMaster Pro</h1>
          <p className="mt-1 text-xs" style={{ color: t.dim }}>
            {role === "diretor" ? "Nenhum condomínio cadastrado ainda. Cadastre o seu para começar do zero."
              : "O sistema ainda não foi configurado."}</p>
        </div>
        <Card t={t} className="p-5">
          {role !== "diretor" ? (
            <div className="space-y-4 text-center">
              <div className="text-sm">O condomínio ainda não foi cadastrado. Peça ao <b style={{ color: t.gold }}>Diretor</b> para entrar e concluir o primeiro acesso.</div>
              <Btn t={t} kind="soft" onClick={onSair}><ChevronLeft size={14} /> Voltar e trocar perfil</Btn>
            </div>
          ) : (
            <form onSubmit={salvar}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field t={t} label="Nome fantasia *"><input name="nome" required placeholder="Ex.: Residencial Águas Claras" style={inputStyle(t)} /></Field>
                <Field t={t} label="Razão social"><input name="razao" placeholder="Se diferente do nome" style={inputStyle(t)} /></Field>
                <Field t={t} label="CNPJ *"><input name="cnpj" required placeholder="00.000.000/0000-00" style={inputStyle(t)} /></Field>
                <Field t={t} label="Seu CPF (diretor) *"><input name="cpf" required placeholder="000.000.000-00" style={inputStyle(t)} /></Field>
                <Field t={t} label="Tipo"><select name="tipo" style={inputStyle(t)}><option>Residencial</option><option>Comercial</option><option>Misto</option></select></Field>
                <Field t={t} label="Porte"><select name="porte" style={inputStyle(t)}><option>Médio padrão</option><option>Alto padrão</option><option>Baixo padrão</option></select></Field>
              </div>
              <div className="mt-3"><Field t={t} label="Endereço completo *"><input name="endereco" required placeholder="Rua, número — Cidade/UF" style={inputStyle(t)} /></Field></div>
              <div className="mt-3"><Field t={t} label="Plano da licença *">
                <select name="plano" required style={inputStyle(t)}>
                  {(planos.length ? planos : [{ nome: "Essencial" }]).map((p) => (
                    <option key={p.nome}>{p.preco_mensal
                      ? `${p.nome} — ${USD(Number(p.preco_mensal))}/mês${p.preco_anual ? ` ou ${USD(Number(p.preco_anual))}/ano` : ""} · ${p.limite_unidades ? `até ${p.limite_unidades} unidades` : "unidades ilimitadas"}`
                      : p.nome}</option>))}
                </select></Field></div>
              <div className="mt-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.border, background: t.goldSoft, color: t.gold }}>
                Você ({diretor?.nome || "diretor"}) será registrado como diretor do condomínio. O acesso ao sistema é liberado após o pagamento da licença, no próximo passo.</div>
              <div className="mt-5 flex items-center justify-between gap-2">
                <Btn t={t} onClick={onSair}><ChevronLeft size={14} /> Sair</Btn>
                <Btn t={t} kind="primary" type="submit" disabled={saving}><Check size={15} /> {saving ? "Criando…" : "Criar condomínio e ir para o pagamento"}</Btn>
              </div>
            </form>
          )}
        </Card>
        <div className="mt-4 text-center">
          <button onClick={() => setDark(!dark)} className="text-xs" style={{ color: t.dim }}>{dark ? "Tema claro" : "Tema escuro"}</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════ DASHBOARDS POR PERFIL ══════════════ */
function Dashboard({ t, role, go }) {
  const { db } = useData();
  const S = db.stats;
  const [mesGrafico, setMesGrafico] = useState(db.mesAtualReal);
  const [mesDespesas, setMesDespesas] = useState(db.mesAtualReal);
  const [mesReceitas, setMesReceitas] = useState(db.mesAtualReal);
  const mesBR = (m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
  const selectMes = (value, onChange, mapa) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle(t), width: "auto", padding: "4px 8px", fontSize: 12 }}>
      {Object.keys(mapa).sort().reverse().map((m) => <option key={m} value={m}>{mesBR(m)}</option>)}
    </select>
  );
  const fluxoDia = db.fluxoDiarioPorMes[mesGrafico] || [];
  const despesasMes = db.despesasPorMes[mesDespesas] || [];
  const pieColors = [t.gold, t.info, t.danger, t.purple];
  const pie = (db.pieReceitasPorMes[mesReceitas] || []).map((p, i) => ({ ...p, color: pieColors[i % pieColors.length] }));
  const trendOf = (key) => {
    const f = db.fluxo; if (f.length < 2) return null;
    const a = f[f.length - 2][key], b = f[f.length - 1][key];
    return a ? Math.round(((b - a) / a) * 1000) / 10 : null;
  };
  return (
    <div className="vfade space-y-4">
      {/* cards principais — variam por perfil */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard t={t} icon={Wallet}     label="Saldo em caixa"       value={BRL(S.saldo)} />
        <StatCard t={t} icon={TrendingUp} label={`${L("Receitas de")} ${S.competencia}`}   value={BRL(S.receitaMes)} trend={trendOf("receita")} color={t.ok} />
        <StatCard t={t} icon={TrendingDown} label={`${L("Despesas de")} ${S.competencia}`} value={BRL(S.despesaMes)} trend={trendOf("despesa")} color={t.info} />
        <StatCard t={t} icon={AlertCircle} label="Inadimplência"       value={S.inadimplencia + "%"} color={t.danger} />
      </div>

      {/* ações rápidas */}
      <div className="flex flex-wrap gap-2">
        {[["Nova cobrança", QrCode, "cobrancas"], ["Novo gasto", Wallet, "financeiro"], ["Nova multa", Gavel, "multas"],
          ["Novo comunicado", Megaphone, "comunicados"], ["Novo chamado", Wrench, "chamados"]]
          .filter(([, , s]) => NAV.find((n) => n.id === s)?.roles.includes(role))
          .map(([l, Ic, s]) => (
            <Btn key={l} t={t} kind="soft" onClick={() => go(s)}><Ic size={14} /> {l}</Btn>))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card t={t} className="lg:col-span-2">
          <SectionTitle t={t} action={selectMes(mesGrafico, setMesGrafico, db.fluxoDiarioPorMes)}>
            Evolução financeira do mês — dia a dia</SectionTitle>
          <div style={{ height: 220 }}>
            <ResponsiveContainer><LineChart data={fluxoDia}>
              <CartesianGrid stroke={t.borderSoft} vertical={false} />
              <XAxis dataKey="m" tick={{ fill: t.dim, fontSize: 11 }} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={{ fill: t.dim, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => (v/1000)+"k"} />
              <RTooltip {...chartTip(t)} formatter={(v) => BRL(v)} labelFormatter={(d) => `${L("Dia")} ${d}`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line name={L("Receita")} dataKey="receita" stroke={t.gold} strokeWidth={2.5} dot={false} />
              <Line name={L("Despesa")} dataKey="despesa" stroke={t.info} strokeWidth={2} dot={false} />
            </LineChart></ResponsiveContainer>
          </div>
        </Card>
        <Card t={t}>
          <SectionTitle t={t} action={selectMes(mesReceitas, setMesReceitas, db.pieReceitasPorMes)}>
            Distribuição de receitas</SectionTitle>
          <div style={{ height: 160 }}>
            {pie.length ? (
              <ResponsiveContainer><PieChart>
                <Pie data={pie} dataKey="value" innerRadius={42} outerRadius={64} paddingAngle={3} stroke="none">
                  {pie.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie>
                <RTooltip {...chartTip(t)} formatter={(v) => v + "%"} />
              </PieChart></ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs" style={{ color: t.dim }}>
                {L("Sem receitas em")} {mesBR(mesReceitas)}</div>
            )}
          </div>
          <div className="mt-2 space-y-1 text-xs">{pie.map((e) => (
            <div key={e.name} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: e.color }} />
              <span className="flex-1" style={{ color: t.dim }}>{e.name}</span>
              <b style={{ color: e.color }}>{e.value}%</b></div>))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card t={t}>
          <SectionTitle t={t} action={selectMes(mesDespesas, setMesDespesas, db.despesasPorMes)}>
            Despesas por categoria</SectionTitle>
          <div style={{ height: 200 }}>
            {despesasMes.length ? (
              <ResponsiveContainer><BarChart data={despesasMes} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" hide /><YAxis type="category" dataKey="cat" width={90} tick={{ fill: t.dim, fontSize: 11 }} axisLine={false} tickLine={false} />
                <RTooltip {...chartTip(t)} formatter={(v) => BRL(v)} cursor={false} />
                <Bar dataKey="v" fill={t.gold} radius={[0, 6, 6, 0]} barSize={14} activeBar={false} />
              </BarChart></ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs" style={{ color: t.dim }}>
                {L("Sem despesas em")} {mesBR(mesDespesas)}</div>
            )}
          </div>
        </Card>
        <Card t={t}>
          <SectionTitle t={t}>Inadimplência ao longo do tempo</SectionTitle>
          <div style={{ height: 200 }}>
            <ResponsiveContainer><AreaChart data={db.inadim}>
              <defs><linearGradient id="gi" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={t.danger} stopOpacity={0.35} /><stop offset="100%" stopColor={t.danger} stopOpacity={0} />
              </linearGradient></defs>
              <CartesianGrid stroke={t.borderSoft} vertical={false} />
              <XAxis dataKey="m" tick={{ fill: t.dim, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: t.dim, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => v + "%"} />
              <RTooltip {...chartTip(t)} formatter={(v) => v + "%"} />
              <Area dataKey="pct" stroke={t.danger} strokeWidth={2} fill="url(#gi)" />
            </AreaChart></ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* pendências + todas as atividades recentes, tudo clicável */}
      <Card t={t}>
        <SectionTitle t={t} action={<button onClick={() => go("cobrancas")} className="text-xs" style={{ color: t.gold }}>{L("Ver todas →")}</button>}>
          {role === "diretor" ? "Aprovações pendentes" : "Alertas do dia"}</SectionTitle>
        <div className="space-y-2 text-sm">
          {(() => {
            const multaPend = db.multas.find((m) => m.status === "pendente");
            const vencidas = db.cobr.filter((c) => c.status === "vencida");
            const semResp = db.chamados.find((c) => c.status === "aberto" && c.resp === "—");
            const alertas = [
              multaPend && [Gavel, `${L("Multa")} ${multaPend.num} ${L("aguarda decisão do síndico")}`, "danger", "multas"],
              vencidas.length > 0 && [QrCode, `${vencidas.length} ${L("cobrança(s) vencida(s) somando")} ` + BRL(vencidas.reduce((s, c) => s + c.valor, 0)), "warn", "cobrancas"],
              semResp && [Wrench, `${semResp.num} (${semResp.cat.toLowerCase()}) ${L("sem responsável designado")}`, "warn", "chamados"],
            ].filter(Boolean);
            const podeVer = (s) => NAV.some((n) => n.id === s && n.roles.includes(role));
            const atividades = db.atividades.filter(([, , s]) => !s || podeVer(s));
            if (!alertas.length && !atividades.length)
              return <div className="text-xs" style={{ color: t.dim }}>Nenhuma pendência no momento. Tudo em dia! 🎉</div>;
            return (<>
              {alertas.map(([Ic, txt, c, s], i) => (
                <button key={`p${i}`} onClick={() => go(s)} className="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left"
                  style={{ borderColor: t[c] + "44", background: t[c] + "0D" }}>
                  <Ic size={15} color={t[c]} /><span className="min-w-0 flex-1 truncate text-xs">{txt}</span>
                  <ChevronRight size={14} color={t.dim} /></button>))}
              {atividades.map(([txt, ts, s], i) => (
                <button key={`a${i}`} onClick={() => s && go(s)} className="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left"
                  style={{ borderColor: t.borderSoft, background: t.surface2 }}>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.gold }} />
                  <span className="min-w-0 flex-1 truncate text-xs">{txt}</span>
                  <span className="text-[11px]" style={{ color: t.dim }}>{ts}</span>
                  <ChevronRight size={14} color={t.dim} /></button>))}
            </>);
          })()}
        </div>
      </Card>
    </div>
  );
}

/* ══════════════ CADASTRO DO CONDOMÍNIO ══════════════
   Carrega e grava os dados reais do condomínio da conta logada (escopo por
   condominio_id do token — cada diretor só vê e edita o próprio prédio). */
function Condominio({ t, role }) {
  const { db, reload } = useData();
  /* síndico enxerga o cadastro somente leitura; apenas o diretor edita */
  const somenteLeitura = role !== "diretor";
  const [tab, setTab] = useState("dados");
  const [saved, setSaved] = useState(false);
  const [cond, setCond] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const [logo, setLogo] = useState(null);
  const [subindoLogo, setSubindoLogo] = useState(false);
  const carregar = () => obterCondominio(db.ctx)
    .then((c) => { setCond(c); setLogo(c.logoUrl); setFormKey((k) => k + 1); })
    .catch((e) => alert("Não foi possível carregar o cadastro: " + (e?.message || e)));
  useEffect(() => { carregar(); }, [db.ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const [salvar, saving] = useSubmit(async (f) => {
    await salvarCondominio(db.ctx, f);
    await reload(); // aplica a cor primária (e demais dados) sem precisar sair e entrar
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  });
  const enviarLogo = async (e) => {
    const arq = e.target.files?.[0];
    if (!arq) return;
    setSubindoLogo(true);
    try { setLogo(await salvarLogoCondominio(db.ctx, arq)); }
    catch (err) { alert("Não foi possível enviar o logo: " + (err?.message || err)); }
    finally { setSubindoLogo(false); }
  };
  const removerLogo = async () => {
    if (!window.confirm(L("Excluir o logo do condomínio? O portal e os documentos voltam a usar as iniciais."))) return;
    setSubindoLogo(true);
    try { await removerLogoCondominio(db.ctx); setLogo(null); }
    catch (err) { alert("Não foi possível excluir o logo: " + (err?.message || err)); }
    finally { setSubindoLogo(false); }
  };
  const tenant = (db.tenants || []).find((x) => x.id === db.ctx.condominioId);
  /* as abas ficam sempre montadas (só escondidas) para o salvar enviar o formulário inteiro */
  const mostra = (k) => ({ display: tab === k ? undefined : "none" });
  if (!cond) return <div className="vfade max-w-3xl text-xs" style={{ color: t.dim }}>{L("Carregando cadastro do condomínio…")}</div>;
  return (
    <div className="vfade max-w-3xl space-y-4">
      <div className="flex gap-1 overflow-x-auto">
        {[["dados","Dados gerais"],["gestao","Gestão"],["regras","Regras internas"],["pagamentos","Meios de pagamento"],["visual","Identidade visual"]].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: tab===k ? t.goldSoft : "transparent", color: tab===k ? t.gold : t.dim, border: `1px solid ${tab===k ? t.border : "transparent"}` }}>{l}</button>))}
      </div>
      {somenteLeitura && (
        <div className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.borderSoft, background: t.surface2, color: t.dim }}>
          <Eye size={12} className="mr-1 inline" /> {L("Somente leitura — alterações no cadastro do condomínio são feitas pelo diretor.")}</div>
      )}
      <form onSubmit={salvar} key={formKey}>
      <Card t={t} className="p-5">
      <fieldset disabled={somenteLeitura} className="space-y-3" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className="space-y-3" style={mostra("dados")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field t={t} label="Nome fantasia"><input name="nome" required defaultValue={cond.nome} style={inputStyle(t)} /></Field>
            <Field t={t} label="Razão social"><input name="razao" defaultValue={cond.razao} style={inputStyle(t)} /></Field>
            <Field t={t} label="CNPJ"><input name="cnpj" required defaultValue={cond.cnpj} style={inputStyle(t)} /></Field>
            <Field t={t} label="Inscrição municipal"><input name="inscricao" defaultValue={cond.inscricao} placeholder="Quando houver" style={inputStyle(t)} /></Field>
            <Field t={t} label="Tipo"><select name="tipo" defaultValue={cond.tipo} style={inputStyle(t)}><option>Residencial</option><option>Comercial</option><option>Misto</option></select></Field>
            <Field t={t} label="Porte"><select name="porte" defaultValue={cond.porte} style={inputStyle(t)}><option>Alto padrão</option><option>Médio padrão</option><option>Baixo padrão</option></select></Field>
            <Field t={t} label="Torres / blocos"><input name="torres" defaultValue={cond.torres} placeholder={L("Ex.: 2 torres (A, B)")} style={inputStyle(t)} /></Field>
            <Field t={t} label="Unidades / vagas"><input name="resumo" defaultValue={cond.resumo} placeholder={L("Ex.: 96 unidades · 148 vagas")} style={inputStyle(t)} /></Field>
            <Field t={t} label="Moeda de gestão">
              <select name="moeda" defaultValue={cond.moeda} style={inputStyle(t)}>
                {[["USD","Dólar (US$)"],["BRL","Real ($)"],["EUR","Euro (€)"],["GBP","Libra (£)"],["ARS","Peso argentino ($)"],["PYG","Guarani (₲)"]].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select></Field>
          </div>
          <Field t={t} label="Endereço completo"><input name="endereco" defaultValue={cond.endereco} style={inputStyle(t)} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2" style={mostra("gestao")}>
          <Field t={t} label="Administradora responsável"><input name="administradora" defaultValue={cond.administradora} style={inputStyle(t)} /></Field>
          <Field t={t} label="Síndico atual"><input name="sindico" defaultValue={cond.sindico} style={inputStyle(t)} /></Field>
          <Field t={t} label="Diretor administrativo"><input name="diretorAdm" defaultValue={cond.diretorAdm} style={inputStyle(t)} /></Field>
          <Field t={t} label="Tesouraria"><input name="tesouraria" defaultValue={cond.tesouraria} style={inputStyle(t)} /></Field>
          <Field t={t} label="Início da gestão"><input name="inicioGestao" type="date" defaultValue={cond.inicioGestao} style={inputStyle(t)} /></Field>
          {role === "diretor" && (
          <Field t={t} label="Plano contratado (somente visualização)">
            <div className="flex h-[42px] items-center gap-2 rounded-xl border px-3 text-sm" style={{ borderColor: t.borderSoft, background: t.surface2 }}>
              {tenant ? (<>
                <b>{tenant.plano}</b>
                <Badge t={t} s={tenant.status} />
              </>) : <span style={{ color: t.dim }}>{L("Sem assinatura registrada")}</span>}
            </div>
            <div className="mt-1 text-[11px]" style={{ color: t.dim }}>{L("Definido pela assinatura da licença — o plano acompanha o pagamento feito no checkout.")}</div>
          </Field>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2" style={mostra("regras")}>
          <Field t={t} label="Horário de silêncio"><input name="silencio" defaultValue={cond.silencio} placeholder={L("Ex.: 22h — 8h")} style={inputStyle(t)} /></Field>
          <Field t={t} label="Mudanças"><input name="mudancas" defaultValue={cond.mudancas} placeholder={L("Ex.: Seg–Sáb, 8h–17h, com agendamento")} style={inputStyle(t)} /></Field>
          <Field t={t} label="Obras"><input name="obras" defaultValue={cond.obras} placeholder={L("Ex.: Seg–Sex, 8h–17h")} style={inputStyle(t)} /></Field>
          <Field t={t} label="Visitantes"><input name="visitantes" defaultValue={cond.visitantes} placeholder={L("Ex.: Pré-autorização pelo portal")} style={inputStyle(t)} /></Field>
          <Field t={t} label="Animais"><input name="animais" defaultValue={cond.animais} placeholder={L("Ex.: Permitidos com coleira nas áreas comuns")} style={inputStyle(t)} /></Field>
          <Field t={t} label="Áreas comuns"><input name="areas" defaultValue={cond.areas} placeholder={L("Ex.: Reserva com 48h de antecedência")} style={inputStyle(t)} /></Field>
        </div>
        <div className="space-y-3" style={mostra("pagamentos")}>
          <div className="text-xs font-semibold" style={{ color: t.gold, fontFamily: "'Sora',sans-serif" }}>{L("Cripto ativos")}</div>
          <Field t={t} label="Chave pública da carteira Verum Wallet">
            <input name="verumWallet" defaultValue={cond.verumWallet}
              placeholder={L("Cole aqui a chave pública (endereço de recebimento) da carteira")} style={inputStyle(t)} />
          </Field>
          <div className="text-[11px]" style={{ color: t.dim }}>
            {L("Ainda não tem uma carteira?")}{" "}
            <a href="https://verumcrypto.com" target="_blank" rel="noreferrer" style={{ color: t.gold, textDecoration: "underline" }}>Verum Wallet</a>
            {" — "}{L("clique para baixar o app e criar a sua.")}
          </div>
          <div className="pt-1 text-xs font-semibold" style={{ color: t.gold, fontFamily: "'Sora',sans-serif" }}>{L("Dinheiro")}</div>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: t.borderSoft, background: t.surface2 }}>
            <span className="text-sm">{L("Aceitar pagamento em dinheiro")}
              <span className="block text-[11px]" style={{ color: t.dim }}>{L("O morador paga presencialmente na administração do condomínio.")}</span></span>
            <input type="checkbox" name="dinheiro" defaultChecked={cond.dinheiro} className="h-4 w-4 shrink-0" style={{ accentColor: t.gold }} />
          </label>
          <div className="pt-1 text-xs font-semibold" style={{ color: t.gold, fontFamily: "'Sora',sans-serif" }}>{L("Transferência bancária")}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field t={t} label="Titular da conta"><input name="bancoTitular" defaultValue={cond.bancoTitular} placeholder={L("Nome ou razão social do condomínio")} style={inputStyle(t)} /></Field>
            <Field t={t} label="Banco"><input name="bancoNome" defaultValue={cond.bancoNome} placeholder={L("Nome da instituição financeira")} style={inputStyle(t)} /></Field>
            <Field t={t} label="País da conta"><input name="bancoPais" defaultValue={cond.bancoPais} placeholder={L("Ex.: Brasil, Estados Unidos, Paraguai…")} style={inputStyle(t)} /></Field>
            <Field t={t} label="IBAN"><input name="bancoIban" defaultValue={cond.bancoIban} placeholder={L("Conta internacional (quando houver)")} style={inputStyle(t)} /></Field>
            <Field t={t} label="SWIFT / BIC"><input name="bancoSwift" defaultValue={cond.bancoSwift} placeholder={L("Código internacional do banco")} style={inputStyle(t)} /></Field>
            <Field t={t} label="Número da conta"><input name="bancoConta" defaultValue={cond.bancoConta} placeholder={L("Conta corrente / account number")} style={inputStyle(t)} /></Field>
            <Field t={t} label="Agência / código de roteamento"><input name="bancoAgencia" defaultValue={cond.bancoAgencia} placeholder={L("Agência, routing number ou sort code")} style={inputStyle(t)} /></Field>
            <Field t={t} label="Observações"><input name="bancoObs" defaultValue={cond.bancoObs} placeholder={L("Ex.: enviar comprovante à administração")} style={inputStyle(t)} /></Field>
          </div>
          <div className="text-xs" style={{ color: t.dim }}>{L("Estes dados são exibidos ao morador como opções para pagamento das cobranças. Preencha só o que se aplica ao seu país — IBAN e SWIFT/BIC tornam a conta acessível internacionalmente.")}</div>
        </div>
        <div className="space-y-3" style={mostra("visual")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field t={t} label="Logo (upload)">
              <label className={`flex h-20 items-center justify-center gap-1.5 rounded-xl border border-dashed px-2 text-xs ${somenteLeitura ? "" : "cursor-pointer"}`}
                style={{ borderColor: logo ? t.gold : t.borderSoft, color: logo ? t.gold : t.dim }}>
                <input type="file" accept="image/*" className="hidden" disabled={somenteLeitura} onChange={enviarLogo} />
                {subindoLogo ? "Enviando…" : logo
                  ? <><img src={logo} alt="Logo do condomínio" className="max-h-16 max-w-[60%] rounded object-contain" />{!somenteLeitura && <span>Trocar logo</span>}</>
                  : somenteLeitura ? <span>{L("Sem logo cadastrado")}</span>
                  : <><Upload size={13} /> Clique para enviar (salva na hora)</>}
              </label>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px]" style={{ color: t.dim }}>
                <span>{L("Recomendado: imagem quadrada de 512×512 px (PNG com fundo transparente), até 1 MB.")}</span>
                {logo && !somenteLeitura && (
                  <button type="button" onClick={removerLogo} disabled={subindoLogo}
                    className="flex shrink-0 items-center gap-1 font-medium" style={{ color: t.danger }}>
                    <Trash2 size={12} /> {L("Excluir logo")}
                  </button>
                )}
              </div>
            </Field>
            <Field t={t} label="Cor primária do portal"><input name="cor" type="color" defaultValue={cond.cor} style={{ ...inputStyle(t), height: 42, padding: 4 }} /></Field>
          </div>
          <div className="text-xs" style={{ color: t.dim }}>A identidade acima é aplicada aos documentos timbrados e ao portal do morador.</div>
        </div>
        {!somenteLeitura && (
        <div className="flex justify-end gap-2 pt-2">
          <Btn t={t} onClick={carregar}>Descartar alterações</Btn>
          <Btn t={t} kind="primary" type="submit" disabled={saving}>
            {saved ? <><CheckCircle2 size={15} /> Salvo</> : <><Check size={15} /> {saving ? "Salvando…" : "Salvar alterações"}</>}</Btn>
        </div>)}
      </fieldset>
      </Card>
      </form>
    </div>
  );
}

/* ══════════════ UNIDADES ══════════════ */
function Unidades({ t, role }) {
  const { db, reload } = useData();
  /* só o diretor cria unidades e edita a área privativa; síndico e tesouraria
     consultam históricos e podem trocar o responsável financeiro */
  const podeCriar = role === "diretor";
  const podeEditarArea = role === "diretor";
  const [q, setQ] = useState(""); const [st, setSt] = useState("todos"); const [sel, setSel] = useState(null); const [novo, setNovo] = useState(false);
  const [salvar, saving] = useSubmit(async (f) => { await criarUnidade(db.ctx, f); await reload(); setNovo(false); });
  const areaRef = React.useRef(null);
  const [salvandoArea, setSalvandoArea] = useState(false);
  const [respSel, setRespSel] = useState("");
  const [ed, setEd] = useState({}); // campos em edição no modal (diretor: edição completa)
  const [hist, setHist] = useState(null); // histórico aberto no modal: pagamentos | multas | moradores
  const pessoasOrd = [...db.ctx.pessoas].sort((a, b) => a.nome.localeCompare(b.nome));
  const salvarUnidade = async () => {
    setSalvandoArea(true);
    try {
      if (podeEditarArea) {
        /* diretor: salva o cadastro completo da unidade de uma vez */
        await atualizarUnidade(db.ctx, sel.id, { ...ed, area: areaRef.current?.value, responsavel: respSel });
      } else if (respSel !== (sel.respId || "")) {
        await salvarResponsavelUnidade(db.ctx, sel.id, respSel);
      }
      await reload(); setSel(null);
    }
    catch (err) { alert("Não foi possível salvar: " + (err?.message || err)); }
    finally { setSalvandoArea(false); }
  };
  const [excluindo, setExcluindo] = useState(false);
  const excluir = async () => {
    if (!confirm(`${L("Excluir a unidade")} ${sel.num} — ${L("Bloco")} ${sel.bloco}? ${L("O histórico de cobranças e multas é preservado, mas a unidade sai do rateio e das listagens.")}`)) return;
    setExcluindo(true);
    try { await excluirUnidade(db.ctx, sel.id); await reload(); setSel(null); }
    catch (err) { alert(err?.message || err); }
    finally { setExcluindo(false); }
  };
  /* busca estruturada: "bloco X" filtra pelo bloco, "andar X" filtra pelo andar,
     termo que começa com número busca pelo número da unidade; o restante (tipo,
     status, responsável) busca por texto livre. Combinável: "bloco b andar 3 vaga" */
  const buscaUnidade = (u) => {
    const termos = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    for (let i = 0; i < termos.length; i++) {
      const termo = termos[i], valor = termos[i + 1];
      if (termo === "bloco" || termo === "torre") {
        if (!valor) continue; // ainda digitando o bloco — não filtra nada
        if (!String(u.bloco).toLowerCase().startsWith(valor)) return false;
        i++; continue;
      }
      if (termo === "andar") {
        if (!valor) continue; // ainda digitando o andar — não filtra nada
        if (String(u.andar ?? "").toLowerCase() !== valor) return false;
        i++; continue;
      }
      if (/^\d/.test(termo)) { // começa com dígito → número da unidade
        if (!String(u.num).toLowerCase().startsWith(termo)) return false;
        continue;
      }
      if (![u.num, u.tipo, u.tipoRaw, u.status, u.resp].join(" ").toLowerCase().includes(termo)) return false;
    }
    return true;
  };
  const rows = db.unidades.filter((u) => (st === "todos" || u.status === st) && buscaUnidade(u));
  const cols = [{k:"num",l:"Unidade"},{k:"andar",l:"Andar"},{k:"tipo",l:"Tipo"},{k:"status",l:"Status"},{k:"resp",l:"Responsável financeiro"},{k:"fracao",l:"Fração ideal"},{k:"saldo",l:"Saldo"}];
  /* franquia de unidades do plano: acima dela nada é bloqueado — o excedente
     é cobrado pelo Commet na fatura da licença (feature medida) */
  const limiteUn = db.tenants.find((x) => x.id === db.ctx.condominioId)?.limiteUnidades;
  return (
    <div className="vfade">
      {limiteUn && db.unidades.length > limiteUn && (
        <div className="mb-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.warn + "55", background: t.warn + "12", color: t.warn }}>
          <AlertCircle size={13} className="mr-1 inline" />
          {L("Acima da franquia do plano")} ({db.unidades.length} / {limiteUn} {L("unidades")}) — {L("o excedente é cobrado por unidade adicional na fatura da licença.")}</div>)}
      <Toolbar t={t} q={q} setQ={setQ} placeholder="Buscar por unidade, andar, tipo, status ou responsável…"
        action={podeCriar ? <Btn t={t} kind="primary" onClick={() => setNovo(true)}><Plus size={15} /> Unidade</Btn> : null}>
        <Sel t={t} value={st} onChange={setSt} opts={[["todos","Todos os status"],["ocupada","Ocupada"],["alugada","Alugada"],["vaga","Vaga"],["vendida","Vendida"],["reservada","Reservada"],["inativa","Inativa"]]} />
      </Toolbar>
      <Tbl t={t} cols={cols} rows={rows} onRowClick={(r) => { setSel(r); setHist(null); setRespSel(r.respId || "");
        setEd({ numero: r.num, bloco: r.bloco === "?" ? "" : r.bloco, tipo: r.tipoRaw, status: r.status, andar: r.andar ?? "" }); }}
        empty={<EmptyState t={t} icon={Home} title="Nenhuma unidade encontrada"
          hint={podeCriar ? "Ajuste a busca ou os filtros, ou cadastre a primeira unidade deste condomínio." : "Ajuste a busca ou os filtros. O cadastro de novas unidades é feito pelo diretor."}
          action={podeCriar ? <Btn t={t} kind="primary" onClick={() => setNovo(true)}><Plus size={14} /> Cadastrar unidade</Btn> : null} />}
        renderCell={(r, k) => {
          if (k === "num") return <b>{r.num} · Bloco {r.bloco}</b>;
          if (k === "andar") return r.andar ?? <span style={{ color: t.dim }}>—</span>;
          if (k === "status") return <Badge t={t} s={r.status} />;
          if (k === "fracao") return (<span>{r.fracao.toFixed(2)}%{r.area > 0 && <span style={{ color: t.dim }}> · {String(r.area).replace(".", ",")} m²</span>}</span>);
          if (k === "saldo") return <span style={{ color: r.saldo < 0 ? t.danger : t.ok }}>{r.saldo < 0 ? BRL(r.saldo) : "Em dia"}</span>;
          return r[k];
        }} />
      {sel && (
        <Modal t={t} onClose={() => setSel(null)} wide>
          <ModalHeader t={t} title={`Unidade ${sel.num} — Bloco ${sel.bloco}`} onClose={() => setSel(null)} />
          <div className="mb-3 flex flex-wrap gap-2"><Badge t={t} s={sel.status} />
            <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: t.goldSoft, color: t.gold }}>{sel.tipo}</span>
            <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: t.surface2, color: t.dim }}>{sel.vagas} vaga(s)</span></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {podeEditarArea && (<>
              <Field t={t} label="Número"><input value={ed.numero || ""} onChange={(e) => setEd({ ...ed, numero: e.target.value })} style={inputStyle(t)} /></Field>
              <Field t={t} label="Bloco / torre"><input value={ed.bloco || ""} onChange={(e) => setEd({ ...ed, bloco: e.target.value })} placeholder="Ex.: B" style={inputStyle(t)} /></Field>
              <Field t={t} label="Tipo">
                <select value={ed.tipo || "apartamento"} onChange={(e) => setEd({ ...ed, tipo: e.target.value })} style={inputStyle(t)}>
                  {[["apartamento","Apartamento"],["sala","Sala comercial"],["loja","Loja"],["cobertura","Cobertura"],["box","Box"],["deposito","Depósito"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></Field>
              <Field t={t} label="Status">
                <select value={ed.status || "vaga"} onChange={(e) => setEd({ ...ed, status: e.target.value })} style={inputStyle(t)}>
                  {[["ocupada","Ocupada"],["vaga","Vaga"],["alugada","Alugada"],["vendida","Vendida"],["reservada","Reservada"],["inativa","Inativa"]].map(([v, l]) => <option key={v} value={v}>{L(l)}</option>)}
                </select></Field>
              <Field t={t} label="Andar"><input type="number" value={ed.andar} onChange={(e) => setEd({ ...ed, andar: e.target.value })} style={inputStyle(t)} /></Field>
            </>)}
            <Field t={t} label="Responsável financeiro">
              <select value={respSel} onChange={(e) => setRespSel(e.target.value)} style={inputStyle(t)}>
                <option value="">{L("— sem responsável —")}</option>
                {pessoasOrd.map((p) => <option key={p.id} value={p.id}>{p.label || p.nome}</option>)}
              </select></Field>
            <Field t={t} label="Fração ideal (calculada)"><input readOnly value={`${sel.fracao.toFixed(4).replace(".", ",")}%`} title={L("Área privativa da unidade ÷ área total do edifício")} style={{ ...inputStyle(t), opacity: 0.7 }} /></Field>
            <Field t={t} label="Área privativa (m²)">
              {podeEditarArea
                ? <AreaInput t={t} key={sel.id} inputRef={areaRef} defaultValue={sel.area || ""} />
                : <input readOnly value={sel.area ? String(sel.area).replace(".", ",") : "—"} title={L("Somente o diretor pode alterar a área privativa")} style={{ ...inputStyle(t), opacity: 0.7 }} />}
            </Field>
            <Field t={t} label="Vagas vinculadas"><input readOnly value={sel.vagas} style={{ ...inputStyle(t), opacity: 0.7 }} /></Field>
          </div>
          <div className="mt-2 text-xs" style={{ color: t.dim }}>
            {podeEditarArea
              ? L("Alterar a área privativa recalcula a fração ideal de todas as unidades — é ela que define a proporção de cada unidade no rateio das despesas comuns.")
              : L("A área privativa define a fração ideal do rateio e só pode ser alterada pelo diretor. O responsável financeiro pode ser alterado acima.")}</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[["pagamentos", "Histórico de pagamentos", Wallet], ["multas", "Histórico de multas", Gavel], ["moradores", "Moradores autorizados", Users]].map(([k, l, Ic]) => (
              <button key={k} onClick={() => setHist(hist === k ? null : k)}
                className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs"
                style={{ borderColor: hist === k ? t.gold : t.borderSoft, background: hist === k ? t.goldSoft : t.surface2, color: hist === k ? t.gold : t.text }}>
                <Ic size={14} color={t.gold} /> {l}</button>))}
          </div>
          {hist && (() => {
            const vazio = (msg) => (
              <div className="mt-3 rounded-xl border border-dashed px-4 py-5 text-center text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
                <AlertCircle size={16} className="mx-auto mb-1.5" color={t.dim} /> {L("Nada consta")} — {msg}</div>);
            const linha = (key, children) => (
              <div key={key} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.borderSoft }}>{children}</div>);
            if (hist === "pagamentos") {
              const itens = db.cobr.filter((c) => c.unidadeId === sel.id);
              return itens.length === 0 ? vazio(L("nenhuma cobrança registrada para esta unidade.")) : (
                <div className="mt-3 space-y-1.5">{itens.map((c) => linha(c.id, <>
                  <b>{c.comp}</b><span style={{ color: t.dim }}>{L("venc.")} {c.vencFull}</span>
                  <span className="ml-auto font-semibold">{BRL(c.valor)}</span><Badge t={t} s={c.status} /></>))}</div>);
            }
            if (hist === "multas") {
              const itens = db.multas.filter((m) => m.unidadeId === sel.id);
              return itens.length === 0 ? vazio(L("nenhuma multa ou advertência para esta unidade.")) : (
                <div className="mt-3 space-y-1.5">{itens.map((m) => linha(m.id, <>
                  <b>Nº {m.num}</b><span>{m.categoria}</span><span style={{ color: t.dim }}>{m.data}</span>
                  <span className="ml-auto font-semibold">{m.valor > 0 ? BRL(m.valor) : L("advertência")}</span><Badge t={t} s={m.status} /></>))}</div>);
            }
            const itens = db.pessoas.filter((p) => p.unidadeId === sel.id);
            return itens.length === 0 ? vazio(L("nenhum morador ou responsável vinculado a esta unidade.")) : (
              <div className="mt-3 space-y-1.5">{itens.map((p) => linha(p.id, <>
                <b>{p.nome}</b>
                <span className="rounded-full px-2 py-0.5" style={{ background: t.surface2, color: t.text }}>{p.papel}</span>
                <span className="ml-auto" style={{ color: t.dim }}>{p.tel !== "—" ? p.tel : ""}</span></>))}</div>);
          })()}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {podeCriar && <Btn t={t} kind="danger" disabled={excluindo || salvandoArea} onClick={excluir} className="mr-auto"><Trash2 size={14} /> {excluindo ? "Excluindo…" : "Excluir"}</Btn>}
            <Btn t={t} onClick={() => setSel(null)}>Fechar</Btn>
            <Btn t={t} kind="primary" disabled={salvandoArea || excluindo} onClick={salvarUnidade}><Check size={14} /> {salvandoArea ? "Salvando…" : "Salvar alterações"}</Btn></div>
        </Modal>)}
      {novo && podeCriar && (
        <Modal t={t} onClose={() => setNovo(false)} wide>
          <ModalHeader t={t} title="Nova unidade" onClose={() => setNovo(false)} />
          <form onSubmit={salvar}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field t={t} label="Tipo"><select name="tipo" style={inputStyle(t)}>{["Apartamento","Sala comercial","Loja","Cobertura","Box","Depósito"].map((x)=><option key={x}>{x}</option>)}</select></Field>
              <Field t={t} label="Bloco / torre (opcional)"><input name="bloco" placeholder={L("Ex.: B — vazio usa o bloco A")} style={inputStyle(t)} /></Field>
              <Field t={t} label="Número (ou início do intervalo)"><input name="numero" required placeholder={L("Ex.: 402, 1 ou 1D")} style={inputStyle(t)} /></Field>
              <Field t={t} label="Até o número (opcional)"><input name="numeroAte" placeholder={L("Ex.: 100 ou 4D — vazio cria só uma")} style={inputStyle(t)} /></Field>
              <Field t={t} label="Andar (ou início do intervalo)"><input name="andar" type="number" placeholder={L("Ex.: 1")} style={inputStyle(t)} /></Field>
              <Field t={t} label="Até o andar (opcional)"><input name="andarAte" type="number" placeholder={L("Ex.: 12 — vazio usa um só andar")} style={inputStyle(t)} /></Field>
              <Field t={t} label="Status"><select name="status" style={inputStyle(t)}>{["Ocupada","Vaga","Alugada","Vendida","Reservada","Inativa"].map((x)=><option key={x}>{x}</option>)}</select></Field>
              <Field t={t} label="Área privativa (m²)"><AreaInput t={t} name="area" /></Field>
            </div>
            <div className="mt-3 text-xs" style={{ color: t.dim }}>
              {L("A fração ideal é calculada automaticamente: área privativa da unidade ÷ área total do edifício. Ela define a proporção de cada unidade no rateio das despesas comuns e é refeita para o prédio inteiro a cada unidade criada ou alterada.")}</div>
            <div className="mt-3 text-xs" style={{ color: t.dim }}>
              {L("Preencha \"Até o número\" para criar várias unidades de uma vez: 1 até 100 cria 1, 2… 100; 1D até 4D cria 1D, 2D, 3D e 4D. Números que já existem no bloco são pulados. Tipo, status e área valem para todas.")}</div>
            <div className="mt-1 text-xs" style={{ color: t.dim }}>
              {L("Preencha também \"Até o andar\" para criar por andares: andares 1 até 12 com unidades 1 até 4 criam 101–104, 201–204 … 1201–1204 — o andar de cada unidade é preenchido automaticamente.")}</div>
            <div className="mt-1 text-xs" style={{ color: t.dim }}>O responsável financeiro é vinculado depois, na tela Pessoas (papel proprietário/inquilino).</div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setNovo(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={saving}><Check size={14} /> {saving ? "Salvando…" : "Criar unidade"}</Btn></div>
          </form>
        </Modal>)}
    </div>
  );
}

/* ══════════════ PESSOAS ══════════════ */
function Pessoas({ t }) {
  const { db, reload } = useData();
  const [q, setQ] = useState(""); const [papel, setPapel] = useState("todos"); const [novo, setNovo] = useState(false);
  const [edit, setEdit] = useState(null); // pessoa em edição — reutiliza o mesmo popup de criar
  const fechar = () => { setNovo(false); setEdit(null); };
  const [salvar, saving] = useSubmit(async (f) => {
    if (edit) await atualizarPessoa(db.ctx, edit, f); else await criarPessoa(db.ctx, f);
    await reload(); fechar();
  });
  const [excluindo, setExcluindo] = useState(false);
  const excluir = async () => {
    if (!confirm(`${L("Excluir o cadastro de")} ${edit.nome}? ${L("Esta ação não pode ser desfeita.")}`)) return;
    setExcluindo(true);
    try { await removerPessoa(db.ctx, edit.id); await reload(); fechar(); }
    catch (err) { alert(err?.message || err); }
    finally { setExcluindo(false); }
  };
  const papeis = ["Proprietário","Inquilino","Morador","Dependente","Síndico","Tesouraria","Funcionário","Prestador","Visitante recorrente"];
  const rows = db.pessoas.filter((p) => (papel === "todos" || p.papel === papel) && p.nome.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="vfade">
      <Toolbar t={t} q={q} setQ={setQ} placeholder="Buscar por nome…"
        action={<Btn t={t} kind="primary" onClick={() => setNovo(true)}><Plus size={15} /> Pessoa</Btn>}>
        <Sel t={t} value={papel} onChange={setPapel} opts={[["todos","Todos os papéis"], ...papeis.map((p) => [p, p])]} />
      </Toolbar>
      <Tbl t={t} cols={[{k:"nome",l:"Nome"},{k:"papel",l:"Papel"},{k:"unidade",l:"Unidade"},{k:"doc",l:"Identificação (CI)"},{k:"tel",l:"Telefone"},{k:"arquivo",l:"Documento"},{k:"status",l:"Status"}]}
        rows={rows} onRowClick={setEdit}
        empty={<EmptyState t={t} icon={Users} title="Nenhuma pessoa encontrada"
          hint="Cadastre proprietários, inquilinos, funcionários e prestadores com papéis separados para evitar confusão operacional." />}
        renderCell={(r, k) => {
          if (k === "nome") return (<span className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold" style={{ background: t.goldSoft, color: t.gold }}>{r.nome[0]}</span><b>{r.nome}</b></span>);
          if (k === "papel") return <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: t.surface2, color: t.text }}>{r.papel}</span>;
          if (k === "arquivo") return r.documentoUrl
            ? (<a href={r.documentoUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: t.gold }}>
                <Eye size={13} /> Ver documento</a>)
            : "—";
          if (k === "status") return <Badge t={t} s={r.status} />;
          return r[k];
        }} />
      {(novo || edit) && (
        <Modal t={t} onClose={fechar} wide>
          <ModalHeader t={t} title={edit ? "Editar pessoa" : "Nova pessoa"} onClose={fechar} />
          <form onSubmit={salvar} key={edit?.id || "nova"}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field t={t} label="Nome completo"><input name="nome" required defaultValue={edit?.nome || ""} style={inputStyle(t)} /></Field>
              <Field t={t} label="Carteira de identificação (CI)"><input name="doc" required defaultValue={edit?.docRaw || ""} placeholder={L("RG, CPF ou CI")} style={inputStyle(t)} /></Field>
              <Field t={t} label="Papel no condomínio"><select name="papel" defaultValue={papeis.includes(edit?.papel) ? edit.papel : "Morador"} style={inputStyle(t)}>{papeis.map((p)=><option key={p}>{p}</option>)}</select></Field>
              <Field t={t} label="Unidade vinculada"><select name="unidade" defaultValue={edit?.unidadeId || ""} style={inputStyle(t)}><option value="">—</option>{db.ctx.unidades.map((u)=><option key={u.id} value={u.id}>{u.labelResp}</option>)}</select></Field>
              <Field t={t} label="Telefone"><input name="tel" defaultValue={edit?.telRaw || ""} style={inputStyle(t)} /></Field>
              <Field t={t} label="E-mail"><input name="email" type="email" defaultValue={edit?.email || ""} style={inputStyle(t)} /></Field>
              <Field t={t} label="Data de entrada"><input name="inicio" type="date" defaultValue={edit?.inicio || ""} style={inputStyle(t)} /></Field>
              <Field t={t} label="Documento (upload)"><FileField t={t} name="arquivo" accept="image/*,application/pdf"
                hint={edit?.documentoUrl ? L("Trocar documento (mantém o atual se vazio)") : "Anexar arquivo"} /></Field>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {edit && <Btn t={t} kind="danger" disabled={excluindo || saving} onClick={excluir} className="mr-auto"><Trash2 size={14} /> {excluindo ? "Excluindo…" : "Excluir"}</Btn>}
              <Btn t={t} onClick={fechar}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={saving || excluindo}><Check size={14} /> {saving ? "Salvando…" : edit ? "Salvar alterações" : "Cadastrar"}</Btn></div>
          </form>
        </Modal>)}
    </div>
  );
}

/* ══════════════ FINANCEIRO ══════════════ */
function Financeiro({ t }) {
  const { db, reload } = useData();
  const S = db.stats;
  const [tab, setTab] = useState("lanc"); const [q, setQ] = useState(""); const [novo, setNovo] = useState(false);
  const [tipoNovo, setTipoNovo] = useState("Despesa");
  const CATS_DESPESA = ["Água","Luz","Gás","Limpeza","Portaria","Vigilância","Administração","Manutenção","Obras","Jardinagem","Seguro","Internet","Elevadores","Impostos","Honorários","Emergência","Outros"];
  const CATS_RECEITA = ["Parcela condomínio","Fundo de reserva","Fundo de obras","Taxa extra","Multas e advertências","Aluguel de espaço comum","Rendimentos financeiros","Outros"];
  const catsDoTipo = (tipo) => {
    const t2 = tipo === "Receita" ? "receita" : "despesa";
    return [...new Set([
      ...db.ctx.categorias.filter((c) => c.tipo === t2).map((c) => c.nome),
      ...(t2 === "receita" ? CATS_RECEITA : CATS_DESPESA),
    ])];
  };
  const [salvar, saving] = useSubmit(async (f) => { await criarLancamento(db.ctx, f); await reload(); setNovo(false); });
  const rows = db.lanc.filter((l) => (l.desc + l.cat).toLowerCase().includes(q.toLowerCase()));
  /* dados das demais abas — tudo já escopado pelo condomínio da sessão */
  const [baixando, setBaixando] = useState(null);
  const darBaixa = async (id) => {
    setBaixando(id);
    try { await marcarLancamentoPago(db.ctx, id); await reload(); }
    catch (err) { alert("Não foi possível dar baixa: " + (err?.message || err)); }
    finally { setBaixando(null); }
  };
  const receitas = db.lanc.filter((l) => l.tipo === "receita");
  /* aprovação: lançamento nasce "aguardando" e só vira conta a pagar depois de aprovado */
  const aAprovar = db.lanc.filter((l) => l.status === "aguardando");
  const [decidindo, setDecidindo] = useState(null);
  const decidirLanc = async (id, aprovar) => {
    setDecidindo(id);
    try { await decidirLancamento(db.ctx, id, aprovar); await reload(); }
    catch (err) { alert("Não foi possível salvar: " + (err?.message || err)); }
    finally { setDecidindo(null); }
  };
  const aPagar = db.lanc.filter((l) => l.tipo === "despesa" && l.status === "aberto");
  const pagas = db.lanc.filter((l) => l.tipo === "despesa" && l.status === "pago");
  const aReceber = db.cobr.filter((c) => c.status === "emitida" || c.status === "vencida");
  const compAtual = new Date().toISOString().slice(0, 7);
  const despComp = db.lanc.filter((l) => l.tipo === "despesa" && l.competencia === compAtual && l.status !== "cancelado")
    .reduce((s, l) => s + l.valor, 0);
  const somaFracao = db.ctx.unidades.reduce((s, u) => s + (u.fracao || 0), 0) || 1;
  const exportarLanc = () => {
    if (!rows.length) { alert(L("Nada para exportar — nenhum lançamento na lista.")); return; }
    const cab = ["Data","Tipo","Categoria","Descrição","Valor","NF","Status"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const linhas = rows.map((r) => [r.data, r.tipo === "receita" ? "Receita" : "Despesa", r.cat, r.desc,
      (r.tipo === "receita" ? "" : "-") + String(r.valor).replace(".", ","), r.nf || "", r.status].map(esc).join(";"));
    const csv = [cab.map(esc).join(";"), ...linhas].join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `lancamentos-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const [uniExtrato, setUniExtrato] = useState("");
  const extrato = uniExtrato ? db.cobr.filter((c) => c.unidadeId === uniExtrato) : [];
  return (
    <div className="vfade space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard t={t} icon={TrendingUp}  label={`A receber (${S.competencia})`} value={BRL(S.aReceber)} color={t.ok} />
        <StatCard t={t} icon={TrendingDown} label={`A pagar (${S.competencia})`}  value={BRL(S.aPagar)}  color={t.warn} />
        <StatCard t={t} icon={Wallet} label="Fundo de reserva" value={BRL(S.fundoReserva)} />
        <StatCard t={t} icon={Wallet} label="Fundo de obras"   value={BRL(S.fundoObras)} color={t.info} />
      </div>
      {aAprovar.length > 0 && tab !== "aprovar" && (
        <button type="button" onClick={() => setTab("aprovar")} className="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs"
          style={{ borderColor: t.warn + "55", background: t.warn + "12", color: t.warn }}>
          <AlertCircle size={14} className="shrink-0" />
          <span className="flex-1">{aAprovar.length} {L("lançamento(s) aguardando aprovação — toque para revisar e aprovar.")}</span>
          <ChevronRight size={14} />
        </button>)}
      <div className="flex gap-1 overflow-x-auto">
        {[["lanc","Lançamentos"],["aprovar","Aprovação"],["receitas","Receitas"],["pagar","Contas a pagar"],["pagas","Contas pagas"],["receber","Contas a receber"],["rateio","Rateio"],["extrato","Extrato por unidade"]].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)} className="relative whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: tab===k ? t.goldSoft : "transparent", color: tab===k ? t.gold : t.dim, border: `1px solid ${tab===k ? t.border : "transparent"}` }}>{l}
            {k === "aprovar" && aAprovar.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold"
                style={{ background: t.warn, color: "#fff" }}>{aAprovar.length}</span>)}
          </button>))}
      </div>
      {tab === "lanc" ? (<>
        <Toolbar t={t} q={q} setQ={setQ} placeholder="Buscar lançamento…"
          action={<><Btn t={t} onClick={exportarLanc}><Download size={14} /> Exportar</Btn><Btn t={t} kind="primary" onClick={() => setNovo(true)}><Plus size={15} /> Lançamento</Btn></>} />
        <Tbl t={t} cols={[{k:"data",l:"Data"},{k:"tipo",l:"Tipo"},{k:"cat",l:"Categoria"},{k:"desc",l:"Descrição"},{k:"valor",l:"Valor"},{k:"nf",l:"NF"},{k:"status",l:"Status"}]}
          rows={rows}
          empty={<EmptyState t={t} icon={Wallet} title="Nenhum lançamento neste período"
            hint="Registre a primeira receita ou despesa da competência para começar a acompanhar o caixa." />}
          renderCell={(r, k) => {
            if (k === "tipo") return <span style={{ color: r.tipo === "receita" ? t.ok : t.info }}>{r.tipo === "receita" ? "Receita" : "Despesa"}</span>;
            if (k === "valor") return <b style={{ color: r.tipo === "receita" ? t.ok : t.text }}>{r.tipo === "receita" ? "+" : "−"}{BRL(r.valor)}</b>;
            if (k === "nf") return r.nf
              ? (<a href={r.nf} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: t.gold }}>
                  <FileText size={13} /> Ver NF</a>)
              : "—";
            if (k === "status") return <Badge t={t} s={r.status} />;
            return r[k];
          }} />
      </>) : tab === "aprovar" ? (<>
        <div className="text-xs" style={{ color: t.dim }}>
          {L("Todo lançamento entra como \"Aguardando\" e precisa ser aprovado para valer no caixa — despesa aprovada vai para Contas a pagar; rejeitado é cancelado.")}</div>
        <Tbl t={t} cols={[{k:"data",l:"Data"},{k:"tipo",l:"Tipo"},{k:"cat",l:"Categoria"},{k:"desc",l:"Descrição"},{k:"valor",l:"Valor"},{k:"nf",l:"NF"},{k:"acao",l:""}]}
          rows={aAprovar}
          empty={<EmptyState t={t} icon={CheckCircle2} title="Nada consta — nenhum lançamento aguardando aprovação"
            hint="Novos lançamentos criados na aba Lançamentos aparecem aqui para revisão." />}
          renderCell={(r, k) => {
            if (k === "tipo") return <span style={{ color: r.tipo === "receita" ? t.ok : t.info }}>{r.tipo === "receita" ? "Receita" : "Despesa"}</span>;
            if (k === "valor") return <b style={{ color: r.tipo === "receita" ? t.ok : t.text }}>{r.tipo === "receita" ? "+" : "−"}{BRL(r.valor)}</b>;
            if (k === "nf") return r.nf
              ? (<a href={r.nf} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: t.gold }}>
                  <FileText size={13} /> Ver NF</a>)
              : "—";
            if (k === "acao") return (
              <div className="flex justify-end gap-1.5">
                <Btn t={t} kind="danger" disabled={decidindo === r.id} onClick={(e) => { e.stopPropagation(); decidirLanc(r.id, false); }}>
                  <Ban size={13} /> Rejeitar</Btn>
                <Btn t={t} kind="primary" disabled={decidindo === r.id} onClick={(e) => { e.stopPropagation(); decidirLanc(r.id, true); }}>
                  <Check size={13} /> {decidindo === r.id ? "Salvando…" : "Aprovar"}</Btn>
              </div>);
            return r[k];
          }} />
      </>) : tab === "receitas" ? (<>
        <div className="text-xs" style={{ color: t.dim }}>
          {L("Receitas lançadas no financeiro (parcelas, fundos, taxas extras, multas e outras entradas).")} {L("Total:")} <b style={{ color: t.ok }}>{BRL(receitas.reduce((s, l) => s + l.valor, 0))}</b></div>
        <Tbl t={t} cols={[{k:"data",l:"Data"},{k:"cat",l:"Categoria"},{k:"desc",l:"Descrição"},{k:"valor",l:"Valor"},{k:"nf",l:"NF"},{k:"status",l:"Status"}]}
          rows={receitas}
          empty={<EmptyState t={t} icon={TrendingUp} title="Nenhuma receita lançada ainda"
            hint="Registre uma receita pelo botão Lançamento na aba Lançamentos — ela aparece aqui." />}
          renderCell={(r, k) => {
            if (k === "valor") return <b style={{ color: t.ok }}>+{BRL(r.valor)}</b>;
            if (k === "nf") return r.nf
              ? (<a href={r.nf} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: t.gold }}>
                  <FileText size={13} /> Ver NF</a>)
              : "—";
            if (k === "status") return <Badge t={t} s={r.status} />;
            return r[k];
          }} />
      </>) : tab === "pagar" ? (<>
        <div className="text-xs" style={{ color: t.dim }}>
          {L("Despesas lançadas e ainda não pagas.")} {L("Total em aberto:")} <b style={{ color: t.text }}>{BRL(aPagar.reduce((s, l) => s + l.valor, 0))}</b></div>
        <Tbl t={t} cols={[{k:"data",l:"Data"},{k:"cat",l:"Categoria"},{k:"desc",l:"Descrição"},{k:"valor",l:"Valor"},{k:"status",l:"Status"},{k:"acao",l:""}]}
          rows={aPagar}
          empty={<EmptyState t={t} icon={CheckCircle2} title="Nada consta — nenhuma conta a pagar"
            hint="Todas as despesas lançadas já foram pagas. Novas despesas aparecem aqui até receberem baixa." />}
          renderCell={(r, k) => {
            if (k === "valor") return <b>{BRL(r.valor)}</b>;
            if (k === "status") return <Badge t={t} s={r.status} />;
            if (k === "acao") return (
              <Btn t={t} kind="soft" disabled={baixando === r.id} onClick={(e) => { e.stopPropagation(); darBaixa(r.id); }}>
                <Check size={13} /> {baixando === r.id ? "Baixando…" : "Marcar pago"}</Btn>);
            return r[k];
          }} />
      </>) : tab === "pagas" ? (<>
        <div className="text-xs" style={{ color: t.dim }}>
          {L("Despesas que já receberam baixa de pagamento.")} {L("Total pago:")} <b style={{ color: t.text }}>{BRL(pagas.reduce((s, l) => s + l.valor, 0))}</b></div>
        <Tbl t={t} cols={[{k:"data",l:"Data"},{k:"cat",l:"Categoria"},{k:"desc",l:"Descrição"},{k:"valor",l:"Valor"},{k:"nf",l:"NF"},{k:"status",l:"Status"}]}
          rows={pagas}
          empty={<EmptyState t={t} icon={Wallet} title="Nenhuma conta paga ainda"
            hint="Quando uma despesa receber baixa na aba Contas a pagar, ela aparece aqui." />}
          renderCell={(r, k) => {
            if (k === "valor") return <b>{BRL(r.valor)}</b>;
            if (k === "nf") return r.nf
              ? (<a href={r.nf} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: t.gold }}>
                  <FileText size={13} /> Ver NF</a>)
              : "—";
            if (k === "status") return <Badge t={t} s={r.status} />;
            return r[k];
          }} />
      </>) : tab === "receber" ? (<>
        <div className="text-xs" style={{ color: t.dim }}>
          {L("Cobranças emitidas e ainda não pagas pelas unidades.")} {L("Total em aberto:")} <b style={{ color: t.text }}>{BRL(aReceber.reduce((s, c) => s + c.valor, 0))}</b></div>
        <Tbl t={t} cols={[{k:"comp",l:"Competência"},{k:"unidade",l:"Unidade"},{k:"resp",l:"Responsável"},{k:"valor",l:"Valor"},{k:"vencFull",l:"Vencimento"},{k:"status",l:"Status"}]}
          rows={aReceber}
          empty={<EmptyState t={t} icon={CheckCircle2} title="Nada consta — nenhuma cobrança em aberto"
            hint="Todas as cobranças emitidas foram pagas. Gere novas cobranças na tela Cobranças QR." />}
          renderCell={(r, k) => {
            if (k === "valor") return <b>{BRL(r.valor)}</b>;
            if (k === "status") return <Badge t={t} s={r.status} />;
            return r[k];
          }} />
      </>) : tab === "rateio" ? (<>
        <div className="text-xs" style={{ color: t.dim }}>
          {L("Proporção de cada unidade nas despesas comuns, pela fração ideal (área privativa ÷ área total).")}{" "}
          {L("Despesas da competência atual:")} <b style={{ color: t.text }}>{BRL(despComp)}</b>. {L("A emissão das cobranças é feita na tela Cobranças QR.")}</div>
        {despComp === 0 && (
          <div className="rounded-xl border border-dashed px-4 py-3 text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
            <AlertCircle size={14} className="mr-1.5 inline" /> {L("Nada consta — nenhuma despesa lançada nesta competência; as cotas abaixo estão zeradas.")}</div>)}
        <Tbl t={t} cols={[{k:"label",l:"Unidade"},{k:"andar",l:"Andar"},{k:"fracao",l:"Fração ideal"},{k:"cota",l:"Cota da competência"}]}
          rows={db.ctx.unidades}
          empty={<EmptyState t={t} icon={Home} title="Nenhuma unidade cadastrada"
            hint="Cadastre as unidades para calcular o rateio pela fração ideal." />}
          renderCell={(r, k) => {
            if (k === "andar") return r.andar ?? <span style={{ color: t.dim }}>—</span>;
            if (k === "fracao") return `${(r.fracao || 0).toFixed(4).replace(".", ",")}%`;
            if (k === "cota") return <b>{BRL(despComp * (r.fracao || 0) / somaFracao)}</b>;
            return r[k];
          }} />
      </>) : (<>
        <div className="flex flex-wrap items-center gap-2">
          <Sel t={t} value={uniExtrato} onChange={setUniExtrato}
            opts={[["", L("Escolha a unidade…")], ...db.ctx.unidades.map((u) => [u.id, u.labelResp])]} />
          {uniExtrato && (
            <div className="text-xs" style={{ color: t.dim }}>
              {L("Pago:")} <b style={{ color: t.ok }}>{BRL(extrato.filter((c) => c.status === "pago").reduce((s, c) => s + c.valor, 0))}</b>{" · "}
              {L("Em aberto:")} <b style={{ color: t.warn }}>{BRL(extrato.filter((c) => c.status === "emitida" || c.status === "vencida").reduce((s, c) => s + c.valor, 0))}</b></div>)}
        </div>
        {!uniExtrato ? (
          <EmptyState t={t} icon={Search} title="Escolha uma unidade"
            hint="Selecione a unidade acima para ver todas as cobranças dela: pagas, em aberto e vencidas." />
        ) : (
          <Tbl t={t} cols={[{k:"comp",l:"Competência"},{k:"valor",l:"Valor"},{k:"vencFull",l:"Vencimento"},{k:"status",l:"Status"},{k:"tx",l:"Transação"}]}
            rows={extrato}
            empty={<EmptyState t={t} icon={FileText} title="Nada consta para esta unidade"
              hint="Nenhuma cobrança foi emitida para esta unidade até agora." />}
            renderCell={(r, k) => {
              if (k === "valor") return <b>{BRL(r.valor)}</b>;
              if (k === "status") return <Badge t={t} s={r.status} />;
              return r[k];
            }} />)}
      </>)}
      {novo && (
        <Modal t={t} onClose={() => setNovo(false)} wide>
          <ModalHeader t={t} title="Novo lançamento" onClose={() => setNovo(false)} />
          <form onSubmit={salvar}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field t={t} label="Tipo"><select name="tipo" value={tipoNovo} onChange={(e) => setTipoNovo(e.target.value)} style={inputStyle(t)}><option>Despesa</option><option>Receita</option></select></Field>
              <Field t={t} label="Valor ($)"><input name="valor" required placeholder="0,00" style={inputStyle(t)} /></Field>
              <Field t={t} label="Categoria"><select name="categoria" key={tipoNovo} style={inputStyle(t)}>{catsDoTipo(tipoNovo).map((c)=><option key={c}>{c}</option>)}</select></Field>
              <Field t={t} label="Subcategoria / centro de custo"><input name="centro" style={inputStyle(t)} /></Field>
              <Field t={t} label="Data"><input name="data" type="date" style={inputStyle(t)} /></Field>
              <Field t={t} label="Competência"><input name="competencia" type="month" style={inputStyle(t)} /></Field>
              <Field t={t} label="Forma de pagamento"><select name="forma" style={inputStyle(t)}><option>QR Verum Pay</option><option>Transferência</option><option>Débito automático</option><option>Dinheiro</option></select></Field>
              <Field t={t} label="Rateio"><select style={inputStyle(t)}><option>Não ratear</option><option>Por fração ideal</option><option>Igual por unidade</option><option>Por bloco/torre</option></select></Field>
            </div>
            <Field t={t} label="Descrição"><input name="desc" required style={{ ...inputStyle(t), marginTop: 4 }} /></Field>
            <div className="mt-3"><Field t={t} label="Nota fiscal (anexo)"><FileField t={t} name="nota" accept="image/*,application/pdf" height={56} hint="Clique para anexar a NF (imagem ou PDF)" /></Field></div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setNovo(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={saving}><Check size={14} /> {saving ? "Salvando…" : "Lançar e enviar para aprovação"}</Btn></div>
          </form>
        </Modal>)}
    </div>
  );
}

/* ══════════════ COBRANÇAS QR ══════════════ */
function Cobrancas({ t }) {
  const { db, reload } = useData();
  const S = db.stats;
  const [q, setQ] = useState(""); const [st, setSt] = useState("todos"); const [qr, setQr] = useState(null); const [nova, setNova] = useState(false);
  const [destino, setDestino] = useState(""); // "" = rateio para todas; senão, id da unidade
  const [base, setBase] = useState("fracao"); // fracao (proporcional à área) | igual (partes iguais)
  const moeda = db.cond?.moeda || "USD"; // moeda de gestão definida no Cadastro do Condomínio (padrão: dólar)
  const [moradores, setMoradores] = useState([]);
  useEffect(() => {
    listarAcessos(db.ctx).then((a) => setMoradores(a.filter((x) => x.role === "morador"))).catch(() => {});
  }, [db.ctx]);
  const moradorDa = (label) => moradores.find((m) => m.unidade === label)?.nome;
  const [gerar, gerando] = useSubmit(async (f) => {
    if (f.unidade) f.moradorNome = moradorDa(db.ctx.unidades.find((x) => x.id === f.unidade)?.label) || "";
    await gerarCobrancas(db.ctx, f); await reload(); setNova(false); setDestino("");
  });
  const rows = db.cobr.filter((c) => (st === "todos" || c.status === st) && (c.unidade + c.resp).toLowerCase().includes(q.toLowerCase()));
  /* envio por WhatsApp: usa o telefone do responsável (ou de alguém vinculado à unidade) */
  const telDe = (c) => {
    const p = db.pessoas.find((x) => x.id === c.respId && x.telRaw)
      || db.pessoas.find((x) => x.unidadeId === c.unidadeId && x.telRaw);
    const tel = (p?.telRaw || "").replace(/\D/g, "");
    return tel && tel.length <= 11 ? `55${tel}` : tel; // sem DDI, assume Brasil
  };
  const enviarWhats = (c) => {
    const msg = `Olá${c.resp && c.resp !== "—" ? `, ${c.resp}` : ""}! ${L("Cobrança do condomínio")} ${db.cond?.nome || ""} — ${L("competência")} ${c.comp}, ${L("valor")} ${BRL(c.valor)}, ${L("vencimento")} ${c.vencFull}. ${L("Você pode pagar pelo QR Code no portal do morador.")}`;
    window.open(`https://wa.me/${telDe(c)}?text=${encodeURIComponent(msg)}`, "_blank");
  };
  const [baixandoPdf, setBaixandoPdf] = useState(false);
  const baixarPdf = async (c) => {
    setBaixandoPdf(true);
    try { await baixarPdfCobranca(db.ctx, c); }
    catch (err) { alert("Não foi possível gerar o PDF: " + (err?.message || err)); }
    finally { setBaixandoPdf(false); }
  };
  const pctPagas = S.cobrEmitidas ? Math.round((S.cobrPagas / S.cobrEmitidas) * 100) : 0;
  const nAlvo = db.ctx.unidades.filter((u) => u.responsavelId).length;
  return (
    <div className="vfade space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard t={t} icon={QrCode} label={`Emitidas em ${S.competencia}`} value={String(S.cobrEmitidas)} />
        <StatCard t={t} icon={CheckCircle2} label="Pagas" value={`${S.cobrPagas} · ${pctPagas}%`} color={t.ok} />
        <StatCard t={t} icon={Clock} label="Aguardando pagamento" value={String(S.cobrAguardando)} color={t.warn} />
        <StatCard t={t} icon={AlertCircle} label="Vencidas" value={BRL(S.cobrVencidasValor)} color={t.danger} />
      </div>
      <Toolbar t={t} q={q} setQ={setQ} placeholder="Buscar por unidade ou responsável…"
        action={<Btn t={t} kind="primary" onClick={() => setNova(true)}><Plus size={15} /> Gerar cobranças</Btn>}>
        <Sel t={t} value={st} onChange={setSt} opts={[["todos","Todos"],["pago","Pagas"],["emitida","Emitidas"],["vencida","Vencidas"]]} />
      </Toolbar>
      <Tbl t={t} cols={[{k:"unidade",l:"Unidade"},{k:"resp",l:"Responsável"},{k:"comp",l:"Competência"},{k:"valor",l:"Valor"},{k:"venc",l:"Vencimento"},{k:"status",l:"Status"},{k:"acao",l:""}]}
        rows={rows}
        empty={<EmptyState t={t} icon={QrCode} title="Nenhuma cobrança nesta competência"
          hint="Gere as cobranças do mês: o sistema cria um QR Code Verum Pay único por unidade e envia pelo portal, e-mail ou WhatsApp."
          action={<Btn t={t} kind="primary" onClick={() => setNova(true)}><Plus size={14} /> Gerar cobranças do mês</Btn>} />}
        renderCell={(r, k) => {
          if (k === "valor") return <b>{BRL(r.valor)}</b>;
          if (k === "status") return <Badge t={t} s={r.status} />;
          if (k === "acao") return (<div className="flex justify-end gap-1">
            <Btn t={t} kind="soft" className="!px-2 !py-1 text-xs" onClick={() => setQr(r)}><QrCode size={13} /> QR</Btn>
            {r.status !== "pago" && <Btn t={t} className="!px-2 !py-1 text-xs" title={L("Reenvia a cobrança por WhatsApp")} onClick={() => enviarWhats(r)}><Send size={13} /> Reenviar</Btn>}</div>);
          return r[k];
        }} />
      {qr && (
        <Modal t={t} onClose={() => setQr(null)}>
          <ModalHeader t={t} title={`Cobrança ${qr.comp} — ${qr.unidade}`} onClose={() => setQr(null)} />
          <div className="flex flex-col items-center gap-3 text-center">
            <QRMock seed={qr.id + qr.unidade} />
            <div>
              <div className="text-2xl font-bold" style={{ fontFamily: "'Sora',sans-serif", color: t.gold }}>{BRL(qr.valor)}</div>
              <div className="text-xs" style={{ color: t.dim }}>Vencimento {qr.venc} · QR único desta cobrança</div>
            </div>
            <Badge t={t} s={qr.status} />
            {qr.tx !== "—" && <div className="rounded-lg px-3 py-1.5 text-xs" style={{ background: t.surface2, color: t.dim }}>Transação Verum Pay: <b style={{ color: t.gold }}>{qr.tx}</b> · baixa automática confirmada</div>}
            <div className="flex flex-wrap justify-center gap-2">
              <Btn t={t} disabled={baixandoPdf} onClick={() => baixarPdf(qr)}><Download size={14} /> {baixandoPdf ? "Gerando…" : "Baixar"}</Btn>
              <Btn t={t} onClick={() => enviarWhats(qr)}><Send size={14} /> Enviar por WhatsApp</Btn>
            </div>
            <div className="text-[11px]" style={{ color: t.dim }}>QR ilustrativo — a emissão real será conectada ao Verum Pay na fase de integração.</div>
          </div>
        </Modal>)}
      {nova && (
        <Modal t={t} onClose={() => setNova(false)}>
          <ModalHeader t={t} title="Gerar cobranças da competência" onClose={() => setNova(false)} />
          <form onSubmit={gerar}>
            <div className="space-y-3">
              <Field t={t} label="Destino">
                <select name="unidade" value={destino} onChange={(e) => setDestino(e.target.value)} style={inputStyle(t)}>
                  <option value="">{L("Todas as unidades (rateio pela fração)")}</option>
                  {db.ctx.unidades.map((u) => (
                    <option key={u.id} value={u.id}>{u.responsavelId ? u.labelResp : `${u.label}${moradorDa(u.label) ? ` — ${moradorDa(u.label)}` : ""}`}</option>))}
                </select>
              </Field>
              <Field t={t} label="Competência"><input name="competencia" type="month" defaultValue={new Date().toISOString().slice(0, 7)} style={inputStyle(t)} /></Field>
              <Field t={t} label={`${destino ? L("Valor da cobrança") : L("Valor total a ratear")} (${moeda})`}>
                <MoneyInput t={t} name="total" moeda={moeda} required /></Field>
              {!destino && (
                <Field t={t} label="Base de cálculo">
                  <select name="base" value={base} onChange={(e) => setBase(e.target.value)} style={inputStyle(t)}>
                    <option value="fracao">{L("Rateio por fração ideal (proporcional à área)")}</option>
                    <option value="igual">{L("Dividir igual por unidade")}</option>
                  </select>
                </Field>)}
              <Field t={t} label="Vencimento"><input name="vencimento" type="date" defaultValue={new Date().toISOString().slice(0, 10)} style={inputStyle(t)} /></Field>
              <Field t={t} label="Canais de envio"><div className="flex flex-wrap gap-2">{["Portal","E-mail","WhatsApp"].map((c) => (
                <label key={c} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs" style={{ borderColor: t.borderSoft }}>
                  <input type="checkbox" defaultChecked /> {c}</label>))}</div></Field>
              <div className="rounded-xl border px-3 py-2.5 text-xs" style={{ borderColor: t.border, background: t.goldSoft, color: t.gold }}>
                {destino
                  ? `${L("Será gerada 1 cobrança para")} ${db.ctx.unidades.find((x) => x.id === destino)?.label}${moradorDa(db.ctx.unidades.find((x) => x.id === destino)?.label) ? ` (${moradorDa(db.ctx.unidades.find((x) => x.id === destino)?.label)})` : ""}. ${L("O morador verá o aviso no portal dele.")}`
                  : `${L("Serão geradas")} ${nAlvo} ${L("cobranças (unidades com responsável financeiro)")} — ${base === "igual" ? L("valor dividido em partes iguais entre as unidades") : L("rateadas pela fração ideal de cada unidade")}.`}</div>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setNova(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={gerando}><QrCode size={14} /> {gerando ? "Gerando…" : (destino ? L("Gerar cobrança") : `${L("Gerar")} ${nAlvo} ${L("cobranças")}`)}</Btn></div>
          </form>
        </Modal>)}
    </div>
  );
}

/* ══════════════ MULTAS E ADVERTÊNCIAS ══════════════ */
function Multas({ t, role }) {
  const { db, reload } = useData();
  const S = db.stats;
  const [sel, setSel] = useState(null); const [nova, setNova] = useState(false); const [decidindo, setDecidindo] = useState(false);
  const [salvar, saving] = useSubmit(async (f) => { await criarPenalidade(db.ctx, f); await reload(); setNova(false); });
  const decidir = async (aprovar) => {
    setDecidindo(true);
    try { await decidirPenalidade(db.ctx, sel.id, aprovar); await reload(); setSel(null); }
    catch (err) { alert("Não foi possível salvar: " + err.message); }
    finally { setDecidindo(false); }
  };
  const [enviando, setEnviando] = useState(false);
  const enviarResp = async () => {
    setEnviando(true);
    try { await enviarPenalidade(db.ctx, sel); await reload(); setSel(null); }
    catch (err) { alert(err?.message || err); }
    finally { setEnviando(false); }
  };
  /* janela de impressão com o timbrado — o navegador salva como PDF */
  const imprimirPdf = (m) => {
    const c = db.cond || {};
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) { alert(L("Libere pop-ups do site para imprimir o documento.")); return; }
    const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${m.valor > 0 ? "Multa" : "Advertência"} ${esc(m.num)}</title>
      <style>body{font-family:Georgia,'Times New Roman',serif;background:#fff;color:#1A1A1A;margin:48px auto;max-width:640px;line-height:1.6}
      .topo{display:flex;align-items:center;gap:14px;border-bottom:2px solid #D4AF37;padding-bottom:14px}
      .logo{width:52px;height:52px;border-radius:50%;background:#0A0E1A;color:#D4AF37;display:flex;align-items:center;justify-content:center;font-weight:bold}
      .logo img{max-width:100%;max-height:100%;border-radius:50%}
      .tipo{margin-top:22px;font-size:13px;letter-spacing:3px;color:#9E7C14;font-weight:bold;text-transform:uppercase}
      table{margin-top:14px;font-size:14px} td{padding:3px 14px 3px 0}
      .ass{margin-top:56px;border-top:1px solid #999;padding-top:6px;text-align:center;font-size:13px;color:#555;max-width:320px;margin-left:auto;margin-right:auto}
      .rod{margin-top:40px;font-size:11px;color:#888;text-align:center}</style></head><body>
      <div class="topo"><div class="logo">${c.logoUrl ? `<img src="${esc(c.logoUrl)}">` : esc((c.nome || "?").split(" ").slice(0, 2).map((x) => x[0]).join("").toUpperCase())}</div>
        <div><b style="font-size:17px">${esc(c.nome)}</b><br><span style="font-size:12px;color:#666">${esc([c.cnpj && `CNPJ ${c.cnpj}`, c.endereco].filter(Boolean).join(" · "))}</span></div></div>
      <div class="tipo">${m.valor > 0 ? "Notificação de multa" : "Advertência formal"} — Nº ${esc(m.num)}</div>
      <p>${esc(m.descricao || m.categoria)}</p>
      <table>
        <tr><td><b>Unidade:</b></td><td>${esc(m.unidade)}</td></tr>
        <tr><td><b>Categoria:</b></td><td>${esc(m.categoria)}</td></tr>
        <tr><td><b>Base normativa:</b></td><td>${esc(m.base || "Regimento interno")}</td></tr>
        <tr><td><b>Data da ocorrência:</b></td><td>${esc(m.data)}</td></tr>
        ${m.valor > 0 ? `<tr><td><b>Valor:</b></td><td>${BRL(m.valor)}</td></tr>` : ""}
        ${m.prazo !== "—" ? `<tr><td><b>Prazo para defesa:</b></td><td>${esc(m.prazo)}</td></tr>` : ""}
        <tr><td><b>Emitido em:</b></td><td>${new Date().toLocaleDateString("pt-BR")}</td></tr>
      </table>
      <div class="ass">${esc(c.sindico || "Síndico")} — Síndico<br>assinatura eletrônica registrada na plataforma</div>
      <div class="rod">Documento gerado pelo CondoMaster Pro</div>
      <script>window.onload = () => window.print()</` + `script></body></html>`);
    w.document.close();
  };
  return (
    <div className="vfade space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard t={t} icon={Gavel} label="Aplicadas em 2026" value={String(S.multasAno)} />
        <StatCard t={t} icon={Clock} label="Em prazo de defesa" value={String(S.multasEmDefesa)} color={t.warn} />
        <StatCard t={t} icon={Wallet} label="Arrecadado em multas" value={BRL(S.multasArrecadado)} color={t.ok} />
      </div>
      <div className="flex justify-end"><Btn t={t} kind="primary" onClick={() => setNova(true)}><Plus size={15} /> Registrar infração</Btn></div>
      <div className="space-y-2">
        {db.multas.map((m) => (
          <Card t={t} key={m.id} className="cursor-pointer" onClick={() => setSel(m)}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-xl p-2" style={{ background: t.goldSoft }}><Gavel size={16} color={t.gold} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">Nº {m.num} · {m.categoria}
                  {m.reincidencia > 0 && <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: t.danger + "22", color: t.danger }}>REINCIDENTE</span>}</div>
                <div className="text-xs" style={{ color: t.dim }}>Unidade {m.unidade} · {m.infrator} · {m.data}{m.valor > 0 && <> · <b style={{ color: t.text }}>{BRL(m.valor)}</b></>}</div>
              </div>
              <Badge t={t} s={m.status} /><ChevronRight size={16} color={t.dim} />
            </div>
          </Card>))}
      </div>
      {sel && (
        <Modal t={t} onClose={() => setSel(null)} wide>
          <ModalHeader t={t} title={`${sel.valor > 0 ? "Multa" : "Advertência"} nº ${sel.num}`} onClose={() => setSel(null)} />
          <div className="mb-3 flex flex-wrap gap-2"><Badge t={t} s={sel.status} />
            {sel.prazo !== "—" && <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: t.warn + "1E", color: t.warn }}>Defesa até {sel.prazo}</span>}</div>
          <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border p-3 text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
            <div>Base normativa: <b style={{ color: t.text }}>{sel.base || "Regimento interno"}</b></div>
            <div>Descrição: <b style={{ color: t.text }}>{sel.descricao || sel.categoria}</b></div>
            <div>Registrada por: <b style={{ color: t.text }}>Síndico — via painel</b></div>
            <div>Reincidência: <b style={{ color: t.text }}>{sel.reincidencia ? `${sel.reincidencia}ª ocorrência anterior` : "primeira ocorrência"}</b></div>
          </div>
          {sel.provas?.length > 0 && (<>
            <div className="mb-2 text-xs font-semibold" style={{ color: t.dim }}>PROVAS ANEXADAS · {sel.provas.length}</div>
            <div className="mb-3 flex flex-wrap gap-2">
              {sel.provas.map((p, i) => (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                  style={{ borderColor: t.border, background: t.goldSoft, color: t.gold }}>
                  <Eye size={12} /> {({ foto: "Foto", video: "Vídeo", audio: "Áudio", documento: "Documento" }[p.tipo] || "Arquivo")} {i + 1}
                </a>))}
            </div>
          </>)}
          <div className="mb-2 text-xs font-semibold" style={{ color: t.dim }}>PRÉVIA DO DOCUMENTO TIMBRADO</div>
          <Timbrado t={t} tipo={sel.valor > 0 ? "Notificação de multa" : "Advertência formal"} unidade={sel.unidade}
            valor={sel.valor > 0 ? sel.valor : null} prazo={sel.prazo !== "—" ? sel.prazo : null}
            corpo={`Fica a unidade ${sel.unidade} notificada pela infração "${sel.categoria}", registrada em ${sel.data}, conforme base normativa do regimento interno. ${sel.valor > 0 ? "O valor abaixo será lançado na próxima competência caso não haja defesa acolhida." : "Em caso de reincidência, será aplicada multa conforme tabela vigente."}`} />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Btn t={t} onClick={() => imprimirPdf(sel)}><Printer size={14} /> Imprimir PDF</Btn>
            {role !== "morador" && sel.status === "aprovada_envio" && (
              <Btn t={t} kind="primary" disabled={enviando} onClick={enviarResp}>
                <Send size={14} /> {enviando ? "Enviando…" : sel.valor > 0 ? L("Enviar ao responsável (emite a cobrança)") : "Enviar ao responsável"}</Btn>)}
            {sel.entregueEm && <span className="self-center text-xs" style={{ color: t.dim }}>{L("Entregue ao responsável em")} {sel.entregueEm}</span>}
            {role !== "morador" && sel.status === "pendente" && (<>
              <Btn t={t} kind="danger" disabled={decidindo} onClick={() => decidir(false)}><Ban size={14} /> {sel.valor > 0 ? "Cancelar multa" : L("Cancelar advertência")}</Btn>
              <Btn t={t} kind="primary" disabled={decidindo} onClick={() => decidir(true)}><Check size={14} /> {decidindo ? "Salvando…" : "Aprovar (síndico)"}</Btn></>)}
          </div>
        </Modal>)}
      {nova && (
        <Modal t={t} onClose={() => setNova(false)} wide>
          <ModalHeader t={t} title="Registrar infração" onClose={() => setNova(false)} />
          <form onSubmit={salvar}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field t={t} label="Categoria da infração"><select name="categoria" style={inputStyle(t)}>{["Barulho após horário de silêncio","Uso indevido de vaga","Descarte irregular de resíduos","Animal sem coleira","Dano à área comum","Obra fora do horário","Outra"].map((c)=><option key={c}>{c}</option>)}</select></Field>
              <Field t={t} label="Unidade responsável"><select name="unidade" required style={inputStyle(t)}>{db.ctx.unidades.map((u)=><option key={u.id} value={u.id}>{u.labelResp}</option>)}</select></Field>
              <Field t={t} label="Data e hora"><input name="data" type="datetime-local" style={inputStyle(t)} /></Field>
              <Field t={t} label="Tipo de penalidade"><select name="tipo" style={inputStyle(t)}><option>Advertência (primeira ocorrência)</option><option>Multa</option></select></Field>
              <Field t={t} label="Valor (se multa)"><input name="valor" placeholder="$ 0,00" style={inputStyle(t)} /></Field>
              <Field t={t} label="Prazo para defesa"><input name="prazo" type="date" style={inputStyle(t)} /></Field>
            </div>
            <Field t={t} label="Base normativa"><input name="base" placeholder="Ex.: Regimento interno, art. 12" style={{ ...inputStyle(t), marginTop: 4 }} /></Field>
            <Field t={t} label="Descrição detalhada"><textarea name="desc" rows={3} style={{ ...inputStyle(t), marginTop: 4, resize: "vertical" }} /></Field>
            <div className="mt-3"><Field t={t} label="Provas (foto, vídeo, áudio ou documento)">
              <FileField t={t} name="provas" multiple accept="image/*,video/*,audio/*,application/pdf" height={64} hint="Clique para anexar os arquivos de prova" /></Field></div>
            <div className="mt-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
              O registro segue para aprovação do síndico. O documento timbrado só é emitido após a decisão.</div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setNova(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={saving}><Check size={14} /> {saving ? "Salvando…" : "Enviar para aprovação"}</Btn></div>
          </form>
        </Modal>)}
    </div>
  );
}

/* ══════════════ COMUNICADOS ══════════════ */
function Comunicados({ t }) {
  const { db, reload } = useData();
  const [novo, setNovo] = useState(false);
  /* segmento controlado: selecionar um tipo (ex.: Apartamentos) abre o dropdown de unidade específica */
  const [seg, setSeg] = useState("todas"); const [segUni, setSegUni] = useState("");
  const abrirNovo = () => { setSeg("todas"); setSegUni(""); setNovo(true); };
  const [salvar, saving] = useSubmit(async (f) => {
    if (f.unidadeSeg) f.segmento = `unidade:${f.unidadeSeg}`; // unidade específica escolhida no 2º dropdown
    await criarComunicado(db.ctx, f); await reload(); setNovo(false);
  });
  return (
    <div className="vfade space-y-4">
      <div className="flex justify-end"><Btn t={t} kind="primary" onClick={abrirNovo}><Plus size={15} /> Novo comunicado</Btn></div>
      <div className="space-y-2">
        {db.comunic.map((c) => (
          <Card t={t} key={c.id}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-xl p-2" style={{ background: t.goldSoft }}><Megaphone size={16} color={t.gold} /></div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{c.titulo}</div>
                <div className="text-xs" style={{ color: t.dim }}>{c.tipo} · {c.data} · {L(c.publico)} · enviado por {c.canal}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold" style={{ color: c.leitura > 80 ? t.ok : t.warn, fontFamily: "'Sora',sans-serif" }}>{c.leitura}%</div>
                <div className="text-[10px]" style={{ color: t.dim }}>leitura confirmada</div>
              </div>
              {c.pdfUrl
                ? (<a href={c.pdfUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl border px-2 py-1 text-xs font-semibold"
                    style={{ borderColor: t.border, background: t.goldSoft, color: t.gold }}><Eye size={13} /> {L("Ver comunicado")}</a>)
                : (<Btn t={t} className="!px-2 !py-1 text-xs" onClick={() => alert(L("Este comunicado foi publicado sem a versão em PDF. Os novos são arquivados automaticamente no módulo Documentos."))}><Eye size={13} /> Ver</Btn>)}
            </div>
          </Card>))}
      </div>
      {novo && (
        <Modal t={t} onClose={() => setNovo(false)} wide>
          <ModalHeader t={t} title="Novo comunicado" onClose={() => setNovo(false)} />
          <form onSubmit={salvar}>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field t={t} label="Tipo"><select name="tipo" style={inputStyle(t)}>{["Comunicado geral","Convocação de assembleia","Circular","Aviso de manutenção","Informe de emergência"].map((x)=><option key={x}>{x}</option>)}</select></Field>
                <Field t={t} label="Destinatários">
                  <select name="segmento" value={seg} onChange={(e) => { setSeg(e.target.value); setSegUni(""); }} style={inputStyle(t)}>
                    <option value="todas">{L("Todas as unidades")}</option>
                    {db.ctx.blocos.map((b) => <option key={b.id} value={`bloco:${b.nome}`}>{L("Bloco")} {b.nome}</option>)}
                    {db.ctx.tiposUnidade.map((x) => <option key={x} value={`tipo:${x}`}>
                      {({ apartamento: "Apartamentos", sala: "Salas comerciais", loja: "Lojas", cobertura: "Coberturas", box: "Boxes", deposito: "Depósitos" }[x] || x)}</option>)}
                    {db.ctx.andares.map((a) => <option key={a} value={`andar:${a}`}>{L("Andar")} {a}</option>)}
                    <option value="inadimplentes">{L("Somente inadimplentes")}</option>
                  </select>
                </Field>
                {seg.startsWith("tipo:") && (
                  <Field t={t} label="Unidade específica (opcional)">
                    <select name="unidadeSeg" value={segUni} onChange={(e) => setSegUni(e.target.value)} style={inputStyle(t)}>
                      <option value="">{L("Todas as unidades deste tipo")}</option>
                      {db.ctx.unidades.filter((u) => u.tipo === seg.split(":")[1]).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                    </select>
                  </Field>)}
              </div>
              <Field t={t} label="Título"><input name="titulo" required style={inputStyle(t)} /></Field>
              <Field t={t} label="Mensagem"><textarea name="corpo" rows={4} style={{ ...inputStyle(t), resize: "vertical" }} /></Field>
              <Field t={t} label="Canais"><div className="flex flex-wrap gap-2">{["Portal","E-mail","WhatsApp","Impressão"].map((c) => (
                <label key={c} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs" style={{ borderColor: t.borderSoft }}>
                  <input type="checkbox" name={`canal_${c}`} defaultChecked={c !== "Impressão"} /> {c}</label>))}</div></Field>
              <label className="flex items-center gap-2 text-xs" style={{ color: t.dim }}><input type="checkbox" name="gerarPdf" defaultChecked /> Gerar versão timbrada em PDF e arquivar no módulo Documentos</label>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setNovo(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={saving}><Send size={14} /> {saving ? "Publicando…" : "Publicar e enviar"}</Btn></div>
          </form>
        </Modal>)}
    </div>
  );
}

/* ══════════════ DOCUMENTOS TIMBRADOS ══════════════ */
const DOC_SINGULAR = {
  "Comunicados": "Comunicado", "Convocações": "Convocação", "Atas": "Ata",
  "Advertências": "Advertência", "Multas": "Multa", "Recibos": "Recibo",
  "Extratos": "Extrato", "Autorizações": "Autorização", "Ordens de serviço": "Ordem de serviço",
};
/* Modelos prontos por tipo — d: { cond, unidade, morador, titulo, data } */
const DOC_MODELOS = {
  "Comunicados": (d) => `A administração do condomínio ${d.cond} vem, por meio deste, comunicar ${d.alvo} sobre: ${d.titulo}. Contamos com a atenção e a colaboração de todos para o bom convívio e o cumprimento das normas internas.`,
  "Convocações": (d) => `Ficam os senhores condôminos do ${d.cond} convocados para assembleia com a seguinte pauta: ${d.titulo}. A assembleia será instalada em primeira convocação com o quórum legal e, em segunda convocação, trinta minutos após, com qualquer número de presentes. A participação de todos é fundamental para as deliberações.`,
  "Atas": (d) => `Aos ${d.data}, reuniram-se os condôminos do ${d.cond}, conforme lista de presença arquivada na administração, para deliberar sobre a seguinte pauta: ${d.titulo}. As deliberações registradas nesta ata passam a vigorar a partir da sua publicação, ficando o registro arquivado para consulta.`,
  "Advertências": (d) => `Fica ${d.alvo} formalmente ADVERTIDA em razão de: ${d.titulo}, com base no regimento interno do ${d.cond}. Em caso de reincidência, poderá ser aplicada multa conforme a tabela vigente, garantido o direito de defesa no prazo regimental.`,
  "Multas": (d) => `Fica aplicada ${d.alvo} MULTA em razão de: ${d.titulo}, com base no regimento interno e na convenção do ${d.cond}. O valor será lançado na próxima competência, sendo garantido o direito de defesa no prazo regimental.`,
  "Recibos": (d) => `Recebemos ${d.deAlvo} a importância referente a: ${d.titulo}. Para clareza, firmamos o presente recibo, dando plena e total quitação do valor correspondente na data de emissão.`,
  "Extratos": (d) => `Demonstrativo emitido pelo ${d.cond}${d.unidade ? ` referente à unidade ${d.unidade}${d.morador ? ` (${d.morador})` : ""}` : ""}, consolidando: ${d.titulo}. Os valores detalhados constam do módulo financeiro do condomínio e ficam à disposição para conferência.`,
  "Autorizações": (d) => `O condomínio ${d.cond} AUTORIZA ${d.alvo} a: ${d.titulo}. Esta autorização é válida mediante a observância das normas internas, dos horários permitidos e das orientações da administração.`,
  "Ordens de serviço": (d) => `Fica autorizada a execução do serviço: ${d.titulo}, ${d.unidade ? `na unidade ${d.unidade}` : "nas dependências do condomínio"}. O responsável pela execução deverá observar as normas de segurança e comunicar a conclusão à administração.`,
};
function Documentos({ t }) {
  const { db, reload } = useData();
  const tipos = ["Todos","Comunicados","Convocações","Atas","Advertências","Multas","Recibos","Extratos","Autorizações","Ordens de serviço"];
  const [tipo, setTipo] = useState("Todos"); const [preview, setPreview] = useState(false);
  /* formulário do novo documento — controlado, para a prévia refletir na hora */
  const [fTipo, setFTipo] = useState("Comunicados"); const [fUni, setFUni] = useState("");
  const [fTitulo, setFTitulo] = useState(""); const [fDesc, setFDesc] = useState("");
  const abrirNovo = () => { setFTipo("Comunicados"); setFUni(""); setFTitulo(""); setFDesc(""); setPreview(true); };
  const uniSel = db.ctx.unidades.find((u) => u.id === fUni);
  const morador = uniSel
    ? (db.ctx.pessoas.find((p) => p.id === uniSel.responsavelId)?.nome
      || db.ctx.pessoas.find((p) => p.unidadeId === uniSel.id)?.nome || "")
    : "";
  const dModelo = {
    cond: db.cond?.nome || "—", unidade: uniSel?.label || "", morador,
    titulo: fTitulo.trim() || "[título do documento]",
    data: new Date().toLocaleDateString("pt-BR"),
    alvo: uniSel ? `a unidade ${uniSel.label}${morador ? `, sob responsabilidade de ${morador},` : ""}` : "todos os condôminos",
    deAlvo: uniSel ? `da unidade ${uniSel.label}${morador ? ` (${morador})` : ""}` : "do pagador identificado no título",
  };
  const corpoModelo = (DOC_MODELOS[fTipo] || DOC_MODELOS["Comunicados"])(dModelo);
  const corpoFinal = fDesc.trim() ? `${corpoModelo}\n\n${fDesc.trim()}` : corpoModelo;
  const [gerar, gerando] = useSubmit(async (f) => {
    const url = await criarDocumento(db.ctx, { ...f, corpo: corpoFinal });
    await reload(); setPreview(false);
    window.open(url, "_blank"); // abre o PDF recém-gerado
  });
  /* anos reais dos documentos arquivados deste condomínio */
  const anos = [...new Set(db.docs.map((d) => d.data.slice(-4)))].sort().reverse();
  const [ano, setAno] = useState("todos");
  const docs = db.docs.filter((d) => (tipo === "Todos" || d.tipo === tipo) && (ano === "todos" || d.data.endsWith(ano)));
  return (
    <div className="vfade space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sel t={t} value={tipo} onChange={setTipo} opts={tipos.map((x) => [x, x])} />
        <Sel t={t} value={ano} onChange={setAno} opts={[["todos", L("Todos os anos")], ...anos.map((a) => [a, a])]} />
        <div className="ml-auto"><Btn t={t} kind="primary" onClick={abrirNovo}><Plus size={15} /> Criar documento timbrado</Btn></div>
      </div>
      {docs.length ? (
        <div className="space-y-2">{docs.map((d) => (
          <Card t={t} key={d.id}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-xl p-2" style={{ background: t.goldSoft }}><FileText size={16} color={t.gold} /></div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{d.nome}</div>
                <div className="text-xs" style={{ color: t.dim }}>{d.tipo} · {d.data} · {d.envios}</div>
              </div>
              {d.url ? (<>
                <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 text-xs"
                  style={{ borderColor: t.borderSoft, color: t.dim }}><Eye size={13} /> Ver</a>
                <a href={d.url} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 text-xs font-semibold"
                  style={{ borderColor: t.border, background: t.goldSoft, color: t.gold }}><Download size={13} /> PDF</a>
              </>) : <span className="text-xs" style={{ color: t.dim }}>—</span>}
            </div>
          </Card>))}</div>
      ) : (
        <EmptyState t={t} icon={FileText} title="Nenhum documento nesta categoria"
          hint="Documentos timbrados de multas, comunicados, atas e recibos são arquivados automaticamente aqui, com retenção por anos." />)}
      {preview && (
        <Modal t={t} onClose={() => setPreview(false)} wide>
          <ModalHeader t={t} title="Novo documento timbrado" onClose={() => setPreview(false)} />
          <form onSubmit={gerar}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field t={t} label="Tipo"><select name="tipo" value={fTipo} onChange={(e) => setFTipo(e.target.value)} style={inputStyle(t)}>{tipos.slice(1).map((x)=><option key={x}>{x}</option>)}</select></Field>
              <Field t={t} label="Unidade (se aplicável)"><select name="unidade" value={fUni} onChange={(e) => setFUni(e.target.value)} style={inputStyle(t)}><option value="">—</option>{db.ctx.unidades.map((u)=><option key={u.id} value={u.id}>{u.labelResp}</option>)}</select></Field>
            </div>
            {fUni && (
              <div className="mt-2 text-xs" style={{ color: t.dim }}>
                {L("Morador cadastrado:")} <b style={{ color: morador ? t.text : t.warn }}>{morador || L("nenhum morador vinculado a esta unidade")}</b></div>)}
            <Field t={t} label="Título"><input name="titulo" required value={fTitulo} onChange={(e) => setFTitulo(e.target.value)} placeholder={L("Ex.: Autorização de mudança")} style={{ ...inputStyle(t), marginTop: 4 }} /></Field>
            <Field t={t} label="Descrição adicional (opcional)"><textarea name="descricao" rows={2} value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder={L("Algo a mais que queira acrescentar ao modelo…")} style={{ ...inputStyle(t), marginTop: 4, resize: "vertical" }} /></Field>
            <div className="mb-2 mt-4 text-xs font-semibold" style={{ color: t.dim }}>{L("PRÉVIA COM PAPEL TIMBRADO — MODELO + DADOS PREENCHIDOS")}</div>
            <Timbrado t={t} tipo={`${DOC_SINGULAR[fTipo] || fTipo} — ${fTitulo.trim() || L("(sem título)")}`} unidade={uniSel ? `${uniSel.label}${morador ? ` · ${morador}` : ""}` : "—"} corpo={corpoFinal} />
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setPreview(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={gerando}><Printer size={14} /> {gerando ? "Gerando…" : "Gerar PDF"}</Btn></div>
          </form>
        </Modal>)}
    </div>
  );
}

/* ══════════════ CHAMADOS DE MANUTENÇÃO ══════════════ */
function Chamados({ t }) {
  const { db, reload } = useData();
  const [novo, setNovo] = useState(false); const [st, setSt] = useState("todos");
  const [sel, setSel] = useState(null); // chamado aberto no popup de detalhes/gestão
  const [salvar, saving] = useSubmit(async (f) => { await criarChamado(db.ctx, f); await reload(); setNovo(false); });
  const [salvarGestao, salvandoGestao] = useSubmit(async (f) => { await atualizarChamado(db.ctx, sel.id, f); await reload(); setSel(null); });
  const PRIO_LABEL = { baixa: "Baixa", media: "Média", alta: "Alta" };
  const rows = db.chamados.filter((c) => st === "todos" || c.status === st);
  const cols3 = [["aberto", "Abertos"], ["andamento", "Em andamento"], ["concluido", "Concluídos"]];
  return (
    <div className="vfade space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sel t={t} value={st} onChange={setSt} opts={[["todos","Todos os status"],...cols3]} />
        <div className="ml-auto"><Btn t={t} kind="primary" onClick={() => setNovo(true)}><Plus size={15} /> Abrir chamado</Btn></div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {cols3.map(([k, l]) => {
          const list = rows.filter((c) => c.status === k);
          return (
            <div key={k}>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold" style={{ color: t.dim }}>
                <CircleDot size={11} color={t[STATUS_META[k].c]} /> {L(l).toUpperCase()} · {list.length}</div>
              <div className="space-y-2">
                {list.length === 0 && <div className="rounded-xl border border-dashed p-4 text-center text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>{L("Nenhum chamado aqui")}</div>}
                {list.map((c) => (
                  <Card t={t} key={c.id} className="cursor-pointer vhover" onClick={() => setSel(c)}>
                    <div className="flex items-center justify-between text-xs" style={{ color: t.dim }}>
                      <span>{c.num} · {c.cat}</span><Badge t={t} s={c.prio} /></div>
                    <div className="mt-1 text-sm font-medium">{c.desc}</div>
                    {c.midias?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.midias.map((m, i) => (
                          <a key={i} href={m.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                            style={{ borderColor: t.border, background: t.goldSoft, color: t.gold }}>
                            <Eye size={11} /> {m.tipo?.startsWith("video/") ? L("Vídeo") : L("Foto")} {i + 1}
                          </a>))}
                      </div>)}
                    <div className="mt-2 flex items-center justify-between text-xs" style={{ color: t.dim }}>
                      <span><User size={11} className="mr-1 inline" />{c.resp}</span>
                      <span>{c.custo > 0 ? BRL(c.custo) : L("sem custo lançado")}</span></div>
                  </Card>))}
              </div>
            </div>);
        })}
      </div>
      {sel && (
        <Modal t={t} onClose={() => setSel(null)} wide>
          <ModalHeader t={t} title={`${sel.num} — ${sel.cat}`} onClose={() => setSel(null)} />
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge t={t} s={sel.status} /><Badge t={t} s={sel.prio} />
            {sel.fechado && <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: t.surface2, color: t.dim }}>{L("Fechado em")} {sel.fechado}</span>}
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border p-3 text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
            <div>{L("Aberto em")}: <b style={{ color: t.text }}>{sel.abertoFull}</b></div>
            <div>{L("Responsável atual")}: <b style={{ color: t.text }}>{sel.resp}</b></div>
            <div>{L("Custo estimado")}: <b style={{ color: t.text }}>{sel.custoEstimado > 0 ? BRL(sel.custoEstimado) : "—"}</b></div>
            <div>{L("Custo realizado")}: <b style={{ color: t.text }}>{sel.custoRealizado > 0 ? BRL(sel.custoRealizado) : "—"}</b></div>
          </div>
          <div className="mb-1 text-xs font-semibold" style={{ color: t.dim }}>{L("DESCRIÇÃO DO PROBLEMA")}</div>
          <p className="text-sm leading-relaxed" style={{ whiteSpace: "pre-wrap" }}>{sel.desc}</p>
          {sel.midias?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {sel.midias.map((m, i) => (
                <a key={i} href={m.url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
                  style={{ borderColor: t.border, background: t.goldSoft, color: t.gold }}>
                  <Eye size={12} /> {m.tipo?.startsWith("video/") ? L("Vídeo") : L("Foto")} {i + 1}</a>))}
            </div>)}
          <form onSubmit={salvarGestao} key={sel.id}>
            <div className="mb-1 mt-4 text-xs font-semibold" style={{ color: t.dim }}>{sel.status === "concluido" ? L("CHAMADO CONCLUÍDO") : L("GERENCIAR CHAMADO")}</div>
            {sel.status === "concluido" && (
              <div className="mb-2 rounded-xl border border-dashed px-3 py-2 text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
                <CheckCircle2 size={13} className="mr-1 inline" /> {L("Este chamado foi concluído e ficou registrado no histórico — não pode mais ser editado.")}</div>)}
            <fieldset disabled={sel.status === "concluido"} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, opacity: sel.status === "concluido" ? 0.6 : 1 }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field t={t} label="Responsável">
                <select name="responsavel" defaultValue={sel.respId} style={inputStyle(t)}>
                  <option value="">{L("Designar depois")}</option>
                  {db.ctx.operacionais.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select></Field>
              <Field t={t} label="Status">
                <select name="status" defaultValue={sel.status} style={inputStyle(t)}>
                  {[["aberto","Aberto"],["andamento","Em andamento"],["concluido","Concluído"],["cancelado","Cancelado"]].map(([v, l]) => <option key={v} value={v}>{L(l)}</option>)}
                </select></Field>
              <Field t={t} label="Prioridade">
                <select name="prioridade" defaultValue={PRIO_LABEL[sel.prio] || "Média"} style={inputStyle(t)}>
                  <option>Baixa</option><option>Média</option><option>Alta</option>
                </select></Field>
              <Field t={t} label="Prazo"><input name="prazo" type="date" defaultValue={sel.prazo} style={inputStyle(t)} /></Field>
              <Field t={t} label="Custo realizado ($)"><input name="custo" defaultValue={sel.custoRealizado > 0 ? String(sel.custoRealizado).replace(".", ",") : ""} placeholder="0,00" style={inputStyle(t)} /></Field>
            </div>
            </fieldset>
            {!db.ctx.operacionais.length && sel.status !== "concluido" && (
              <div className="mt-2 text-xs" style={{ color: t.dim }}>{L("Nenhum funcionário ou prestador cadastrado — cadastre na tela Pessoas para poder designar um responsável.")}</div>)}
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setSel(null)}>Fechar</Btn>
              {sel.status !== "concluido" && (
                <Btn t={t} kind="primary" type="submit" disabled={salvandoGestao}><Check size={14} /> {salvandoGestao ? "Salvando…" : "Salvar alterações"}</Btn>)}</div>
          </form>
        </Modal>)}
      {novo && (
        <Modal t={t} onClose={() => setNovo(false)} wide>
          <ModalHeader t={t} title="Abrir chamado de manutenção" onClose={() => setNovo(false)} />
          <form onSubmit={salvar}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field t={t} label="Categoria"><select name="categoria" style={inputStyle(t)}>{["Elétrica","Hidráulica","Pintura","Limpeza","Elevador","Portão","Câmeras","Jardinagem","Estrutural","Telhado","Área comum","Equipamentos","Emergência"].map((c)=><option key={c}>{c}</option>)}</select></Field>
              <Field t={t} label="Prioridade"><select name="prioridade" style={inputStyle(t)}><option>Baixa</option><option>Média</option><option>Alta</option></select></Field>
              <Field t={t} label="Responsável"><select name="responsavel" style={inputStyle(t)}><option value="">Designar depois</option>{db.ctx.operacionais.map((o)=><option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
              <Field t={t} label="Prazo"><input name="prazo" type="date" style={inputStyle(t)} /></Field>
              <Field t={t} label="Custo estimado"><input name="custo" placeholder="$ 0,00" style={inputStyle(t)} /></Field>
              <Field t={t} label="Fotos / vídeos"><FileField t={t} name="midias" multiple accept="image/*,video/*" hint="Anexar mídia" /></Field>
            </div>
            <Field t={t} label="Descrição do problema"><textarea name="desc" required rows={3} style={{ ...inputStyle(t), marginTop: 4, resize: "vertical" }} /></Field>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setNovo(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={saving}><Check size={14} /> {saving ? "Abrindo…" : "Abrir chamado"}</Btn></div>
          </form>
        </Modal>)}
    </div>
  );
}

/* ══════════════ PORTARIA E SEGURANÇA ══════════════ */
/* QR Code real (biblioteca qrcode) — o conteúdo é o token validável na portaria */
function QRReal({ value, size = 180 }) {
  const [src, setSrc] = useState(null);
  useEffect(() => { QRCodeLib.toDataURL(value, { width: size, margin: 1 }).then(setSrc).catch(() => setSrc(null)); }, [value, size]);
  return src ? <img src={src} width={size} height={size} alt="QR Code" className="rounded-xl bg-white p-1" /> : null;
}

/* Câmera + leitor nativo (BarcodeDetector); sem suporte/câmera, digita-se o código */
function LeitorQr({ t, onLer }) {
  const videoRef = React.useRef(null);
  const [aviso, setAviso] = useState("");
  useEffect(() => {
    let stream, timer, ativo = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!ativo) { stream.getTracks().forEach((x) => x.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if ("BarcodeDetector" in window) {
          const det = new window.BarcodeDetector({ formats: ["qr_code"] });
          timer = setInterval(async () => {
            try { const codes = await det.detect(videoRef.current); if (codes[0]?.rawValue) onLer(codes[0].rawValue); } catch { /* frame inválido */ }
          }, 400);
        } else setAviso(L("Este navegador não tem leitor nativo de QR — aponte por outro dispositivo ou digite o código abaixo."));
      } catch { setAviso(L("Câmera indisponível — digite o código abaixo.")); }
    })();
    return () => { ativo = false; clearInterval(timer); stream?.getTracks().forEach((x) => x.stop()); };
  }, [onLer]);
  return (<div className="space-y-2">
    <video ref={videoRef} muted playsInline className="w-full rounded-xl" style={{ maxHeight: 240, background: "#000" }} />
    {aviso && <div className="text-xs" style={{ color: t.warn }}>{aviso}</div>}
  </div>);
}

function Portaria({ t }) {
  const { db, reload } = useData();
  const S = db.stats;
  const [novo, setNovo] = useState(false);
  const [gerarQr, setGerarQr] = useState(false);
  const [qrView, setQrView] = useState(null); // QR gerado (pré-autorização ou acesso rápido)
  const [leitor, setLeitor] = useState(false);
  const [resultado, setResultado] = useState(null); // resultado da validação do QR
  const [confirmado, setConfirmado] = useState(false);
  const [ocorrencia, setOcorrencia] = useState(false);
  const [entrega, setEntrega] = useState(false);
  const [salvar, saving] = useSubmit(async (f) => { const r = await criarPreAutorizacao(db.ctx, f); await reload(); setNovo(false); setQrView(r); });
  const [gerar, gerando] = useSubmit(async (f) => { const r = await gerarQrAcesso(db.ctx, f); setGerarQr(false); setQrView(r); });
  const [salvarOcorrencia, salvandoOc] = useSubmit(async (f) => { await registrarOcorrencia(db.ctx, f); await reload(); setOcorrencia(false); });
  const [salvarEntrega, salvandoEnt] = useSubmit(async (f) => { await registrarEntrega(db.ctx, f); await reload(); setEntrega(false); });
  const validandoRef = React.useRef(false);
  const lerCodigo = useCallback(async (codigo) => {
    if (validandoRef.current) return;
    validandoRef.current = true;
    try { setResultado(await validarQrAcesso(db.ctx, codigo)); }
    catch (e) { setResultado({ permitido: false, motivo: e?.message || String(e) }); }
    finally { validandoRef.current = false; }
  }, [db.ctx]);
  const confirmarEntrada = async () => {
    try { await confirmarEntradaQr(db.ctx, resultado); await reload(); setConfirmado(true); }
    catch (e) { alert(e?.message || e); }
  };
  const fecharLeitor = () => { setLeitor(false); setResultado(null); setConfirmado(false); };
  const agoraLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const icons = { visitante: User, prestador: Wrench, entrega: Package, recorrente: RefreshCw };
  return (
    <div className="vfade space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard t={t} icon={DoorOpen} label="Acessos registrados" value={String(S.acessosHoje)} />
        <StatCard t={t} icon={User} label="Visitantes no condomínio" value={String(S.visitantesDentro)} color={t.info} />
        <StatCard t={t} icon={Package} label="Entregas registradas" value={String(S.encomendas)} color={t.warn} />
        <StatCard t={t} icon={Car} label="Vagas de visitante livres" value={S.vagasVisitante} color={t.ok} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn t={t} kind="primary" onClick={() => setNovo(true)}><Plus size={15} /> Pré-autorizar entrada</Btn>
        <Btn t={t} kind="soft" onClick={() => setGerarQr(true)}><QrCode size={14} /> Gerar QR de acesso</Btn>
        <Btn t={t} kind="soft" onClick={() => setLeitor(true)}><Search size={14} /> {L("Ler QR de acesso")}</Btn>
        <Btn t={t} onClick={() => setOcorrencia(true)}><AlertCircle size={14} /> Registrar ocorrência</Btn>
        <Btn t={t} onClick={() => setEntrega(true)}><Package size={14} /> {L("Registrar entrega")}</Btn>
      </div>
      <Card t={t} pad={false}>
        <div className="border-b px-4 py-3 text-sm font-semibold" style={{ borderColor: t.borderSoft, fontFamily: "'Sora',sans-serif" }}>{L("Movimentação de hoje")}</div>
        <div>{db.acessos.map((a) => {
          const Ic = icons[a.tipo] || User;
          return (
            <div key={a.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-0" style={{ borderColor: t.borderSoft }}>
              <span className="w-12 text-xs font-semibold" style={{ color: t.gold, fontFamily: "'Sora',sans-serif" }}>{a.hora}</span>
              <div className="rounded-lg p-1.5" style={{ background: t.surface2 }}><Ic size={14} color={t.dim} /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{a.nome}</div>
                <div className="text-xs" style={{ color: t.dim }}>Destino: {a.destino} · via {a.via}</div>
              </div>
              <Badge t={t} s={a.status} />
            </div>);
        })}</div>
      </Card>
      {novo && (
        <Modal t={t} onClose={() => setNovo(false)}>
          <ModalHeader t={t} title="Pré-autorizar entrada" onClose={() => setNovo(false)} />
          <form onSubmit={salvar}>
            <div className="space-y-3">
              <Field t={t} label="Tipo"><select name="tipo" style={inputStyle(t)}><option>Visitante</option><option>Prestador de serviço</option><option>Entrega</option><option>Visitante recorrente</option></select></Field>
              <Field t={t} label="Nome / empresa"><input name="nome" required style={inputStyle(t)} /></Field>
              <Field t={t} label="E-mail do visitante (recebe o QR Code)"><input name="email" type="email" placeholder="visitante@email.com" style={inputStyle(t)} /></Field>
              <Field t={t} label="Unidade de destino"><select name="unidade" required style={inputStyle(t)}>{db.ctx.unidades.map((u)=><option key={u.id} value={u.id}>{u.labelResp}</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field t={t} label="Data"><input name="data" type="date" style={inputStyle(t)} /></Field>
                <Field t={t} label="Janela de horário"><input name="janela" placeholder="14h — 18h" style={inputStyle(t)} /></Field>
              </div>
              <Field t={t} label="Veículo (opcional)"><input name="placa" placeholder="Placa" style={inputStyle(t)} /></Field>
              <div className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.border, background: t.goldSoft, color: t.gold }}>
                O QR Code aparece na tela ao autorizar — envie ao visitante pelo e-mail informado; a portaria valida na entrada.</div>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setNovo(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={saving}><QrCode size={14} /> {saving ? "Autorizando…" : "Autorizar e gerar QR"}</Btn></div>
          </form>
        </Modal>)}
      {gerarQr && (
        <Modal t={t} onClose={() => setGerarQr(false)}>
          <ModalHeader t={t} title="Gerar QR de acesso" onClose={() => setGerarQr(false)} />
          <form onSubmit={gerar}>
            <div className="space-y-3">
              <Field t={t} label="Nome de quem vai acessar"><input name="nome" required style={inputStyle(t)} /></Field>
              <Field t={t} label="Unidade que irá acessar"><select name="unidade" required style={inputStyle(t)}>{db.ctx.unidades.map((u)=><option key={u.id} value={u.id}>{u.labelResp}</option>)}</select></Field>
              <Field t={t} label="Janela de horário (a partir de agora)">
                <select name="janela" style={inputStyle(t)}>
                  <option value="1h-2h">1h — 2h</option>
                  <option value="2h-5h">2h — 5h</option>
                  <option value="6h-9h">6h — 9h</option>
                </select></Field>
              <Field t={t} label="E-mail (opcional, para enviar o QR)"><input name="email" type="email" style={inputStyle(t)} /></Field>
              <div className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
                {L("Gerado em")}: <b style={{ color: t.text }}>{new Date().toLocaleString("pt-BR")}</b></div>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setGerarQr(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={gerando}><QrCode size={14} /> {gerando ? "Gerando…" : "Gerar QR de acesso"}</Btn></div>
          </form>
        </Modal>)}
      {qrView && (
        <Modal t={t} onClose={() => setQrView(null)}>
          <ModalHeader t={t} title="QR Code de acesso" onClose={() => setQrView(null)} />
          <div className="flex flex-col items-center gap-3 text-center">
            <QRReal value={qrView.codigo} />
            <div>
              <div className="text-sm font-semibold">{qrView.nome}</div>
              <div className="text-xs" style={{ color: t.dim }}>
                {L("Unidade")} {qrView.unidade} · {L("janela")} {qrView.janela}<br />
                {L("Gerado em")} {qrView.geradoEm} · {L("válido até")} {qrView.validaAte}</div>
            </div>
            <div className="w-full break-all rounded-lg px-3 py-2 text-[11px]" style={{ background: t.surface2, color: t.dim }}>{qrView.codigo}</div>
            <div className="flex flex-wrap justify-center gap-2">
              <Btn t={t} kind="soft" onClick={() => { navigator.clipboard?.writeText(qrView.codigo); }}><Check size={14} /> {L("Copiar código")}</Btn>
              {qrView.email && (
                <a className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: t.gold, color: "#131313" }}
                  href={`mailto:${qrView.email}?subject=${encodeURIComponent(`QR de acesso — ${db.cond?.nome || "Condomínio"}`)}&body=${encodeURIComponent(`Olá ${qrView.nome},\n\nApresente este código na portaria: ${qrView.codigo}\nUnidade: ${qrView.unidade}\nVálido até: ${qrView.validaAte}\n\n${db.cond?.nome || ""}`)}`}>
                  <Send size={14} /> {L("Enviar por e-mail")}</a>)}
            </div>
          </div>
        </Modal>)}
      {leitor && (
        <Modal t={t} onClose={fecharLeitor}>
          <ModalHeader t={t} title="Ler QR de acesso" onClose={fecharLeitor} />
          {!resultado ? (<>
            <LeitorQr t={t} onLer={lerCodigo} />
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); lerCodigo(new FormData(e.currentTarget).get("codigo")); }}>
              <input name="codigo" placeholder={L("Ou digite/cole o código do QR…")} style={{ ...inputStyle(t), flex: 1 }} />
              <Btn t={t} kind="primary" type="submit">{L("Validar")}</Btn>
            </form>
          </>) : (
            <div className="space-y-3">
              <div className="rounded-xl border px-4 py-3 text-center" style={{
                borderColor: resultado.permitido ? t.ok : t.danger,
                background: (resultado.permitido ? t.ok : t.danger) + "14",
                color: resultado.permitido ? t.ok : t.danger }}>
                <div className="text-lg font-bold" style={{ fontFamily: "'Sora',sans-serif" }}>
                  {resultado.permitido ? L("ACESSO PERMITIDO") : L("ACESSO NEGADO")}</div>
                {!resultado.permitido && <div className="text-xs">{resultado.motivo}</div>}
              </div>
              {resultado.nome && (
                <div className="grid grid-cols-1 gap-1.5 rounded-xl border p-3 text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
                  <div>{L("Nome")}: <b style={{ color: t.text }}>{resultado.nome}</b></div>
                  <div>{L("Tipo")}: <b style={{ color: t.text }}>{resultado.tipo}</b></div>
                  <div>{L("Unidade de destino")}: <b style={{ color: t.text }}>{resultado.unidade}</b></div>
                  <div>{L("Janela de validade")}: <b style={{ color: t.text }}>{resultado.janela}</b></div>
                </div>)}
              {confirmado && <div className="rounded-xl px-3 py-2 text-center text-xs" style={{ background: t.ok + "14", color: t.ok }}>{L("Entrada registrada na movimentação de hoje.")}</div>}
              <div className="flex justify-end gap-2">
                <Btn t={t} onClick={() => { setResultado(null); setConfirmado(false); }}>{L("Ler outro")}</Btn>
                {resultado.permitido && !confirmado && (
                  <Btn t={t} kind="primary" onClick={confirmarEntrada}><Check size={14} /> {L("Confirmar entrada")}</Btn>)}
                <Btn t={t} kind={confirmado ? "primary" : "ghost"} onClick={fecharLeitor}>{L("Fechar")}</Btn>
              </div>
            </div>)}
        </Modal>)}
      {ocorrencia && (
        <Modal t={t} onClose={() => setOcorrencia(false)}>
          <ModalHeader t={t} title="Registrar ocorrência" onClose={() => setOcorrencia(false)} />
          <form onSubmit={salvarOcorrencia}>
            <div className="space-y-3">
              <Field t={t} label="Título"><input name="titulo" required placeholder={L("Ex.: Portão da garagem aberto")} style={inputStyle(t)} /></Field>
              <Field t={t} label="Descrição do fato"><textarea name="descricao" required rows={3} style={{ ...inputStyle(t), resize: "vertical" }} /></Field>
              <Field t={t} label="Data e hora do ocorrido"><input name="quando" type="datetime-local" defaultValue={agoraLocal()} style={inputStyle(t)} /></Field>
              <div className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
                {L("Registro feito em")}: <b style={{ color: t.text }}>{new Date().toLocaleString("pt-BR")}</b></div>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setOcorrencia(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={salvandoOc}><AlertCircle size={14} /> {salvandoOc ? "Registrando…" : "Registrar ocorrência"}</Btn></div>
          </form>
        </Modal>)}
      {entrega && (
        <Modal t={t} onClose={() => setEntrega(false)}>
          <ModalHeader t={t} title="Registrar entrega" onClose={() => setEntrega(false)} />
          <form onSubmit={salvarEntrega}>
            <div className="space-y-3">
              <Field t={t} label="Nome do morador"><input name="morador" required style={inputStyle(t)} /></Field>
              <Field t={t} label="Unidade correspondente"><select name="unidade" style={inputStyle(t)}><option value="">—</option>{db.ctx.unidades.map((u)=><option key={u.id} value={u.id}>{u.labelResp}</option>)}</select></Field>
              <Field t={t} label="Data e hora da entrega"><input name="quando" type="datetime-local" defaultValue={agoraLocal()} style={inputStyle(t)} /></Field>
              <Field t={t} label="Observação (opcional)"><input name="obs" placeholder={L("Ex.: caixa dos Correios, retirada na portaria")} style={inputStyle(t)} /></Field>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setEntrega(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={salvandoEnt}><Package size={14} /> {salvandoEnt ? "Registrando…" : "Registrar entrega"}</Btn></div>
          </form>
        </Modal>)}
    </div>
  );
}

/* ══════════════ Gerenciar Acessos (exclusivo do diretor) ══════════════ */
function GerenciarEmails({ t }) {
  const { db } = useData();
  const unidades = db.ctx.unidades; // unidades cadastradas na tela Unidades
  const [usuarios, setUsuarios] = useState(null); // null = carregando do banco
  const [novo, setNovo] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [perfil, setPerfil] = useState("sindico");
  const perfis = ["sindico", "tesouraria", "morador"];

  const recarregar = useCallback(
    () => listarAcessos(db.ctx).then(setUsuarios).catch((e) => setErro(e.message)),
    [db.ctx]
  );
  useEffect(() => { recarregar(); }, [recarregar]);

  const salvar = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (f.senha.length < 4) return setErro("A senha deve ter pelo menos 4 caracteres.");
    if (f.perfil === "morador" && !f.unidade) return setErro("Cadastre unidades primeiro na tela Unidades.");
    setSalvando(true);
    try {
      await criarAcesso(db.ctx, f);
      await recarregar();
      setErro(""); setNovo(false);
    } catch (err) { setErro(err.message); }
    finally { setSalvando(false); }
  };
  const remover = async (u) => {
    if (!confirm(`Remover o acesso de ${u.nome || u.email}? Essa pessoa não conseguirá mais entrar.`)) return;
    try { await removerAcesso(u.id); await recarregar(); }
    catch (err) { setErro(err.message); }
  };

  return (
    <div className="vfade space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {perfis.map((r) => (
          <StatCard t={t} key={r} icon={PROFILES[r].icon} label={`Acessos de ${PROFILES[r].label}`}
            value={String((usuarios || []).filter((u) => u.role === r).length)} />))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs" style={{ color: t.dim }}>
          Os acessos criados aqui são o que cada pessoa usará na tela de entrada. Síndico e tesouraria entram com e-mail; o morador entra com o nome cadastrado.</div>
        <Btn t={t} kind="primary" onClick={() => { setErro(""); setNovo(true); }}><Plus size={15} /> Adicionar acesso</Btn>
      </div>
      {usuarios === null ? (
        <Skeleton t={t} />
      ) : usuarios.length ? (
        <div className="space-y-2">
          {usuarios.map((u) => (
            <Card t={t} key={u.id}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-xl p-2" style={{ background: t.goldSoft }}><Mail size={16} color={t.gold} /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{u.nome || u.email}</div>
                  <div className="text-xs" style={{ color: t.dim }}>{u.unidade ? `${L("Unidade")} ${u.unidade}` : (u.email && u.nome ? u.email : L("Senha protegida por criptografia"))}</div>
                </div>
                <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: t.goldSoft, color: t.gold }}>{PROFILES[u.role]?.label || u.role}</span>
                <Btn t={t} kind="danger" className="!px-2 !py-1 text-xs" onClick={() => remover(u)}><Trash2 size={13} /> Remover</Btn>
              </div>
            </Card>))}
        </div>
      ) : (
        <EmptyState t={t} icon={Mail} title="Nenhum acesso criado ainda"
          hint="Cadastre o primeiro e-mail e senha para que síndico, tesouraria e moradores consigam entrar."
          action={<Btn t={t} kind="primary" onClick={() => setNovo(true)}><Plus size={14} /> Adicionar acesso</Btn>} />)}
      <div className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
        Os acessos são gravados no banco de dados com senha criptografada — a pessoa consegue entrar de qualquer navegador.</div>
      {novo && (
        <Modal t={t} onClose={() => setNovo(false)}>
          <ModalHeader t={t} title="Novo acesso" onClose={() => setNovo(false)} />
          <form onSubmit={salvar}>
            <div className="space-y-3">
              <Field t={t} label="Perfil de acesso"><select name="perfil" value={perfil} onChange={(e) => { setPerfil(e.target.value); setErro(""); }} style={inputStyle(t)}>
                {perfis.map((r) => <option key={r} value={r}>{PROFILES[r].label}</option>)}</select></Field>
              {perfil === "morador" ? (
                <>
                  <Field t={t} label="Nome completo"><input name="nome" required placeholder="Nome que o morador usará para entrar" style={inputStyle(t)} /></Field>
                  <Field t={t} label="Unidade / apartamento">
                    {unidades.length ? (
                      <select name="unidade" required style={inputStyle(t)}>
                        {unidades.map((u) => <option key={u.id} value={u.label}>{u.labelResp}</option>)}
                      </select>
                    ) : (
                      <div className="flex h-[38px] items-center rounded-xl border border-dashed px-3 text-xs" style={{ borderColor: t.borderSoft, color: t.warn }}>
                        {L("Cadastre unidades primeiro na tela Unidades.")}</div>
                    )}
                  </Field>
                  <div className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.border, background: t.goldSoft, color: t.dim }}>
                    O morador entrará na tela inicial usando exatamente este nome e a senha abaixo, e verá os dados da unidade escolhida.</div>
                </>
              ) : (
                <Field t={t} label="E-mail"><input name="email" type="email" required placeholder="pessoa@exemplo.com" style={inputStyle(t)} /></Field>
              )}
              <Field t={t} label="Senha"><PasswordInput t={t} name="senha" required placeholder="Mínimo 4 caracteres" /></Field>
              {erro && <div className="text-xs" style={{ color: t.danger }}>{erro}</div>}
            </div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setNovo(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={salvando}><Check size={14} /> {salvando ? "Salvando…" : "Criar acesso"}</Btn></div>
          </form>
        </Modal>)}
    </div>
  );
}

/* ══════════════ PORTAL DO MORADOR ══════════════ */
function PortalMorador({ t, onLogout, dark, setDark, lang, onLang, morador }) {
  const { db, reload } = useData();
  /* recarregar mantém a aba do portal onde o morador estava */
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem("cm_tela_portal") || "inicio"; } catch { return "inicio"; } });
  useEffect(() => { try { sessionStorage.setItem("cm_tela_portal", tab); } catch { /* sem storage */ } }, [tab]);
  const [qr, setQr] = useState(null); const [chamado, setChamado] = useState(false);
  const [formaPag, setFormaPag] = useState(null); // null = escolhendo | "qr" | "verum" | "banco"
  const [aviso, setAviso] = useState(null); // comunicado aberto para leitura completa
  const [multa, setMulta] = useState(null); // multa aberta para ver os detalhes
  const [notifOpen, setNotifOpen] = useState(false);
  const [infoPredio, setInfoPredio] = useState(false); // modal com os dados do edifício + morador
  const [copiado, setCopiado] = useState(false);
  const [copiadoPag, setCopiadoPag] = useState(null); // qual meio de pagamento foi copiado
  /* unidade do morador logado (escolhida pelo diretor em Gerenciar Acessos); fallback: demo 102-A */
  const unidade = morador?.unidade || (db.unidades.find((u) => u.num === "102") ? "102-A" : (db.unidades[0] ? `${db.unidades[0].num}-${db.unidades[0].bloco}` : "—"));
  /* morador não abre chamado — apenas visualiza os existentes da unidade */
  /* ocorrências: o morador pode registrar e acompanhar as registradas */
  const [novaOcor, setNovaOcor] = useState(false);
  const [salvarOcor, salvandoOcor] = useSubmit(async (f) => { await registrarOcorrencia(db.ctx, f); await reload(); setNovaOcor(false); });
  const ocorrencias = db.acessos.filter((a) => a.status === "ocorrencia");
  /* entregas registradas na portaria para a unidade do morador */
  const minhasEntregas = db.acessos.filter((a) => a.tipo === "entrega" && a.destino === unidade);
  const agoraLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const boletos = morador?.unidade
    ? db.cobr.filter((c) => c.unidade === unidade).map((c) => ({ id: c.id, comp: c.comp, desc: "Taxa condominial", valor: c.valor, venc: c.vencFull, status: c.status }))
    : db.boletos;
  const pend = boletos.find((b) => b.status === "vencida") || boletos.find((b) => b.status === "emitida");
  const abertas = boletos.filter((b) => b.status === "vencida" || b.status === "emitida").length;
  const minhasMultasLista = db.multas.filter((m) => m.unidade === unidade);
  const minhasMultas = minhasMultasLista.filter((m) => m.status === "pendente").length;
  /* "minha situação" conta somente o que é da unidade do morador logado */
  const meusChamadosLista = db.chamados.filter((c) => c.unidade === unidade);
  const meusChamados = meusChamadosLista.filter((c) => c.status === "aberto" || c.status === "andamento").length;
  const minhasEncomendas = db.acessos.filter((a) => a.tipo === "entrega" && a.destino === unidade).length;
  /* notificações do sino: tudo o que pede atenção do morador, clicável */
  const notifs = useMemo(() => [
    ...boletos.filter((b) => b.status === "vencida").map((b) => ({ txt: `${L("Cobrança de")} ${b.comp} ${L("vencida")} — ${BRL(b.valor)}`, c: "danger", go: () => setTab("pagamentos") })),
    ...boletos.filter((b) => b.status === "emitida").map((b) => ({ txt: `${L("Nova cobrança de")} ${b.comp} — ${BRL(b.valor)} · ${L("vence em")} ${b.venc}`, c: "warn", go: () => setTab("pagamentos") })),
    ...minhasMultasLista.filter((m) => m.status === "pendente").map((m) => ({ txt: `${m.valor > 0 ? L("Multa") : L("Advertência")} ${m.num} — ${L("prazo de defesa até")} ${m.prazo}`, c: "warn", go: () => setMulta(m) })),
    ...meusChamadosLista.filter((c) => c.status === "aberto" || c.status === "andamento").map((c) => ({ txt: `${L("Chamada de manutenção")} ${c.num} ${c.status === "andamento" ? L("em andamento") : L("aberta")} — ${c.desc}`, c: "info" })),
    ...db.comunic.slice(0, 2).map((c) => ({ txt: `${L("Comunicado")}: ${c.titulo}`, c: "info", go: () => setAviso(c) })),
  ], [boletos, minhasMultasLista, meusChamadosLista, db.comunic]); // eslint-disable-line react-hooks/exhaustive-deps
  const textoEndereco = [db.cond?.nome, db.cond?.endereco, `${morador?.nome || L("Morador")} — ${L("Unidade")} ${unidade}`].filter(Boolean).join("\n");
  const copiarEndereco = async () => {
    try { await navigator.clipboard.writeText(textoEndereco); }
    catch { const ta = document.createElement("textarea"); ta.value = textoEndereco; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
    setCopiado(true); setTimeout(() => setCopiado(false), 1800);
  };
  const copiarPagamento = async (chave, texto) => {
    try { await navigator.clipboard.writeText(texto); }
    catch { const ta = document.createElement("textarea"); ta.value = texto; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
    setCopiadoPag(chave); setTimeout(() => setCopiadoPag(null), 1800);
  };
  const pagto = db.cond?.pagamentos || {};
  const bancoLinhas = [
    ["Titular", pagto.banco?.titular], ["Banco", pagto.banco?.banco], ["País", pagto.banco?.pais],
    ["IBAN", pagto.banco?.iban], ["SWIFT / BIC", pagto.banco?.swift], ["Conta", pagto.banco?.conta],
    ["Agência / roteamento", pagto.banco?.agencia], ["Observações", pagto.banco?.obs],
  ].filter(([, v]) => v);
  const aceitaDinheiro = !!pagto.dinheiro;
  const temMeiosPagamento = !!(pagto.verumWallet || bancoLinhas.length || aceitaDinheiro);
  const fecharPagar = () => { setQr(null); setFormaPag(null); };
  return (
    <div style={{ background: t.bg, color: t.text, minHeight: "100vh", fontFamily: "'Inter',system-ui,sans-serif" }}>
      <header className="sticky top-0 z-30 border-b px-4 py-3 backdrop-blur-md" style={{ background: t.glass, borderColor: t.borderSoft }}>
        <div className="mx-auto max-w-lg">
          <div className="flex items-start gap-2">
            <button onClick={() => setInfoPredio(true)} title={L("Dados do edifício")} className="shrink-0">
              {db.cond?.logoUrl
                ? <img src={db.cond.logoUrl} alt="Logo" className="h-9 w-9 rounded-xl object-contain" style={{ background: t.goldSoft }} />
                : <div className="flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold" style={{ background: t.goldSoft, color: t.gold, fontFamily: "'Sora',sans-serif" }}>
                    {(db.cond?.nome || "—").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("")}</div>}
            </button>
            <div className="flex-1" />
            <div className="relative">
              <button onClick={() => setNotifOpen((v) => !v)} className="relative rounded-lg p-2" style={{ background: t.surface2 }} title={L("Notificações")}>
                <Bell size={15} color={notifs.length ? t.gold : t.dim} />
                {notifs.length > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                    style={{ background: t.danger, color: "#fff" }}>{notifs.length}</span>)}
              </button>
              {notifOpen && (<>
                <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
                {/* mobile: painel fixo ocupando a largura da tela; ≥sm: dropdown ancorado no sino */}
                <div className="fixed inset-x-3 top-14 z-40 max-h-[70vh] overflow-y-auto rounded-2xl border p-2 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80 sm:max-w-[85vw]"
                  style={{ background: t.surface, borderColor: t.border }}>
                  <div className="px-2 py-1.5 text-xs font-semibold" style={{ color: t.dim, fontFamily: "'Sora',sans-serif" }}>{L("NOTIFICAÇÕES")}</div>
                  {notifs.length === 0 ? (
                    <div className="px-2 py-3 text-xs" style={{ color: t.dim }}>{L("Nenhuma notificação — tudo em dia!")}</div>
                  ) : notifs.map((n, i) => (
                    <button key={i} onClick={() => { setNotifOpen(false); n.go?.(); }}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:opacity-80">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t[n.c] }} />
                      <span className="min-w-0 flex-1 text-xs">{n.txt}</span>
                      {n.go && <ChevronRight size={13} color={t.dim} />}
                    </button>))}
                </div>
              </>)}
            </div>
            <LangSel t={t} lang={lang} onLang={onLang} />
            <button onClick={() => setDark(!dark)} className="rounded-lg p-2" style={{ background: t.surface2 }}>{dark ? <Sun size={15} color={t.gold} /> : <Moon size={15} color={t.gold} />}</button>
            <button onClick={onLogout} className="rounded-lg p-2" style={{ background: t.surface2 }} title={L("Sair")}><LogOut size={15} color={t.dim} /></button>
          </div>
          {/* nome do edifício, morador e unidade abaixo do ícone — texto completo, sem truncar */}
          <div className="mt-1.5 break-words">
            <div className="text-sm font-semibold" style={{ fontFamily: "'Sora',sans-serif" }}>{db.cond?.nome || "—"}</div>
            <div className="text-xs" style={{ color: t.dim }}>{morador?.nome || L("Morador")} · {L("Unidade")} {unidade}</div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-5 pb-28">
        {tab === "inicio" && (
          <div className="vfade space-y-4">
            {pend && (
              <Card t={t} className="border-l-4" >
                <div className="flex items-center gap-3">
                  <AlertCircle size={20} color={pend.status === "vencida" ? t.danger : t.gold} />
                  <div className="flex-1">
                    <div className="text-sm font-semibold">
                      {pend.status === "vencida" ? `${L("Cobrança de")} ${pend.comp} ${L("vencida")}` : `${L("Nova cobrança de")} ${pend.comp}`}</div>
                    <div className="text-xs" style={{ color: t.dim }}>{BRL(pend.valor)} · {pend.status === "vencida" ? L("venceu em") : L("vence em")} {pend.venc}</div>
                  </div>
                  <Btn t={t} kind="primary" onClick={() => setQr(pend)}><QrCode size={14} /> Pagar</Btn>
                </div>
              </Card>)}
            <div className="grid grid-cols-2 gap-3">
              {[["Transferência e QR", QrCode, "pagamentos"], ["Extrato", Wallet, "pagamentos"], ["Entregas", Package, "entregas"], ["Chamada de manutenções", Wrench, null]].map(([l, Ic, dest]) => (
                <button key={l} onClick={() => dest ? setTab(dest) : setChamado(true)}
                  className="vhover rounded-2xl border p-4 text-left" style={{ background: t.surface, borderColor: t.borderSoft }}>
                  <Ic size={18} color={t.gold} /><div className="mt-2 text-sm font-semibold">{L(l)}</div>
                </button>))}
            </div>
            <Card t={t}>
              <SectionTitle t={t}>Últimos comunicados</SectionTitle>
              <div className="space-y-2 text-sm">{db.comunic.slice(0, 2).map((c) => (
                <button key={c.id} onClick={() => setAviso(c)} className="block w-full rounded-xl px-3 py-2 text-left" style={{ background: t.surface2, color: t.text }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{c.titulo}</div>
                      <div className="text-xs" style={{ color: t.dim }}>{c.data} · {L("Toque para ler")}</div>
                    </div>
                    <ChevronRight size={15} color={t.dim} />
                  </div>
                </button>))}</div>
            </Card>
            <Card t={t}>
              <SectionTitle t={t}>Minha situação</SectionTitle>
              <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: t.dim }}>
                <div>Multas ativas: <b style={{ color: minhasMultas ? t.warn : t.text }}>{minhasMultas ? `${minhasMultas} em prazo de defesa` : "nenhuma"}</b></div>
                <div>Vagas: <b style={{ color: t.text }}>{db.unidades.find((u) => `${u.num}-${u.bloco}` === unidade)?.vagas ?? 0}</b></div>
                <div>Encomendas: <b style={{ color: t.gold }}>{minhasEncomendas} registrada(s)</b></div>
                <div>Chamadas de manutenção: <b style={{ color: t.text }}>{meusChamados}</b></div>
              </div>
              {minhasMultasLista.length > 0 && (<>
                <div className="mb-1.5 mt-3 text-xs font-semibold" style={{ color: t.dim }}>{L("MULTAS DA UNIDADE")}</div>
                <div className="space-y-2 text-sm">{minhasMultasLista.map((m) => (
                  <button key={m.id} onClick={() => setMulta(m)} className="block w-full rounded-xl px-3 py-2 text-left" style={{ background: t.surface2, color: t.text }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{m.categoria}</div>
                        <div className="text-xs" style={{ color: t.dim }}>{m.num} · {m.data}{m.valor ? ` · ${BRL(m.valor)}` : ""} · {L("Toque para ler")}</div>
                      </div>
                      <Badge t={t} s={m.status} />
                    </div>
                  </button>))}</div>
              </>)}
              {meusChamadosLista.length > 0 && (<>
                <div className="mb-1.5 mt-3 text-xs font-semibold" style={{ color: t.dim }}>{L("CHAMADA DE MANUTENÇÕES")}</div>
                <div className="space-y-2 text-sm">{meusChamadosLista.map((c) => (
                  <div key={c.id} className="rounded-xl px-3 py-2" style={{ background: t.surface2, color: t.text }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{c.desc}</div>
                        <div className="text-xs" style={{ color: t.dim }}>{c.num} · {c.cat} · {L("aberto em")} {c.aberto}</div>
                      </div>
                      <Badge t={t} s={c.status} />
                    </div>
                  </div>))}</div>
              </>)}
            </Card>
          </div>)}
        {tab === "pagamentos" && (
          <div className="vfade space-y-2">
            <SectionTitle t={t}>{L("Cobranças da unidade")} {unidade}</SectionTitle>
            {boletos.length === 0 && <div className="rounded-xl border border-dashed p-4 text-center text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
              {L("Nenhuma cobrança para esta unidade ainda.")}</div>}
            {boletos.map((b) => (
              <Card t={t} key={b.id}>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{b.desc} · {b.comp}</div>
                    <div className="text-xs" style={{ color: t.dim }}>Vencimento {b.venc}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold" style={{ fontFamily: "'Sora',sans-serif" }}>{BRL(b.valor)}</div>
                    <Badge t={t} s={b.status} />
                  </div>
                  {b.status !== "pago"
                    ? <Btn t={t} kind="primary" className="!px-2.5" onClick={() => setQr(b)}><QrCode size={14} /></Btn>
                    : <Btn t={t} className="!px-2.5" title="Baixar comprovante"><Download size={14} /></Btn>}
                </div>
              </Card>))}
            {temMeiosPagamento && (<>
              <div className="pt-3"><SectionTitle t={t}>{L("Meios de pagamento")}</SectionTitle></div>
              {pagto.verumWallet && (
                <Card t={t}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: t.goldSoft }}>
                      <Wallet size={16} color={t.gold} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{L("Cripto ativos")} · <a href="https://verumcrypto.com" target="_blank" rel="noreferrer" style={{ color: t.gold, textDecoration: "underline" }}>Verum Wallet</a></div>
                      <div className="break-all font-mono text-xs" style={{ color: t.dim }}>{pagto.verumWallet}</div>
                      <div className="mt-1 text-[11px]" style={{ color: t.dim }}>
                        {L("Ainda não tem a carteira?")}{" "}
                        <a href="https://verumcrypto.com" target="_blank" rel="noreferrer" style={{ color: t.gold, textDecoration: "underline" }}>{L("Baixe a Verum Wallet e crie a sua")}</a>.
                      </div>
                    </div>
                    <Btn t={t} className="!px-2.5" title={L("Copiar chave")} onClick={() => copiarPagamento("verum", pagto.verumWallet)}>
                      {copiadoPag === "verum" ? <Check size={14} /> : <Copy size={14} />}</Btn>
                  </div>
                </Card>)}
              {bancoLinhas.length > 0 && (
                <Card t={t}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: t.goldSoft }}>
                      <Building2 size={16} color={t.gold} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{L("Transferência bancária")}</div>
                      <div className="mt-0.5 space-y-0.5">
                        {bancoLinhas.map(([k, v]) => (
                          <div key={k} className="break-words text-xs"><span style={{ color: t.dim }}>{L(k)}: </span>{v}</div>))}
                      </div>
                    </div>
                    <Btn t={t} className="!px-2.5" title={L("Copiar dados")}
                      onClick={() => copiarPagamento("banco", bancoLinhas.map(([k, v]) => `${L(k)}: ${v}`).join("\n"))}>
                      {copiadoPag === "banco" ? <Check size={14} /> : <Copy size={14} />}</Btn>
                  </div>
                </Card>)}
              {aceitaDinheiro && (
                <Card t={t}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: t.goldSoft }}>
                      <Banknote size={16} color={t.gold} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{L("Pagamento em dinheiro")}</div>
                      <div className="text-xs" style={{ color: t.dim }}>{L("Pague presencialmente na administração do condomínio e peça o recibo.")}</div>
                    </div>
                  </div>
                </Card>)}
              <div className="text-[11px]" style={{ color: t.dim }}>
                {L("Após pagar por um destes meios, envie o comprovante à administração para baixa da cobrança.")}</div>
            </>)}
          </div>)}
        {tab === "comunicados" && (
          <div className="vfade space-y-2">
            <SectionTitle t={t}>Comunicados</SectionTitle>
            {db.comunic.map((c) => (
              <Card t={t} key={c.id} onClick={() => setAviso(c)} className="cursor-pointer">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{c.titulo}</div>
                    <div className="text-xs" style={{ color: t.dim }}>{c.tipo} · {c.data} · {L("Toque para ler")}</div>
                  </div>
                  <ChevronRight size={15} color={t.dim} />
                </div>
              </Card>))}
          </div>)}
        {tab === "entregas" && (
          <div className="vfade space-y-2">
            <SectionTitle t={t}>{L("Entregas da unidade")} {unidade}</SectionTitle>
            {minhasEntregas.length === 0 && <div className="rounded-xl border border-dashed p-4 text-center text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
              {L("Nenhuma entrega registrada para a sua unidade ainda.")}</div>}
            {minhasEntregas.map((e) => (
              <Card t={t} key={e.id}>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: t.goldSoft }}>
                    <Package size={16} color={t.gold} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{e.nome}</div>
                    <div className="text-xs" style={{ color: t.dim }}>{e.data} · {e.hora}{e.via && e.via !== "Portaria" ? ` · ${e.via}` : ""}</div>
                  </div>
                  <Badge t={t} s={e.status} />
                </div>
              </Card>))}
            <div className="text-[11px]" style={{ color: t.dim }}>
              {L("Entregas são registradas pela portaria — retire a sua apresentando um documento.")}</div>
          </div>)}
        {tab === "ocorrencias" && (
          <div className="vfade space-y-2">
            <SectionTitle t={t} action={<Btn t={t} kind="primary" onClick={() => setNovaOcor(true)}><Plus size={14} /> {L("Registrar")}</Btn>}>Ocorrências</SectionTitle>
            {ocorrencias.length === 0 && <div className="rounded-xl border border-dashed p-4 text-center text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
              {L("Nenhuma ocorrência registrada ainda. Toque em Registrar para relatar algo à administração.")}</div>}
            {ocorrencias.map((o) => (
              <Card t={t} key={o.id}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{o.nome}</div>
                    <div className="text-xs" style={{ color: t.dim }}>{o.data} · {o.hora}{o.via && o.via !== o.nome ? ` · ${o.via}` : ""}</div>
                  </div>
                  <Badge t={t} s="ocorrencia" />
                </div>
              </Card>))}
            <div className="text-[11px]" style={{ color: t.dim }}>
              {L("As ocorrências registradas ficam visíveis para a administração e a portaria.")}</div>
          </div>)}
      </main>
      {/* navegação inferior mobile-first */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t px-4 py-2 backdrop-blur-md" style={{ background: t.glass, borderColor: t.borderSoft }}>
        <div className="mx-auto flex max-w-lg justify-around">
          {[["inicio","Início",Home],["pagamentos","Pagamentos",QrCode],["comunicados","Avisos",Megaphone],["ocorrencias","Ocorrências",AlertCircle]].map(([k,l,Ic]) => (
            <button key={k} onClick={() => setTab(k)} className="relative flex flex-col items-center gap-0.5 rounded-lg px-4 py-1.5 text-[10px] font-medium"
              style={{ color: tab === k ? t.gold : t.dim }}>
              <Ic size={18} /> {L(l)}
              {k === "pagamentos" && abertas > 0 && (
                <span className="absolute -top-1 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold"
                  style={{ background: t.danger, color: "#fff" }}>{abertas}</span>)}
            </button>))}
        </div>
      </nav>
      {infoPredio && (
        <Modal t={t} onClose={() => setInfoPredio(false)}>
          <ModalHeader t={t} title="Dados do edifício" onClose={() => setInfoPredio(false)} />
          <div className="flex items-center gap-3">
            {db.cond?.logoUrl
              ? <img src={db.cond.logoUrl} alt="Logo" className="h-12 w-12 rounded-xl object-contain" style={{ background: t.goldSoft }} />
              : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold" style={{ background: t.goldSoft, color: t.gold, fontFamily: "'Sora',sans-serif" }}>
                  {(db.cond?.nome || "—").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("")}</div>}
            <div className="min-w-0">
              <div className="break-words text-sm font-bold" style={{ fontFamily: "'Sora',sans-serif" }}>{db.cond?.nome || "—"}</div>
              {db.cond?.cnpj && <div className="text-xs" style={{ color: t.dim }}>CNPJ {db.cond.cnpj}</div>}
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-start gap-2 rounded-xl border px-3 py-2" style={{ borderColor: t.borderSoft, background: t.surface2 }}>
              <MapPin size={15} color={t.gold} className="mt-0.5 shrink-0" />
              <span className="break-words">{db.cond?.endereco || L("Endereço não cadastrado")}</span>
            </div>
            <div className="flex items-start gap-2 rounded-xl border px-3 py-2" style={{ borderColor: t.borderSoft, background: t.surface2 }}>
              <User size={15} color={t.gold} className="mt-0.5 shrink-0" />
              <span className="break-words">{morador?.nome || L("Morador")} — {L("Unidade")} {unidade}</span>
            </div>
            {db.cond?.sindico && (
              <div className="flex items-start gap-2 rounded-xl border px-3 py-2" style={{ borderColor: t.borderSoft, background: t.surface2 }}>
                <ShieldCheck size={15} color={t.gold} className="mt-0.5 shrink-0" />
                <span className="break-words">{L("Síndico")}: {db.cond.sindico}</span>
              </div>)}
          </div>
          <div className="mt-2 text-[11px]" style={{ color: t.dim }}>
            {L("Use o botão abaixo para copiar o endereço e compartilhar com visitas e entregas.")}</div>
          <div className="mt-4 flex justify-end gap-2">
            <Btn t={t} onClick={() => setInfoPredio(false)}>Fechar</Btn>
            <Btn t={t} kind="primary" onClick={copiarEndereco}>
              {copiado ? <><CheckCircle2 size={14} /> {L("Copiado!")}</> : <><Copy size={14} /> {L("Copiar endereço")}</>}</Btn>
          </div>
        </Modal>)}
      {qr && (
        <Modal t={t} onClose={fecharPagar}>
          <ModalHeader t={t} title={formaPag === null ? L("Forma de pagamento") : `${L("Pagar")} ${qr.desc} — ${qr.comp}`} onClose={fecharPagar} />
          {formaPag === null && (
            <div className="space-y-2">
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ fontFamily: "'Sora',sans-serif", color: t.gold }}>{BRL(qr.valor)}</div>
                <div className="text-xs" style={{ color: t.dim }}>{qr.desc} · {qr.comp} · {L("vencimento")} {qr.venc}</div>
              </div>
              <div className="pt-1 text-xs" style={{ color: t.dim }}>{L("Escolha como deseja pagar:")}</div>
              {!temMeiosPagamento && (
                <div className="rounded-xl border border-dashed p-4 text-center text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
                  {L("O condomínio ainda não cadastrou meios de pagamento. Fale com a administração.")}</div>)}
              {[
                ["qr", "QR Verum Pay", QrCode, !!pagto.verumWallet],
                ["verum", "Cripto ativos · Verum Wallet", Wallet, !!pagto.verumWallet],
                ["banco", "Transferência bancária", Building2, bancoLinhas.length > 0],
                ["dinheiro", "Pagamento em dinheiro", Banknote, aceitaDinheiro],
              ].filter(([, , , tem]) => tem).map(([k, l, Ic]) => (
                <button key={k} type="button" onClick={() => setFormaPag(k)}
                  className="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left hover:opacity-90"
                  style={{ borderColor: t.borderSoft, background: t.surface2 }}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: t.goldSoft }}>
                    <Ic size={16} color={t.gold} /></span>
                  <span className="flex-1 text-sm font-medium">{L(l)}</span>
                  <ChevronRight size={15} color={t.dim} />
                </button>))}
            </div>)}
          {formaPag === "qr" && (
            <div className="flex flex-col items-center gap-3 text-center">
              {/* QR dinâmico: chave pública da carteira do condomínio + valor desta cobrança */}
              <QRReal value={`verum:${pagto.verumWallet}?amount=${Number(qr.valor).toFixed(2)}&currency=${db.cond?.moeda || "USD"}&ref=${qr.id}`} size={180} />
              <div className="text-2xl font-bold" style={{ fontFamily: "'Sora',sans-serif", color: t.gold }}>{BRL(qr.valor)}</div>
              <div className="text-xs" style={{ color: t.dim }}>{L("Escaneie com a")}{" "}<a href="https://verumcrypto.com" target="_blank" rel="noreferrer" style={{ color: t.gold, textDecoration: "underline" }}>Verum Wallet</a>{" "}{L("para pagar — o QR já contém a carteira do condomínio e o valor desta cobrança.")}</div>
              <div className="flex flex-wrap justify-center gap-2">
                <Btn t={t} onClick={() => setFormaPag(null)}><ChevronLeft size={14} /> {L("Voltar")}</Btn>
                {pagto.verumWallet && (
                  <Btn t={t} kind="soft" onClick={() => copiarPagamento("qr:chave", pagto.verumWallet)}>
                    {copiadoPag === "qr:chave" ? <Check size={14} /> : <Copy size={14} />} {L("Copiar chave")}</Btn>)}
              </div>
            </div>)}
          {formaPag === "dinheiro" && (
            <div className="space-y-2">
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ fontFamily: "'Sora',sans-serif", color: t.gold }}>{BRL(qr.valor)}</div>
                <div className="text-xs" style={{ color: t.dim }}>{qr.desc} · {qr.comp} · {L("vencimento")} {qr.venc}</div>
              </div>
              <div className="rounded-xl border px-3 py-3 text-xs leading-relaxed" style={{ borderColor: t.borderSoft, background: t.surface2 }}>
                {L("Pague em dinheiro presencialmente na administração do condomínio, dentro do horário de atendimento. Exija o recibo no ato do pagamento — ele é o seu comprovante para a baixa da cobrança.")}</div>
              <div className="flex justify-between pt-1">
                <Btn t={t} onClick={() => setFormaPag(null)}><ChevronLeft size={14} /> {L("Voltar")}</Btn>
                <Btn t={t} kind="primary" onClick={fecharPagar}><Check size={14} /> {L("Concluir")}</Btn>
              </div>
            </div>)}
          {(formaPag === "verum" || formaPag === "banco") && (
            <div className="space-y-2">
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ fontFamily: "'Sora',sans-serif", color: t.gold }}>{BRL(qr.valor)}</div>
                <div className="text-xs" style={{ color: t.dim }}>
                  {formaPag === "verum"
                    ? <>{L("Envie o valor para a carteira")}{" "}<a href="https://verumcrypto.com" target="_blank" rel="noreferrer" style={{ color: t.gold, textDecoration: "underline" }}>Verum Wallet</a>{" "}{L("do condomínio:")}</>
                    : L("Transfira o valor usando os dados abaixo:")}
                </div>
              </div>
              {(formaPag === "verum"
                ? [["Chave pública da carteira", pagto.verumWallet]]
                : bancoLinhas
              ).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: t.borderSoft, background: t.surface2 }}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold uppercase" style={{ color: t.dim }}>{L(k)}</div>
                    <div className={`break-words text-xs font-medium ${formaPag === "verum" ? "break-all font-mono" : ""}`}>{v}</div>
                  </div>
                  <Btn t={t} className="!px-2" title={L("Copiar")} onClick={() => copiarPagamento("pagar:" + k, v)}>
                    {copiadoPag === "pagar:" + k ? <Check size={13} /> : <Copy size={13} />}</Btn>
                </div>))}
              {formaPag === "verum" && (
                <div className="text-[11px]" style={{ color: t.dim }}>
                  {L("Ainda não tem a carteira?")}{" "}
                  <a href="https://verumcrypto.com" target="_blank" rel="noreferrer" style={{ color: t.gold, textDecoration: "underline" }}>{L("Baixe a Verum Wallet e crie a sua")}</a>.
                </div>)}
              <div className="rounded-xl border px-3 py-2 text-[11px]" style={{ borderColor: t.borderSoft, color: t.dim }}>
                {L("Após pagar, envie o comprovante à administração para baixa da cobrança.")}</div>
              <div className="flex justify-between pt-1">
                <Btn t={t} onClick={() => setFormaPag(null)}><ChevronLeft size={14} /> {L("Voltar")}</Btn>
                <Btn t={t} kind="primary" onClick={fecharPagar}><Check size={14} /> {L("Concluir")}</Btn>
              </div>
            </div>)}
        </Modal>)}
      {multa && (
        <Modal t={t} onClose={() => setMulta(null)}>
          <ModalHeader t={t} title={`${multa.valor > 0 ? L("Multa") : L("Advertência")} ${multa.num}`} onClose={() => setMulta(null)} />
          <div className="mb-3 flex flex-wrap items-center gap-2"><Badge t={t} s={multa.status} />
            <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: t.goldSoft, color: t.gold }}>{multa.categoria}</span></div>
          <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: t.dim }}>
            <div>{L("Data")}: <b style={{ color: t.text }}>{multa.data}</b></div>
            {multa.valor > 0 && <div>{L("Valor")}: <b style={{ color: t.text }}>{BRL(multa.valor)}</b></div>}
            {multa.prazo !== "—" && <div>{L("Prazo para defesa")}: <b style={{ color: t.warn }}>{multa.prazo}</b></div>}
            <div>{L("Base normativa")}: <b style={{ color: t.text }}>{multa.base || "—"}</b></div>
          </div>
          {multa.descricao && <p className="mt-3 text-sm leading-relaxed" style={{ whiteSpace: "pre-wrap" }}>{multa.descricao}</p>}
          {multa.status === "pendente" && (
            <div className="mt-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.warn + "55", background: t.warn + "12", color: t.warn }}>
              {L("Você pode apresentar defesa até")} {multa.prazo}. {L("Procure a administração do condomínio.")}</div>)}
          <div className="mt-5 flex justify-end"><Btn t={t} onClick={() => setMulta(null)}>Fechar</Btn></div>
        </Modal>)}
      {aviso && (
        <Modal t={t} onClose={() => setAviso(null)}>
          <ModalHeader t={t} title={aviso.titulo} onClose={() => setAviso(null)} />
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs" style={{ color: t.dim }}>
            <span className="rounded-full px-2 py-0.5" style={{ background: t.goldSoft, color: t.gold }}>{aviso.tipo}</span>
            <span>{aviso.data}</span>
          </div>
          <p className="text-sm leading-relaxed" style={{ whiteSpace: "pre-wrap" }}>{aviso.corpo || aviso.titulo}</p>
          <div className="mt-5 flex justify-end"><Btn t={t} onClick={() => setAviso(null)}>Fechar</Btn></div>
        </Modal>)}
      {chamado && (
        <Modal t={t} onClose={() => setChamado(false)}>
          <ModalHeader t={t} title="Chamada de manutenções" onClose={() => setChamado(false)} />
          {meusChamadosLista.length === 0 ? (
            <div className="rounded-xl border border-dashed p-4 text-center text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
              {L("Nenhuma chamada de manutenção registrada para a sua unidade.")}</div>
          ) : (
            <div className="space-y-2 text-sm">{meusChamadosLista.map((c) => (
              <div key={c.id} className="rounded-xl px-3 py-2" style={{ background: t.surface2, color: t.text }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.desc}</div>
                    <div className="text-xs" style={{ color: t.dim }}>{c.num} · {c.cat} · {L("aberto em")} {c.aberto}</div>
                  </div>
                  <Badge t={t} s={c.status} />
                </div>
              </div>))}</div>
          )}
          <div className="mt-3 rounded-xl border px-3 py-2 text-[11px]" style={{ borderColor: t.borderSoft, color: t.dim }}>
            {L("A abertura de chamados é feita pela administração — procure a portaria ou o síndico para registrar uma solicitação.")}</div>
          <div className="mt-5 flex justify-end"><Btn t={t} onClick={() => setChamado(false)}>Fechar</Btn></div>
        </Modal>)}
      {novaOcor && (
        <Modal t={t} onClose={() => setNovaOcor(false)}>
          <ModalHeader t={t} title="Registrar ocorrência" onClose={() => setNovaOcor(false)} />
          <form onSubmit={salvarOcor}>
            <div className="space-y-3">
              <Field t={t} label="Título"><input name="titulo" required placeholder={L("Ex.: Barulho na área da piscina")} style={inputStyle(t)} /></Field>
              <Field t={t} label="Descrição"><textarea name="descricao" rows={3} placeholder={L("Descreva o que aconteceu")} style={{ ...inputStyle(t), resize: "vertical" }} /></Field>
              <Field t={t} label="Data e hora"><input name="quando" type="datetime-local" defaultValue={agoraLocal()} style={inputStyle(t)} /></Field>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setNovaOcor(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={salvandoOcor}><Check size={14} /> {salvandoOcor ? "Salvando…" : "Registrar ocorrência"}</Btn></div>
          </form>
        </Modal>)}
    </div>
  );
}

/* ══════════════ PAYWALL — LICENÇA SAAS ══════════════
/* ══════════════ PLANOS — GERENCIAR ASSINATURA (só o diretor vê) ══════════════
   Mostra o plano contratado e permite upgrade/downgrade e a escolha do ciclo
   de pagamento (mensal ou anual). A troca grava o novo plano no banco e abre
   o checkout Commet do novo valor; a confirmação chega pelo webhook. */
const EXTENSAO_TESTE_HABILITADA = false; // oferta de +30 dias de teste desativada temporariamente
function Planos({ t }) {
  const { db, reload } = useData();
  const tenant = (db.tenants || []).find((x) => x.id === db.ctx.condominioId);
  const [planos, setPlanos] = useState(null);
  const [ciclo, setCiclo] = useState("mensal");
  const [agindo, setAgindo] = useState(null); // nome do plano em processamento
  const [verificando, setVerificando] = useState(false);
  useEffect(() => { listarPlanos().then(setPlanos).catch(() => setPlanos([])); }, []);
  const preco = (p) => (ciclo === "anual" && Number(p.preco_anual) > 0 ? Number(p.preco_anual) : Number(p.preco_mensal));
  const atual = (planos || []).find((p) => p.nome === tenant?.plano);
  const licencaAtiva = tenant?.status === "ativo";
  const emTeste = tenant?.status === "teste" && !!tenant?.testeFim; // teste gratuito em andamento
  /* cancelamento agendado: o acesso segue até acesso_ate; o webhook marca
     "cancelada" quando o período termina (aí o paywall assume) */
  const cancelamentoAgendado = !!tenant?.canceladoEm && (licencaAtiva || emTeste);
  const dBR = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
  const [estendendo, setEstendendo] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const cancelar = async () => {
    if (!window.confirm(L("Cancelar a assinatura? O acesso continua até o fim do período já pago e nenhuma cobrança futura será feita."))) return;
    setCancelando(true);
    try {
      const resp = await cancelarAssinaturaCommet(db.ctx.condominioId);
      alert(resp?.fimAcesso
        ? `${L("Cancelamento agendado — o acesso continua até")} ${resp.fimAcesso.split("-").reverse().join("/")}.`
        : L("Assinatura cancelada."));
      await reload();
    } catch (err) { alert("Não foi possível cancelar: " + (err?.message || err)); }
    finally { setCancelando(false); }
  };
  const estender = async () => {
    if (!window.confirm(L("Estender o teste gratuito por mais 30 dias? Esta extensão só pode ser usada uma vez."))) return;
    setEstendendo(true);
    try {
      const resp = await estenderTesteCommet(db.ctx.condominioId);
      if (resp?.checkoutUrl) window.open(resp.checkoutUrl, "_blank", "noopener"); // cartão precisa de reconfirmação
      await reload();
    } catch (err) { alert("Não foi possível estender o teste: " + (err?.message || err)); }
    finally { setEstendendo(false); }
  };
  const contratar = async (p) => {
    const troca = !!atual && p.nome !== atual.nome;
    /* changePlan durante o trial converte o teste e cobra na hora — espelho do 409 do backend */
    if (troca && emTeste) { alert(L("A troca de plano durante o teste gratuito é cobrada imediatamente — aguarde o fim do teste para trocar.")); return; }
    if (troca && !window.confirm(`${L("Trocar o plano de")} ${atual.nome} ${L("para")} ${p.nome} (${USD(preco(p))}/${ciclo === "anual" ? L("ano") : L("mês")})? ${L("O checkout do novo valor será aberto em seguida.")}`)) return;
    setAgindo(p.nome);
    try {
      if (troca) await trocarPlanoLicenca(db.ctx.condominioId, p.nome);
      const resp = await assinarLicencaCommet(db.ctx.condominioId, ciclo, troca || licencaAtiva);
      if (resp?.checkoutUrl) window.open(resp.checkoutUrl, "_blank", "noopener");
      else if (resp?.trocaAplicada) alert(resp.agendadaPara
        ? `${L("Troca de plano agendada — o novo plano vale a partir de")} ${resp.agendadaPara.slice(0, 10)}.`
        : L("Troca de plano aplicada na assinatura atual — sem novo checkout; a anterior foi substituída automaticamente."));
      await reload();
    } catch (err) { alert("Não foi possível abrir o checkout: " + (err?.message || err)); }
    finally { setAgindo(null); }
  };
  const verificar = async () => {
    setVerificando(true);
    try { await verificarLicencaCommet(db.ctx.condominioId); await reload(); }
    finally { setVerificando(false); }
  };
  if (planos === null) return <div className="vfade text-xs" style={{ color: t.dim }}>{L("Carregando planos…")}</div>;
  return (
    <div className="vfade max-w-3xl space-y-4">
      <Card t={t} className="p-5">
        <SectionTitle t={t} action={<Btn t={t} disabled={verificando} onClick={verificar}><RefreshCw size={13} /> {verificando ? "Verificando…" : L("Verificar pagamento")}</Btn>}>
          Plano contratado</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: t.goldSoft }}><Star size={18} color={t.gold} /></div>
          <div className="flex-1">
            <div className="text-base font-bold" style={{ fontFamily: "'Sora',sans-serif" }}>{tenant?.plano || "—"}</div>
            <div className="text-xs" style={{ color: t.dim }}>
              {tenant?.precoPlano ? `${USD(tenant.precoPlano)}/${L("mês")}` : "—"}
              {tenant?.precoPlanoAnual > 0 && ` · ${USD(tenant.precoPlanoAnual)}/${L("ano")}`}
              {tenant?.venc !== "—" && ` · ${L("renova em")} ${tenant.venc}`}
            </div>
          </div>
          {tenant && <Badge t={t} s={tenant.status} />}
        </div>
        {cancelamentoAgendado ? (
          <div className="mt-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.danger + "55", background: t.danger + "12", color: t.danger }}>
            <AlertCircle size={13} className="mr-1 inline" />
            {L("Assinatura cancelada em")} <b>{dBR(tenant.canceladoEm)}</b> — {L("o acesso será desativado em")} <b>{dBR(tenant.acessoAte)}</b>. {L("Nenhuma cobrança futura será feita.")}</div>
        ) : emTeste ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.warn + "55", background: t.warn + "12", color: t.warn }}>
            <AlertCircle size={13} className="inline" />
            <span>{L("Teste gratuito — termina em")} <b>{Math.max(0, tenant.diasTeste)} {L("dia(s)")}</b>. {L("Depois, a cobrança é feita automaticamente no cartão cadastrado.")}</span>
            {EXTENSAO_TESTE_HABILITADA && !tenant.testeEstendido && tenant.diasTeste <= 5 && (
              /* a extensão só é oferecida nos últimos 5 dias do teste —
                 antes disso o botão fica invisível */
              <Btn t={t} className="!px-2 !py-1 text-xs" disabled={estendendo} onClick={estender}>
                <Plus size={12} /> {estendendo ? "Estendendo…" : L("Estender teste por +30 dias")}</Btn>)}
          </div>
        ) : !licencaAtiva && (
          <div className="mt-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.warn + "55", background: t.warn + "12", color: t.warn }}>
            <AlertCircle size={13} className="mr-1 inline" /> {L("A licença ainda não está ativa — escolha o ciclo abaixo e conclua o pagamento do plano contratado.")}</div>)}
      </Card>
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: t.dim }}>{L("Ciclo de pagamento:")}</span>
        {[["mensal", "Mensal"], ["anual", "Anual"]].map(([k, l]) => (
          <button key={k} onClick={() => setCiclo(k)} className="rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: ciclo === k ? t.goldSoft : "transparent", color: ciclo === k ? t.gold : t.dim, border: `1px solid ${ciclo === k ? t.border : t.borderSoft}` }}>{L(l)}</button>))}
        <span className="text-[11px]" style={{ color: t.dim }}>{L("Cobrança em dólar (USD)")} · Commet</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {planos.map((p) => {
          const ehAtual = p.nome === tenant?.plano;
          const upgrade = atual ? preco(p) > preco(atual) : true;
          return (
            <Card t={t} key={p.nome}>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold" style={{ fontFamily: "'Sora',sans-serif" }}>{p.nome}</div>
                  {ehAtual && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: t.goldSoft, color: t.gold }}>{L("Plano atual")}</span>}
                </div>
                <div className="text-xl font-bold" style={{ fontFamily: "'Sora',sans-serif", color: t.gold }}>
                  {USD(preco(p))}<span className="text-xs font-normal" style={{ color: t.dim }}>/{ciclo === "anual" ? L("ano") : L("mês")}</span></div>
                <div className="text-xs" style={{ color: t.dim }}>
                  {p.limite_unidades ? `${L("Até")} ${p.limite_unidades} ${L("unidades")}` : L("Unidades ilimitadas")}</div>
                {ehAtual && (licencaAtiva || emTeste)
                  ? <Btn t={t} className="w-full" disabled><CheckCircle2 size={13} /> {emTeste && !licencaAtiva ? L("Em teste") : L("Contratado")}</Btn>
                  : <Btn t={t} kind={ehAtual || upgrade ? "primary" : "soft"} className="w-full" disabled={agindo === p.nome}
                      onClick={() => contratar(p)}>
                      {agindo === p.nome ? "Abrindo…" : ehAtual ? L("Pagar agora") : upgrade ? L("Fazer upgrade") : L("Fazer downgrade")}</Btn>}
              </div>
            </Card>);
        })}
      </div>
      <div className="text-[11px]" style={{ color: t.dim }}>
        {L("Na troca de plano, a assinatura atual é atualizada automaticamente no Commet (upgrade cobra a diferença com rateio; downgrade é agendado para o fim do período já pago) — a anterior é substituída, sem cobrança dupla. Após pagar, use \"Verificar pagamento\" para sincronizar o status.")}</div>
      {(licencaAtiva || emTeste) && !cancelamentoAgendado && (
        <div className="text-right">
          <button onClick={cancelar} disabled={cancelando} className="text-[11px] underline opacity-70 hover:opacity-100" style={{ color: t.dim, background: "none", border: "none" }}>
            {cancelando ? "Cancelando…" : L("Cancelar assinatura")}</button>
        </div>)}
    </div>
  );
}

/* Bloqueia o acesso ao sistema enquanto a assinatura do condomínio não
   estiver ativa. O pagamento abre o checkout Commet; a ativação chega
   pelo webhook (subscription.activated) e o botão "Verificar" recarrega. */
function Paywall({ t, role, licenca, tenant, condominioId, onLogout, onReload }) {
  /* a página de planos/pagamento é exclusiva do diretor; os demais perfis só
     veem o aviso de assinatura pendente, sem valores nem botão de pagar */
  const ehDiretor = role === "diretor";
  const [gerando, setGerando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [erro, setErro] = useState("");
  /* ciclo de cobrança da licença — sempre em dólar (USD) */
  const [ciclo, setCiclo] = useState("mensal");
  /* escolha de plano no próprio paywall: o diretor pode assinar/reativar em
     outro plano — a troca grava no banco (trocarPlanoLicenca) antes do
     checkout, e o preço exibido acompanha a seleção */
  const [planos, setPlanos] = useState(null);
  const [planoSel, setPlanoSel] = useState(null);
  useEffect(() => { if (ehDiretor) listarPlanos().then(setPlanos).catch(() => setPlanos([])); }, [ehDiretor]);
  const nomePlano = planoSel || tenant?.plano || "—";
  const planoInfo = (planos || []).find((p) => p.nome === nomePlano) || null;
  const precoMes = planoInfo ? Number(planoInfo.preco_mensal) : tenant?.precoPlano;
  const precoAno = planoInfo ? Number(planoInfo.preco_anual) : tenant?.precoPlanoAnual;
  const temAnual = Boolean(precoAno);
  const aplicarPlanoEscolhido = async () => {
    if (planoSel && tenant?.plano && planoSel !== tenant.plano) await trocarPlanoLicenca(condominioId, planoSel);
  };

  /* pergunta ao Commet (via backend) se o pagamento foi confirmado e, se sim,
     recarrega — libera o acesso mesmo antes de o webhook chegar */
  const verificar = useCallback(async () => {
    setVerificando(true);
    const ativa = await verificarLicencaCommet(condominioId);
    if (ativa) await onReload();
    setVerificando(false);
    return ativa;
  }, [condominioId, onReload]);

  /* ao voltar do checkout (outra aba), reconfere a licença sozinho */
  useEffect(() => {
    const conferir = () => { verificar(); };
    window.addEventListener("focus", conferir);
    return () => window.removeEventListener("focus", conferir);
  }, [verificar]);

  const pagar = async () => {
    setGerando(true); setErro("");
    try {
      await aplicarPlanoEscolhido();
      const resp = await assinarLicencaCommet(condominioId, ciclo);
      if (resp?.checkoutUrl) window.open(resp.checkoutUrl, "_blank", "noopener");
    } catch (e) { setErro(e.message); }
    finally { setGerando(false); }
  };

  /* código de ativação (pagamento manual): promo code de uma Offer do Commet
     com 100% de desconto — o checkout abre com total $0 e a ativação chega
     pelo webhook, como em qualquer assinatura. A gestão (pausar/reativar) é
     feita no dashboard do Commet. */
  const [mostrarCodigo, setMostrarCodigo] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [ativandoCodigo, setAtivandoCodigo] = useState(false);
  const [avisoCodigo, setAvisoCodigo] = useState("");
  const ativarComCodigo = async () => {
    if (!codigo.trim()) return;
    setAtivandoCodigo(true); setErro(""); setAvisoCodigo("");
    try {
      await aplicarPlanoEscolhido();
      const resp = await assinarLicencaCommet(condominioId, ciclo, false, codigo.trim());
      if (resp?.ativado) {
        /* 100% de desconto sem checkout: a assinatura já nasceu ativa */
        setAvisoCodigo(L("Código aplicado — liberando o acesso…"));
        if (!(await verificar())) setAvisoCodigo(L("Código aplicado. Se o acesso não liberar em instantes, use \"Já paguei — verificar\"."));
      } else if (resp?.checkoutUrl) {
        setAvisoCodigo(L("Código aplicado — conclua no checkout aberto (o total deve ser $0)."));
        window.open(resp.checkoutUrl, "_blank", "noopener");
      }
    } catch (e) { setErro(e.message); }
    finally { setAtivandoCodigo(false); }
  };

  /* teste ainda não iniciado no Commet (sem teste_fim): o checkout salva o
     cartão SEM cobrar e libera 30 dias grátis; teste_fim no passado = expirou */
  const trialNovo = licenca === "teste" && !tenant?.testeFim;
  const MSG = {
    teste: trialNovo
      ? "Ative seu teste gratuito de 30 dias — cadastre o cartão; nada será cobrado agora."
      : "O período de avaliação terminou. Ative a assinatura para continuar.",
    inadimplente: "A mensalidade está em atraso. Regularize o pagamento para voltar a acessar.",
    bloqueada: "A licença deste condomínio foi bloqueada. Regularize o pagamento para reativar.",
    cancelada: "A assinatura foi cancelada. Reative-a para voltar a usar o sistema.",
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: t.bg, color: t.text, fontFamily: "'Inter',system-ui,sans-serif" }}>
      <div className="pointer-events-none fixed inset-0" style={{ background: `radial-gradient(600px 300px at 50% 0%, ${t.gold}14, transparent)` }} />
      <div className="vfade w-full max-w-md">
        <div className="rounded-2xl border p-6 text-center" style={{ background: t.surface, borderColor: t.border, boxShadow: t.shadow }}>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: t.goldSoft, color: t.gold, border: `1px solid ${t.border}` }}>
            <KeyRound size={26} /></div>
          <h1 className="text-lg font-bold" style={{ fontFamily: "'Sora',sans-serif" }}>{ehDiretor ? L("Assinatura pendente") : L("Acesso indisponível")}</h1>
          <p className="mt-2 text-sm" style={{ color: t.dim }}>
            {ehDiretor
              ? L(MSG[licenca] || "O acesso é liberado após a confirmação do pagamento da licença.")
              : L("O acesso ao condomínio está temporariamente indisponível. Procure a administração do condomínio.")}</p>
          {ehDiretor && tenant && tenant.plano !== "—" && (
            <div className="mt-4 rounded-xl border p-3 text-sm" style={{ borderColor: t.borderSoft }}>
              <div className="flex items-center justify-between">
                <span style={{ color: t.dim }}>{L("Plano")}</span><b>{nomePlano}</b></div>
              {(planos || []).length > 1 && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {planos.map((p) => (
                    <button key={p.nome} type="button" onClick={() => setPlanoSel(p.nome)}
                      className="rounded-xl border px-1 py-1.5 text-xs font-semibold"
                      style={{ borderColor: nomePlano === p.nome ? t.gold : t.borderSoft, color: nomePlano === p.nome ? t.gold : t.dim, background: nomePlano === p.nome ? t.goldSoft : "transparent" }}>
                      {p.nome}</button>))}
                </div>)}
              {temAnual && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[["mensal", L("Mensal")], ["anual", L("Anual")]].map(([v, rotulo]) => (
                    <button key={v} type="button" onClick={() => setCiclo(v)}
                      className="rounded-xl border px-2 py-1.5 text-xs font-semibold"
                      style={{ borderColor: ciclo === v ? t.gold : t.borderSoft, color: ciclo === v ? t.gold : t.dim, background: ciclo === v ? t.goldSoft : "transparent" }}>
                      {rotulo}</button>))}
                </div>)}
              {precoMes ? (
                <div className="mt-2 flex items-center justify-between">
                  <span style={{ color: t.dim }}>{ciclo === "anual" && temAnual ? L("Anuidade") : L("Mensalidade")}</span>
                  <b>{ciclo === "anual" && temAnual ? `${USD(precoAno)}/ano` : `${USD(precoMes)}/mês`}</b></div>) : null}
              {planoInfo && (
                <div className="mt-1 text-right text-[11px]" style={{ color: t.dim }}>
                  {planoInfo.limite_unidades ? `${L("Até")} ${planoInfo.limite_unidades} ${L("unidades")} · ` : `${L("Unidades ilimitadas")} · `}{L("Cobrança em dólar (USD)")}</div>)}
              {!planoInfo && <div className="mt-1 text-right text-[11px]" style={{ color: t.dim }}>{L("Cobrança em dólar (USD)")}</div>}
            </div>)}
          {erro && <div className="mt-3 rounded-xl border p-2.5 text-xs" style={{ borderColor: t.danger, color: t.danger }}>{erro}</div>}
          <div className="mt-5 space-y-2">
            {ehDiretor && (
              <Btn t={t} kind="primary" className="w-full" disabled={gerando} onClick={pagar}>
                <QrCode size={15} /> {gerando ? L("Gerando checkout…") : trialNovo ? L("Iniciar teste gratuito de 30 dias") : L("Pagar assinatura")}</Btn>)}
            <Btn t={t} className="w-full" disabled={verificando}
              onClick={async () => { setErro(""); if (!(await verificar())) setErro(ehDiretor ? L("O Commet ainda não confirmou este pagamento. Aguarde alguns instantes e verifique de novo.") : L("O acesso ainda não foi liberado. Tente novamente mais tarde.")); }}>
              <RefreshCw size={15} className={verificando ? "vpulse" : ""} /> {ehDiretor ? L("Já paguei — verificar") : L("Tentar novamente")}</Btn>
            <Btn t={t} className="w-full" onClick={onLogout}><LogOut size={15} /> {L("Sair")}</Btn>
          </div>
          {ehDiretor && !mostrarCodigo && (
            <button type="button" onClick={() => setMostrarCodigo(true)}
              className="mt-3 text-[11px] underline opacity-70 hover:opacity-100"
              style={{ color: t.dim, background: "none", border: "none" }}>
              {L("Tenho um código de ativação")}</button>)}
          {ehDiretor && mostrarCodigo && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                  placeholder={L("Código de ativação")} autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") ativarComCodigo(); }}
                  className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none"
                  style={{ background: t.bg, borderColor: t.borderSoft, color: t.text }} />
                <Btn t={t} kind="primary" disabled={ativandoCodigo || !codigo.trim()} onClick={ativarComCodigo}>
                  {ativandoCodigo ? L("Ativando…") : L("Ativar")}</Btn>
              </div>
              {avisoCodigo && (
                <div className="rounded-xl border p-2.5 text-xs" style={{ borderColor: t.gold + "55", background: t.goldSoft, color: t.gold }}>
                  {avisoCodigo}</div>)}
            </div>)}
          {ehDiretor && (
          <p className="mt-4 text-[11px]" style={{ color: t.dim }}>
            {L("O pagamento abre em uma nova aba, em ambiente seguro. A liberação é automática após a confirmação.")}</p>)}
        </div>
      </div>
    </div>
  );
}

/* ══════════════ SHELL PRINCIPAL ══════════════ */
export default function App() {
  const [dark, setDark] = useState(true);
  const [lang, setLangState] = useState(LANG);
  const onLang = useCallback((l) => { setLang(l); setLangState(l); }, []);
  const [role, setRole] = useState(() => lerSessao()?.role || null);
  const [morador, setMorador] = useState(() => lerSessao()?.morador || null); // { nome, unidade } do morador logado
  const [diretorConta, setDiretorConta] = useState(() => lerSessao()?.diretor || null); // conta do diretor logado (para o 1º acesso)
  const [condId, setCondId] = useState(() => lerSessao()?.condominioId || null); // condomínio da conta logada (multi-tenant)
  /* recarregar a página mantém a tela onde a pessoa estava (se o perfil pode vê-la) */
  const [screen, setScreen] = useState(() => {
    const r = lerSessao()?.role;
    const padrao = "dashboard";
    try {
      const salva = sessionStorage.getItem(K_TELA);
      return salva && r && NAV.some((n) => n.id === salva && n.roles.includes(r)) ? salva : padrao;
    } catch { return padrao; }
  });
  useEffect(() => { try { sessionStorage.setItem(K_TELA, screen); } catch { /* sem storage */ } }, [screen]);
  const [sideOpen, setSideOpen] = useState(false);
  const [phase, retry] = useLoad(screen);

  /* carga dos dados do Supabase */
  const [db, setDb] = useState(null);
  const [dbErr, setDbErr] = useState(null);
  const reload = useCallback(async () => {
    setDbErr(null);
    try { setDb(await loadAll(condId)); }
    catch (e) { console.error("[Supabase]", e); setDbErr(e); }
  }, [condId]);
  useEffect(() => { reload(); }, [reload]);
  const dataValue = useMemo(() => ({ db, reload }), [db, reload]);
  /* moeda de gestão vinda do banco (padrão USD) — aplicada antes de renderizar as telas */
  setMoeda(db?.cond?.moeda);

  /* tema: a cor primária salva na identidade visual substitui o dourado padrão */
  const t = useMemo(() => {
    const base = dark ? THEMES.dark : THEMES.light;
    const cor = db?.cond?.cor;
    if (!cor || !/^#[0-9a-fA-F]{6}$/.test(cor)) return base;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16));
    return {
      ...base, gold: cor,
      goldSoft: `rgba(${r},${g},${b},${dark ? 0.12 : 0.10})`,
      border: `rgba(${r},${g},${b},${dark ? 0.16 : 0.30})`,
    };
  }, [dark, db]);

  const go = useCallback((s) => { setScreen(s); setSideOpen(false); }, []);
  const nav = NAV.filter((n) => role && n.roles.includes(role));

  /* notificações do sino: pendências reais da sessão, filtradas pelo perfil */
  const [notifOpen, setNotifOpen] = useState(false);
  const notifs = useMemo(() => {
    if (!db || db.vazio || !role) return [];
    const n = [];
    const multasPend = (db.multas || []).filter((m) => m.status === "pendente");
    if (multasPend.length) n.push({ txt: `${multasPend.length} ${L("multa(s)/advertência(s) aguardando decisão do síndico")}`, c: "danger", s: "multas" });
    const paraEnviar = (db.multas || []).filter((m) => m.status === "aprovada_envio");
    if (paraEnviar.length) n.push({ txt: `${paraEnviar.length} ${L("penalidade(s) aprovada(s) aguardando envio ao responsável")}`, c: "warn", s: "multas" });
    const vencidas = (db.cobr || []).filter((c) => c.status === "vencida");
    if (vencidas.length) n.push({ txt: `${vencidas.length} ${L("cobrança(s) vencida(s) somando")} ${BRL(vencidas.reduce((s, c) => s + c.valor, 0))}`, c: "warn", s: "cobrancas" });
    const aprovar = (db.lanc || []).filter((l) => l.status === "aguardando");
    if (aprovar.length) n.push({ txt: `${aprovar.length} ${L("lançamento(s) aguardando aprovação")}`, c: "info", s: "financeiro" });
    const semResp = (db.chamados || []).filter((c) => c.status === "aberto" && c.resp === "—");
    if (semResp.length) n.push({ txt: `${semResp.length} ${L("chamado(s) abertos sem responsável designado")}`, c: "warn", s: "chamados" });
    return n.filter((x) => NAV.some((nv) => nv.id === x.s && nv.roles.includes(role)));
  }, [db, role]);

  const globalStyle = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
      *::-webkit-scrollbar{width:8px;height:8px} *::-webkit-scrollbar-thumb{background:${t.borderSoft};border-radius:8px}
      .vfade{animation:vfade .3s cubic-bezier(.4,0,.2,1)} @keyframes vfade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      .vpulse{animation:vpulse 1.4s ease infinite} @keyframes vpulse{0%,100%{opacity:.35}50%{opacity:.7}}
      .vhover{transition:transform .18s,box-shadow .18s} .vhover:hover{transform:translateY(-2px)}
      @media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
      input,select,textarea{outline:none} button{cursor:pointer}
      button:focus-visible,a:focus-visible{outline:2px solid ${t.gold};outline-offset:2px}
      body{margin:0}
    `}</style>
  );

  const sair = useCallback(() => {
    salvarSessao(null); setAuthToken(null);
    try { sessionStorage.removeItem(K_TELA); sessionStorage.removeItem("cm_tela_portal"); } catch { /* sem storage */ }
    setMorador(null); setDiretorConta(null); setCondId(null); setRole(null);
  }, []);
  const entrar = useCallback((r, m, d, cId, token) => {
    salvarSessao({ role: r, morador: m || null, diretor: d ? { nome: d.nome, email: d.email } : null, condominioId: cId || null, token: token || null });
    setMorador(m || null); setDiretorConta(d || null); setCondId(cId || null); setRole(r);
    setScreen("dashboard");
  }, []);
  /* condomínio recém-criado no 1º acesso: amarra à sessão desta conta,
     com o token novo (que carrega o condominio_id para o RLS) */
  const aoCriarCondominio = useCallback((novoId, novoToken) => {
    salvarSessao({ ...(lerSessao() || { role: "diretor" }), condominioId: novoId || null, token: novoToken || lerSessao()?.token || null });
    setCondId(novoId || null);
  }, []);

  if (!role) return <DataCtx.Provider value={dataValue}>{globalStyle}<Login t={t} dark={dark} setDark={setDark} lang={lang} onLang={onLang} onEnter={entrar} /></DataCtx.Provider>;
  /* conta sem condomínio próprio (diretor recém-cadastrado) vai direto para o
     primeiro acesso — nunca enxerga o prédio de outra conta */
  if (db?.vazio || !condId) return (
    <DataCtx.Provider value={dataValue}>{globalStyle}
      <SetupCondominio t={t} role={role} diretor={diretorConta} dark={dark} setDark={setDark} onCriado={aoCriarCondominio} onSair={sair} />
    </DataCtx.Provider>);

  /* ── PAYWALL: entra com licença ativa OU teste gratuito válido (iniciado
     no Commet — teste_fim preenchido — e ainda dentro do prazo) ── */
  const tenantPrincipal = db && !db.vazio ? db.tenants.find((x) => x.id === db.ctx.condominioId) : null;
  const testeValido = tenantPrincipal?.status === "teste" && tenantPrincipal.testeFim && tenantPrincipal.diasTeste >= 0;
  if (db && tenantPrincipal && tenantPrincipal.status !== "ativo" && !testeValido) return (
    <DataCtx.Provider value={dataValue}>{globalStyle}
      <Paywall t={t} role={role} licenca={tenantPrincipal.status} tenant={tenantPrincipal} condominioId={db.ctx.condominioId}
        onLogout={sair} onReload={reload} />
    </DataCtx.Provider>);

  if (role === "morador") return (
    <DataCtx.Provider value={dataValue}>{globalStyle}
      {db ? <PortalMorador t={t} dark={dark} setDark={setDark} lang={lang} onLang={onLang} morador={morador} onLogout={sair} />
        : <div className="mx-auto max-w-lg p-4" style={{ background: t.bg, minHeight: "100vh" }}>
            {dbErr ? <ErrorState t={t} onRetry={reload} /> : <Skeleton t={t} />}</div>}
    </DataCtx.Provider>);

  const SCREENS = {
    dashboard: <Dashboard t={t} role={role} go={go} />, condominio: <Condominio t={t} role={role} />,
    unidades: <Unidades t={t} role={role} />, pessoas: <Pessoas t={t} />, financeiro: <Financeiro t={t} />,
    cobrancas: <Cobrancas t={t} />, multas: <Multas t={t} role={role} />, comunicados: <Comunicados t={t} />,
    documentos: <Documentos t={t} />, chamados: <Chamados t={t} />, portaria: <Portaria t={t} />,
    emails: <GerenciarEmails t={t} />, planos: <Planos t={t} />,
  };
  const current = NAV.find((n) => n.id === screen);

  return (
    <DataCtx.Provider value={dataValue}>
    <div style={{ background: t.bg, color: t.text, minHeight: "100vh", fontFamily: "'Inter',system-ui,sans-serif", transition: "background .3s,color .3s" }}>
      {globalStyle}
      <div className="flex">
        {/* SIDEBAR */}
        <aside className={`fixed inset-y-0 left-0 z-40 w-60 border-r transition-transform lg:static lg:translate-x-0 ${sideOpen ? "translate-x-0" : "-translate-x-full"}`}
          style={{ background: t.sidebar, borderColor: t.borderSoft }}>
          <div className="flex h-full flex-col p-4">
            <div className="mb-6 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold" style={{ background: t.goldSoft, color: t.gold, border: `1px solid ${t.border}`, fontFamily: "'Sora',sans-serif" }}>CM</div>
              <div>
                <div className="text-sm font-bold tracking-wide" style={{ fontFamily: "'Sora',sans-serif" }}>CONDOMASTER <span style={{ color: t.gold }}>PRO</span></div>
                <div className="text-[10px]" style={{ color: t.dim }}>{db?.ctx.condominioNome || "…"}</div>
              </div>
            </div>
            <nav className="flex-1 space-y-0.5 overflow-y-auto">
              {nav.map((n) => {
                const active = screen === n.id;
                return (
                  <button key={n.id} onClick={() => go(n.id)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all"
                    style={{ background: active ? t.goldSoft : "transparent", color: active ? t.gold : t.dim, border: `1px solid ${active ? t.border : "transparent"}` }}>
                    <n.icon size={16} /> {L(n.label)}
                    {n.id === "multas" && db?.stats.multasEmDefesa > 0 && <span className="ml-auto rounded-full px-1.5 text-[10px] font-bold" style={{ background: t.danger + "22", color: t.danger }}>{db.stats.multasEmDefesa}</span>}
                  </button>);
              })}
            </nav>
            <div className="mt-4 space-y-2 border-t pt-3" style={{ borderColor: t.borderSoft }}>
              <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold" style={{ background: t.goldSoft, color: t.gold }}>
                  {L(PROFILES[role].label)[0]}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{L(PROFILES[role].label)}</div>
                  <div className="text-[10px]" style={{ color: t.dim }}>{L("Perfil de acesso")}</div>
                </div>
                <button onClick={sair} title="Sair" className="rounded-lg p-1.5" style={{ background: t.surface2 }}><LogOut size={14} color={t.dim} /></button>
              </div>
              <Btn t={t} kind="danger" className="w-full" onClick={sair}><LogOut size={14} /> {L("Sair da conta")}</Btn>
            </div>
          </div>
        </aside>
        {sideOpen && <div className="fixed inset-0 z-30 lg:hidden" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setSideOpen(false)} />}

        {/* ÁREA PRINCIPAL */}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b px-4 py-3 backdrop-blur-md" style={{ background: t.glass, borderColor: t.borderSoft }}>
            <div className="flex items-center gap-3">
              <button onClick={() => setSideOpen(true)} className="rounded-lg p-2 lg:hidden" style={{ background: t.surface2 }}><Menu size={16} color={t.dim} /></button>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-bold" style={{ fontFamily: "'Sora',sans-serif" }}>{L(current?.label || "Dashboard")}</h1>
                <div className="hidden text-xs sm:block" style={{ color: t.dim }}>
                  {(() => { /* subtítulo com dados reais do condomínio (era texto fictício) */
                    const fixo = {dashboard:"Visão geral do condomínio em tempo real",condominio:"Cadastro-mãe: dados legais, gestão e regras internas",
                      portaria:"Controle de acessos, entregas e ocorrências",
                      emails:"E-mails e senhas de acesso dos perfis síndico, tesouraria e morador"}[screen];
                    if (fixo) return L(fixo);
                    if (!db) return "";
                    const n = (qtd, sing, plu) => `${qtd} ${L(qtd === 1 ? sing : plu)}`;
                    switch (screen) {
                      case "unidades":    return `${n(db.unidades.length, "unidade", "unidades")} · ${n(db.ctx.blocos.length, "bloco/torre", "blocos/torres")}`;
                      case "pessoas":     return n(db.pessoas.length, "pessoa cadastrada", "pessoas cadastradas");
                      case "financeiro":  return `${L("Competência")} ${db.mesAtualReal.split("-").reverse().join("/")} · ${L("aprovações do síndico ativas")}`;
                      case "cobrancas":   return `${n(db.cobr.filter((c) => c.status === "emitida").length, "cobrança em aberto", "cobranças em aberto")} · ${n(db.cobr.filter((c) => c.status === "vencida").length, "vencida", "vencidas")}`;
                      case "multas":      return n(db.multas.length, "multa/advertência registrada", "multas/advertências registradas");
                      case "comunicados": return n(db.comunic.length, "comunicado publicado", "comunicados publicados");
                      case "documentos":  return n(db.docs.length, "documento arquivado", "documentos arquivados");
                      case "chamados":    return n(db.chamados.filter((c) => c.status !== "concluido" && c.status !== "cancelado").length, "chamado em aberto", "chamados em aberto");
                      default: return "";
                    }
                  })()}</div>
              </div>
              <LangSel t={t} lang={lang} onLang={onLang} />
              <div className="relative">
                <button onClick={() => setNotifOpen((v) => !v)} className="relative rounded-lg p-2" style={{ background: t.surface2 }} title={L("Notificações")}>
                  <Bell size={16} color={notifs.length ? t.gold : t.dim} />
                  {notifs.length > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                      style={{ background: t.danger, color: "#fff" }}>{notifs.length}</span>)}
                </button>
                {notifOpen && (<>
                  <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 z-40 mt-2 w-80 max-w-[85vw] rounded-2xl border p-2 shadow-xl" style={{ background: t.surface, borderColor: t.border }}>
                    <div className="px-2 py-1.5 text-xs font-semibold" style={{ color: t.dim, fontFamily: "'Sora',sans-serif" }}>{L("NOTIFICAÇÕES")}</div>
                    {notifs.length === 0 ? (
                      <div className="px-2 py-3 text-xs" style={{ color: t.dim }}>{L("Nenhuma notificação — tudo em dia!")}</div>
                    ) : notifs.map((n, i) => (
                      <button key={i} onClick={() => { go(n.s); setNotifOpen(false); }}
                        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:opacity-80">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t[n.c] }} />
                        <span className="min-w-0 flex-1 text-xs">{n.txt}</span>
                        <ChevronRight size={13} color={t.dim} />
                      </button>))}
                  </div>
                </>)}
              </div>
              <button onClick={() => setDark(!dark)} className="rounded-lg p-2" style={{ background: t.surface2 }} title={L("Alternar tema")}>
                {dark ? <Sun size={16} color={t.gold} /> : <Moon size={16} color={t.gold} />}</button>
            </div>
          </header>
          <main className="p-4 lg:p-6">
            {dbErr ? <ErrorState t={t} onRetry={reload} />
              : phase === "loading" || !db ? <Skeleton t={t} />
              : SCREENS[screen] || <ErrorState t={t} onRetry={retry} />}
          </main>
        </div>
      </div>
    </div>
    </DataCtx.Provider>
  );
}
