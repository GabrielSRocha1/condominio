import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LayoutDashboard, Building2, Home, Users, Wallet, QrCode, Gavel, Megaphone,
  FileText, Wrench, ShieldCheck, Briefcase, LogOut, Sun, Moon, Search, Plus,
  ChevronRight, ChevronLeft, X, Check, Clock, AlertCircle, CheckCircle2,
  Download, Filter, Bell, Menu, Eye, Send, Printer, RefreshCw, TrendingUp,
  TrendingDown, CircleDot, User, KeyRound, Car, Package, DoorOpen, Star,
  CalendarClock, ListChecks, MoreHorizontal, Pencil, Ban, ArrowUpRight,
  Mail, EyeOff, Trash2, UserPlus
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend
} from "recharts";
import {
  loadAll, criarCondominio, criarUnidade, criarPessoa, criarLancamento, criarPenalidade, decidirPenalidade,
  criarComunicado, criarChamado, criarPreAutorizacao, gerarCobrancas, loginDiretor, pagarComCommet,
  assinarLicencaCommet, verificarLicencaCommet, listarPlanos, registrarDiretor,
  criarAcesso, listarAcessos, removerAcesso, loginUsuario,
} from "./src/lib/api.js";

/* Abre o checkout do Commet em nova aba; avisa se o backend ainda não estiver no ar */
const usePagarCommet = () => {
  const [pagando, setPagando] = useState(false);
  const pagar = async (cobrancaId) => {
    setPagando(true);
    try { window.open(await pagarComCommet(cobrancaId), "_blank", "noopener"); }
    catch (e) { alert(e.message); }
    finally { setPagando(false); }
  };
  return [pagar, pagando];
};
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

const BRL = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const uid = () => Math.random().toString(36).slice(2, 9);

/* ══════════════ CONTAS DE ACESSO (salvas neste navegador — modo demo) ══════════════ */
/* Todos os dados de contas e acessos vivem na tabela usuarios do Supabase —
   nada é gravado em localStorage; a sessão dura enquanto a aba estiver aberta. */

/* ══════════════ PERFIS E NAVEGAÇÃO ══════════════ */
const PROFILES = {
  diretor:       { label: "Diretor",        icon: Star,        desc: "Visão estratégica, aprovações e auditoria" },
  sindico:       { label: "Síndico",        icon: ShieldCheck, desc: "Operação, multas, comunicados e manutenção" },
  tesouraria:    { label: "Tesouraria",     icon: Wallet,      desc: "Financeiro, cobranças e conciliação" },
  administradora:{ label: "Administradora", icon: Briefcase,   desc: "Gestão SaaS: clientes, planos e licenças" },
  morador:       { label: "Morador",        icon: Home,        desc: "Boletos, comprovantes, comunicados e chamados" },
};

const NAV = [
  { id: "dashboard",  label: "Dashboard",       icon: LayoutDashboard, roles: ["diretor","sindico","tesouraria","administradora"] },
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
  { id: "emails",     label: "Gerenciar Emails",icon: Mail,            roles: ["diretor"] },
  { id: "saas",       label: "Painel SaaS",     icon: Briefcase,       roles: ["administradora"] },
];

/* ══════════════ DADOS (Supabase) ══════════════ */
const DataCtx = React.createContext(null);
const useData = () => React.useContext(DataCtx);

/* Envia um formulário: coleta os campos com FormData, executa a ação e trata erros */
const useSubmit = (action) => {
  const [saving, setSaving] = useState(false);
  const onSubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    setSaving(true);
    try { await action(f); } catch (err) { alert("Não foi possível salvar: " + (err?.message || err)); }
    finally { setSaving(false); }
  };
  return [onSubmit, saving];
};

/* Série ilustrativa do gráfico de MRR (histórico mensal ainda não é rastreado no banco) */
const M_MRR = [
  { m: "Jan", v: 1800 }, { m: "Fev", v: 2290 }, { m: "Mar", v: 2290 }, { m: "Abr", v: 2570 }, { m: "Mai", v: 2570 }, { m: "Jun", v: 2570 },
];

const STATUS_META = {
  pago:{c:"ok",l:"Pago"}, parcial:{c:"warn",l:"Parcial"}, aberto:{c:"info",l:"Em aberto"},
  aguardando:{c:"warn",l:"Aguardando"}, vencida:{c:"danger",l:"Vencida"}, emitida:{c:"info",l:"Emitida"},
  ocupada:{c:"ok",l:"Ocupada"}, alugada:{c:"info",l:"Alugada"}, vaga:{c:"warn",l:"Vaga"},
  ativo:{c:"ok",l:"Ativo"}, teste:{c:"warn",l:"Em teste"}, inadimplente:{c:"danger",l:"Inadimplente"},
  aguardando_defesa:{c:"warn",l:"Prazo de defesa"}, aprovada:{c:"danger",l:"Multa aplicada"}, advertencia:{c:"info",l:"Advertência"},
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
    <div className="mt-2 text-xl font-bold" style={{ fontFamily: "'Sora',sans-serif", color: color || t.text }}>{value}</div>
    <div className="text-xs" style={{ color: t.dim }}>{L(label)}</div>
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

/* Documento timbrado — assinatura visual do produto */
const Timbrado = ({ t, tipo, corpo, unidade, valor, prazo }) => (
  <div className="overflow-hidden rounded-xl border" style={{ borderColor: t.border, background: "#FDFCF7", color: "#1A1A1A" }}>
    <div className="flex items-center gap-3 px-5 pt-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold" style={{ background: "#0A0E1A", color: "#D4AF37" }}>AC</div>
      <div>
        <div className="text-sm font-bold" style={{ fontFamily: "'Sora',sans-serif" }}>Residencial Águas Claras</div>
        <div className="text-[11px]" style={{ color: "#666" }}>CNPJ 12.345.678/0001-90 · Av. das Palmeiras, 1200 — Foz do Iguaçu/PR</div>
      </div>
    </div>
    <div className="mx-5 mt-3 h-[2px]" style={{ background: "linear-gradient(90deg,#D4AF37,transparent)" }} />
    <div className="px-5 py-4 text-[13px] leading-relaxed">
      <div className="mb-2 text-xs font-bold uppercase tracking-widest" style={{ color: "#9E7C14" }}>{tipo}</div>
      <p>{corpo}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs" style={{ color: "#444" }}>
        <div><b>Unidade:</b> {unidade}</div>
        {valor != null && <div><b>Valor:</b> {BRL(valor)}</div>}
        {prazo && <div><b>Prazo para defesa:</b> {prazo}</div>}
        <div><b>Data de emissão:</b> 18/06/2026</div>
      </div>
      <div className="mt-5 border-t pt-3 text-center text-xs" style={{ borderColor: "#DDD", color: "#666" }}>
        Roberto Silva — Síndico · assinatura eletrônica registrada na plataforma
      </div>
    </div>
  </div>
);

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
     gravada na tabela usuarios do Supabase */
  const registrar = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (f.senha.length < 4) return setErro(L("A senha deve ter pelo menos 4 caracteres."));
    if (f.senha !== f.confirma) return setErro(L("As senhas não conferem."));
    const conta = { nome: f.nome.trim(), email: f.email.trim().toLowerCase(), senha: f.senha };
    setVerificando(true);
    try {
      await registrarDiretor(conta);
      setDiretor(conta); setErro("");
    } catch (err) {
      setErro(err.message || L("Não foi possível concluir o cadastro agora."));
    } finally { setVerificando(false); }
  };

  const entrar = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (role === "morador") {
      /* morador entra com o nome cadastrado pelo diretor em Gerenciar Emails */
      const nome = (f.nome || "").trim();
      setVerificando(true);
      try {
        const conta = await loginUsuario("morador", { nome, senha: f.senha });
        if (conta) { setErro(""); return onEnter(role, { nome: conta.nome, unidade: conta.unidade || null }); }
        setErro(L("Nome ou senha incorretos. Peça ao diretor para conferir seu acesso em Gerenciar Emails."));
      } catch (err) {
        setErro(L("Não foi possível verificar sua conta agora.") + " " + err.message);
      } finally { setVerificando(false); }
      return;
    }
    const email = f.email.trim().toLowerCase();
    if (role === "diretor") {
      if (diretor && email === diretor.email && f.senha === diretor.senha) { setErro(""); return onEnter(role, null, diretor); }
      /* confere e-mail e senha na tabela usuarios */
      setVerificando(true);
      try {
        const conta = await loginDiretor(email, f.senha);
        if (conta) { setDiretor(conta); setErro(""); return onEnter(role, null, conta); }
        setErro(L("E-mail ou senha incorretos."));
      } catch (err) {
        setErro(L("Não foi possível verificar sua conta agora.") + " " + err.message);
      } finally { setVerificando(false); }
      return;
    }
    setVerificando(true);
    try {
      const conta = await loginUsuario(role, { email, senha: f.senha });
      if (conta) { setErro(""); return onEnter(role); }
      setErro(L("E-mail ou senha incorretos. Peça ao diretor para conferir seu acesso em Gerenciar Emails."));
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
          <p className="mt-1 text-xs" style={{ color: t.dim }}>{L("Gestão condominial premium · powered by Verum Pay")}</p>
        </div>
        <Card t={t} className="p-5">
          {!diretor && !jaCadastrado ? (
            <form onSubmit={registrar} className="space-y-3">
              <div className="text-sm font-semibold">{L("Criar acesso do diretor")}</div>
              <div className="text-xs" style={{ color: t.dim }}>
                {L("Este é o primeiro acesso. A conta criada aqui será usada para entrar como")} <b style={{ color: t.text }}>{L("Diretor")}</b>
                {L(", que poderá cadastrar os e-mails e senhas dos demais perfis em Gerenciar Emails.")}</div>
              <Field t={t} label="Nome completo"><input name="nome" required placeholder={L("Seu nome")} style={inputStyle(t)} /></Field>
              <Field t={t} label="E-mail"><input name="email" type="email" required placeholder={L("voce@exemplo.com")} style={inputStyle(t)} /></Field>
              <Field t={t} label="Senha"><PasswordInput t={t} name="senha" required placeholder={L("Mínimo 4 caracteres")} /></Field>
              <Field t={t} label="Confirmar senha"><PasswordInput t={t} name="confirma" required placeholder={L("Repita a senha")} /></Field>
              {erro && <div className="text-xs" style={{ color: t.danger }}>{erro}</div>}
              <Btn t={t} kind="primary" type="submit" className="w-full" disabled={verificando}>
                <UserPlus size={15} /> {verificando ? L("Salvando cadastro…") : L("Criar conta e continuar")}</Btn>
              <div className="pt-1 text-center">
                <button type="button" onClick={() => { setJaCadastrado(true); setRole("diretor"); setErro(""); }}
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
                  {L("Nenhum acesso de")} {L(PROFILES[role].label)} {L("foi criado ainda. Peça ao diretor para cadastrá-lo em Gerenciar Emails.")}</div>}
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
  const [salvar, saving] = useSubmit(async (f) => { await criarCondominio(f, diretor); await onCriado(); });
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
                      ? `${p.nome} — ${BRL(Number(p.preco_mensal))}/mês · ${p.limite_unidades ? `até ${p.limite_unidades} unidades` : "unidades ilimitadas"}`
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

      {/* pendências e alertas */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card t={t}>
          <SectionTitle t={t} action={<button onClick={() => go("cobrancas")} className="text-xs" style={{ color: t.gold }}>{L("Ver todas →")}</button>}>
            {role === "diretor" ? "Aprovações pendentes" : "Alertas do dia"}</SectionTitle>
          <div className="space-y-2 text-sm">
            {(() => {
              const multaPend = db.multas.find((m) => m.status === "aguardando_defesa");
              const vencidas = db.cobr.filter((c) => c.status === "vencida");
              const semResp = db.chamados.find((c) => c.status === "aberto" && c.resp === "—");
              const alertas = [
                multaPend && [Gavel, `${L("Multa")} ${multaPend.num} ${L("aguarda decisão do síndico")}`, "danger", "multas"],
                vencidas.length > 0 && [QrCode, `${vencidas.length} ${L("cobrança(s) vencida(s) somando")} ` + BRL(vencidas.reduce((s, c) => s + c.valor, 0)), "warn", "cobrancas"],
                semResp && [Wrench, `${semResp.num} (${semResp.cat.toLowerCase()}) ${L("sem responsável designado")}`, "warn", "chamados"],
              ].filter(Boolean);
              if (!alertas.length) return <div className="text-xs" style={{ color: t.dim }}>Nenhuma pendência no momento. Tudo em dia! 🎉</div>;
              return alertas.map(([Ic, txt, c, s], i) => (
                <button key={i} onClick={() => go(s)} className="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left"
                  style={{ borderColor: t[c] + "44", background: t[c] + "0D" }}>
                  <Ic size={15} color={t[c]} /><span className="flex-1 text-xs">{txt}</span>
                  <ChevronRight size={14} color={t.dim} /></button>));
            })()}
          </div>
        </Card>
        <Card t={t}>
          <SectionTitle t={t}>Atividade recente</SectionTitle>
          <div className="space-y-2.5 text-xs">
            {db.atividades.map(([txt, ts], i) => (
              <div key={i} className="flex gap-2">
                <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.gold }} />
                <div><div>{txt}</div><div style={{ color: t.dim }}>{ts}</div></div>
              </div>))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ══════════════ CADASTRO DO CONDOMÍNIO ══════════════ */
function Condominio({ t }) {
  const [tab, setTab] = useState("dados");
  const [saved, setSaved] = useState(false);
  return (
    <div className="vfade max-w-3xl space-y-4">
      <div className="flex gap-1 overflow-x-auto">
        {[["dados","Dados gerais"],["gestao","Gestão"],["regras","Regras internas"],["visual","Identidade visual"]].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: tab===k ? t.goldSoft : "transparent", color: tab===k ? t.gold : t.dim, border: `1px solid ${tab===k ? t.border : "transparent"}` }}>{l}</button>))}
      </div>
      <Card t={t} className="space-y-3 p-5">
        {tab === "dados" && (<>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field t={t} label="Nome fantasia"><input defaultValue="Residencial Águas Claras" style={inputStyle(t)} /></Field>
            <Field t={t} label="Razão social"><input defaultValue="Condomínio Residencial Águas Claras" style={inputStyle(t)} /></Field>
            <Field t={t} label="CNPJ"><input defaultValue="12.345.678/0001-90" style={inputStyle(t)} /></Field>
            <Field t={t} label="Inscrição municipal"><input placeholder="Quando houver" style={inputStyle(t)} /></Field>
            <Field t={t} label="Tipo"><select style={inputStyle(t)}><option>Residencial</option><option>Comercial</option><option>Misto</option></select></Field>
            <Field t={t} label="Porte"><select style={inputStyle(t)}><option>Alto padrão</option><option>Médio padrão</option><option>Baixo padrão</option></select></Field>
            <Field t={t} label="Torres / blocos"><input defaultValue="2 torres (A, B) + térreo comercial" style={inputStyle(t)} /></Field>
            <Field t={t} label="Unidades / vagas"><input defaultValue="96 unidades · 148 vagas" style={inputStyle(t)} /></Field>
          </div>
          <Field t={t} label="Endereço completo"><input defaultValue="Av. das Palmeiras, 1200 — Foz do Iguaçu/PR" style={inputStyle(t)} /></Field>
        </>)}
        {tab === "gestao" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field t={t} label="Administradora responsável"><input defaultValue="Verum Administradora" style={inputStyle(t)} /></Field>
            <Field t={t} label="Síndico atual"><input defaultValue="Roberto Silva" style={inputStyle(t)} /></Field>
            <Field t={t} label="Diretor administrativo"><input defaultValue="—" style={inputStyle(t)} /></Field>
            <Field t={t} label="Tesouraria"><input defaultValue="Helena Duarte" style={inputStyle(t)} /></Field>
            <Field t={t} label="Início da gestão"><input type="date" defaultValue="2026-01-01" style={inputStyle(t)} /></Field>
            <Field t={t} label="Status do contrato SaaS"><select style={inputStyle(t)}><option>Ativo — plano Premium</option><option>Em teste</option><option>Suspenso</option></select></Field>
          </div>)}
        {tab === "regras" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field t={t} label="Horário de silêncio"><input defaultValue="22h — 8h" style={inputStyle(t)} /></Field>
            <Field t={t} label="Mudanças"><input defaultValue="Seg–Sáb, 8h–17h, com agendamento" style={inputStyle(t)} /></Field>
            <Field t={t} label="Obras"><input defaultValue="Seg–Sex, 8h–17h" style={inputStyle(t)} /></Field>
            <Field t={t} label="Visitantes"><input defaultValue="Pré-autorização pelo portal" style={inputStyle(t)} /></Field>
            <Field t={t} label="Animais"><input defaultValue="Permitidos com coleira nas áreas comuns" style={inputStyle(t)} /></Field>
            <Field t={t} label="Áreas comuns"><input defaultValue="Reserva com 48h de antecedência" style={inputStyle(t)} /></Field>
          </div>)}
        {tab === "visual" && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field t={t} label="Logo (upload)"><div className="flex h-20 items-center justify-center rounded-xl border border-dashed text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>Arraste ou clique para enviar</div></Field>
              <Field t={t} label="Cor primária do portal"><input type="color" defaultValue="#D4AF37" style={{ ...inputStyle(t), height: 42, padding: 4 }} /></Field>
            </div>
            <div className="text-xs" style={{ color: t.dim }}>A identidade acima é aplicada aos documentos timbrados e ao portal do morador.</div>
          </div>)}
        <div className="flex justify-end gap-2 pt-2">
          <Btn t={t}>Cancelar</Btn>
          <Btn t={t} kind="primary" onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 1800); }}>
            {saved ? <><CheckCircle2 size={15} /> Salvo</> : <><Check size={15} /> Salvar alterações</>}</Btn>
        </div>
      </Card>
    </div>
  );
}

/* ══════════════ UNIDADES ══════════════ */
function Unidades({ t }) {
  const { db, reload } = useData();
  const [q, setQ] = useState(""); const [st, setSt] = useState("todos"); const [sel, setSel] = useState(null); const [novo, setNovo] = useState(false);
  const [salvar, saving] = useSubmit(async (f) => { await criarUnidade(db.ctx, f); await reload(); setNovo(false); });
  const rows = db.unidades.filter((u) => (st === "todos" || u.status === st) &&
    (u.num + u.bloco + u.tipo + u.resp).toLowerCase().includes(q.toLowerCase()));
  const cols = [{k:"num",l:"Unidade"},{k:"tipo",l:"Tipo"},{k:"status",l:"Status"},{k:"resp",l:"Responsável financeiro"},{k:"fracao",l:"Fração ideal"},{k:"saldo",l:"Saldo"}];
  return (
    <div className="vfade">
      <Toolbar t={t} q={q} setQ={setQ} placeholder="Buscar por número, bloco ou responsável…"
        action={<Btn t={t} kind="primary" onClick={() => setNovo(true)}><Plus size={15} /> Unidade</Btn>}>
        <Sel t={t} value={st} onChange={setSt} opts={[["todos","Todos os status"],["ocupada","Ocupada"],["alugada","Alugada"],["vaga","Vaga"]]} />
      </Toolbar>
      <Tbl t={t} cols={cols} rows={rows} onRowClick={setSel}
        empty={<EmptyState t={t} icon={Home} title="Nenhuma unidade encontrada"
          hint="Ajuste a busca ou os filtros, ou cadastre a primeira unidade deste condomínio."
          action={<Btn t={t} kind="primary" onClick={() => setNovo(true)}><Plus size={14} /> Cadastrar unidade</Btn>} />}
        renderCell={(r, k) => {
          if (k === "num") return <b>{r.num} · Bloco {r.bloco}</b>;
          if (k === "status") return <Badge t={t} s={r.status} />;
          if (k === "fracao") return r.fracao.toFixed(2) + "%";
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
            <Field t={t} label="Responsável financeiro"><input defaultValue={sel.resp} style={inputStyle(t)} /></Field>
            <Field t={t} label="Fração ideal (%)"><input defaultValue={sel.fracao} style={inputStyle(t)} /></Field>
            <Field t={t} label="Área privativa (m²)"><input defaultValue="86" style={inputStyle(t)} /></Field>
            <Field t={t} label="Vagas vinculadas"><input defaultValue={sel.vagas} style={inputStyle(t)} /></Field>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[["Histórico de pagamentos", Wallet], ["Histórico de multas", Gavel], ["Moradores autorizados", Users]].map(([l, Ic]) => (
              <button key={l} className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs"
                style={{ borderColor: t.borderSoft, background: t.surface2 }}><Ic size={14} color={t.gold} /> {l}</button>))}
          </div>
          <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setSel(null)}>Fechar</Btn>
            <Btn t={t} kind="primary"><Check size={14} /> Salvar alterações</Btn></div>
        </Modal>)}
      {novo && (
        <Modal t={t} onClose={() => setNovo(false)} wide>
          <ModalHeader t={t} title="Nova unidade" onClose={() => setNovo(false)} />
          <form onSubmit={salvar}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field t={t} label="Tipo"><select name="tipo" style={inputStyle(t)}>{["Apartamento","Sala comercial","Loja","Cobertura","Box","Depósito"].map((x)=><option key={x}>{x}</option>)}</select></Field>
              <Field t={t} label="Bloco / torre"><input name="bloco" required placeholder="Ex.: B" style={inputStyle(t)} /></Field>
              <Field t={t} label="Número (ou início do intervalo)"><input name="numero" required placeholder={L("Ex.: 402, 1 ou 1D")} style={inputStyle(t)} /></Field>
              <Field t={t} label="Até o número (opcional)"><input name="numeroAte" placeholder={L("Ex.: 100 ou 4D — vazio cria só uma")} style={inputStyle(t)} /></Field>
              <Field t={t} label="Andar"><input name="andar" type="number" style={inputStyle(t)} /></Field>
              <Field t={t} label="Status"><select name="status" style={inputStyle(t)}>{["Ocupada","Vaga","Alugada","Vendida","Reservada","Inativa"].map((x)=><option key={x}>{x}</option>)}</select></Field>
              <Field t={t} label="Fração ideal (%)"><input name="fracao" required placeholder="0,00" style={inputStyle(t)} /></Field>
            </div>
            <div className="mt-3 text-xs" style={{ color: t.dim }}>
              {L("Preencha \"Até o número\" para criar várias unidades de uma vez: 1 até 100 cria 1, 2… 100; 1D até 4D cria 1D, 2D, 3D e 4D. Números que já existem no bloco são pulados. Tipo, andar, status e fração valem para todas.")}</div>
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
  const [salvar, saving] = useSubmit(async (f) => { await criarPessoa(db.ctx, f); await reload(); setNovo(false); });
  const papeis = ["Proprietário","Inquilino","Morador","Dependente","Síndico","Funcionário","Prestador","Visitante recorrente"];
  const rows = db.pessoas.filter((p) => (papel === "todos" || p.papel === papel) && p.nome.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="vfade">
      <Toolbar t={t} q={q} setQ={setQ} placeholder="Buscar por nome…"
        action={<Btn t={t} kind="primary" onClick={() => setNovo(true)}><Plus size={15} /> Pessoa</Btn>}>
        <Sel t={t} value={papel} onChange={setPapel} opts={[["todos","Todos os papéis"], ...papeis.map((p) => [p, p])]} />
      </Toolbar>
      <Tbl t={t} cols={[{k:"nome",l:"Nome"},{k:"papel",l:"Papel"},{k:"unidade",l:"Unidade"},{k:"doc",l:"CPF/CNPJ"},{k:"tel",l:"Telefone"},{k:"status",l:"Status"}]}
        rows={rows}
        empty={<EmptyState t={t} icon={Users} title="Nenhuma pessoa encontrada"
          hint="Cadastre proprietários, inquilinos, funcionários e prestadores com papéis separados para evitar confusão operacional." />}
        renderCell={(r, k) => {
          if (k === "nome") return (<span className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold" style={{ background: t.goldSoft, color: t.gold }}>{r.nome[0]}</span><b>{r.nome}</b></span>);
          if (k === "papel") return <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: t.surface2, color: t.text }}>{r.papel}</span>;
          if (k === "status") return <Badge t={t} s={r.status} />;
          return r[k];
        }} />
      {novo && (
        <Modal t={t} onClose={() => setNovo(false)} wide>
          <ModalHeader t={t} title="Nova pessoa" onClose={() => setNovo(false)} />
          <form onSubmit={salvar}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field t={t} label="Nome completo"><input name="nome" required style={inputStyle(t)} /></Field>
              <Field t={t} label="CPF ou CNPJ"><input name="doc" required style={inputStyle(t)} /></Field>
              <Field t={t} label="Papel no condomínio"><select name="papel" style={inputStyle(t)}>{papeis.map((p)=><option key={p}>{p}</option>)}</select></Field>
              <Field t={t} label="Unidade vinculada"><select name="unidade" style={inputStyle(t)}><option value="">—</option>{db.ctx.unidades.map((u)=><option key={u.id} value={u.id}>{u.label}</option>)}</select></Field>
              <Field t={t} label="Telefone"><input name="tel" style={inputStyle(t)} /></Field>
              <Field t={t} label="E-mail"><input name="email" type="email" style={inputStyle(t)} /></Field>
              <Field t={t} label="Data de entrada"><input name="inicio" type="date" style={inputStyle(t)} /></Field>
              <Field t={t} label="Documento (upload)"><div className="flex h-[42px] items-center justify-center rounded-xl border border-dashed text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>Anexar arquivo</div></Field>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setNovo(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={saving}><Check size={14} /> {saving ? "Salvando…" : "Cadastrar"}</Btn></div>
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
  const [salvar, saving] = useSubmit(async (f) => { await criarLancamento(db.ctx, f); await reload(); setNovo(false); });
  const rows = db.lanc.filter((l) => (l.desc + l.cat).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="vfade space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard t={t} icon={TrendingUp}  label={`A receber (${S.competencia})`} value={BRL(S.aReceber)} color={t.ok} />
        <StatCard t={t} icon={TrendingDown} label={`A pagar (${S.competencia})`}  value={BRL(S.aPagar)}  color={t.warn} />
        <StatCard t={t} icon={Wallet} label="Fundo de reserva" value={BRL(S.fundoReserva)} />
        <StatCard t={t} icon={Wallet} label="Fundo de obras"   value={BRL(S.fundoObras)} color={t.info} />
      </div>
      <div className="flex gap-1 overflow-x-auto">
        {[["lanc","Lançamentos"],["pagar","Contas a pagar"],["receber","Contas a receber"],["rateio","Rateio"],["extrato","Extrato por unidade"]].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: tab===k ? t.goldSoft : "transparent", color: tab===k ? t.gold : t.dim, border: `1px solid ${tab===k ? t.border : "transparent"}` }}>{l}</button>))}
      </div>
      {tab === "lanc" ? (<>
        <Toolbar t={t} q={q} setQ={setQ} placeholder="Buscar lançamento…"
          action={<><Btn t={t}><Download size={14} /> Exportar</Btn><Btn t={t} kind="primary" onClick={() => setNovo(true)}><Plus size={15} /> Lançamento</Btn></>} />
        <Tbl t={t} cols={[{k:"data",l:"Data"},{k:"tipo",l:"Tipo"},{k:"cat",l:"Categoria"},{k:"desc",l:"Descrição"},{k:"valor",l:"Valor"},{k:"status",l:"Status"}]}
          rows={rows}
          empty={<EmptyState t={t} icon={Wallet} title="Nenhum lançamento neste período"
            hint="Registre a primeira receita ou despesa da competência para começar a acompanhar o caixa." />}
          renderCell={(r, k) => {
            if (k === "tipo") return <span style={{ color: r.tipo === "receita" ? t.ok : t.info }}>{r.tipo === "receita" ? "Receita" : "Despesa"}</span>;
            if (k === "valor") return <b style={{ color: r.tipo === "receita" ? t.ok : t.text }}>{r.tipo === "receita" ? "+" : "−"}{BRL(r.valor)}</b>;
            if (k === "status") return <Badge t={t} s={r.status} />;
            return r[k];
          }} />
      </>) : (
        <EmptyState t={t} icon={ListChecks} title={`Módulo "${{pagar:"Contas a pagar",receber:"Contas a receber",rateio:"Rateio por unidade",extrato:"Extrato por unidade"}[tab]}" pronto para receber dados`}
          hint="Esta aba segue a mesma estrutura de tabela, filtros e ações — será populada quando o back-end estiver conectado." />)}
      {novo && (
        <Modal t={t} onClose={() => setNovo(false)} wide>
          <ModalHeader t={t} title="Novo lançamento" onClose={() => setNovo(false)} />
          <form onSubmit={salvar}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field t={t} label="Tipo"><select name="tipo" style={inputStyle(t)}><option>Despesa</option><option>Receita</option></select></Field>
              <Field t={t} label="Valor (R$)"><input name="valor" required placeholder="0,00" style={inputStyle(t)} /></Field>
              <Field t={t} label="Categoria"><select name="categoria" style={inputStyle(t)}>{[...new Set([...db.ctx.categorias.map((c) => c.nome), "Água","Luz","Gás","Limpeza","Portaria","Vigilância","Administração","Manutenção","Obras","Jardinagem","Seguro","Internet","Elevadores","Impostos","Honorários","Emergência","Fundo de reserva","Outros"])].map((c)=><option key={c}>{c}</option>)}</select></Field>
              <Field t={t} label="Subcategoria / centro de custo"><input name="centro" style={inputStyle(t)} /></Field>
              <Field t={t} label="Data"><input name="data" type="date" style={inputStyle(t)} /></Field>
              <Field t={t} label="Competência"><input name="competencia" type="month" style={inputStyle(t)} /></Field>
              <Field t={t} label="Forma de pagamento"><select name="forma" style={inputStyle(t)}><option>QR Verum Pay</option><option>Transferência</option><option>Débito automático</option><option>Dinheiro</option></select></Field>
              <Field t={t} label="Rateio"><select style={inputStyle(t)}><option>Não ratear</option><option>Por fração ideal</option><option>Igual por unidade</option><option>Por bloco/torre</option></select></Field>
            </div>
            <Field t={t} label="Descrição"><input name="desc" required style={{ ...inputStyle(t), marginTop: 4 }} /></Field>
            <div className="mt-3"><Field t={t} label="Nota fiscal (anexo)"><div className="flex h-14 items-center justify-center rounded-xl border border-dashed text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>Arraste a NF ou clique para anexar</div></Field></div>
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
  const [pagarOnline, pagando] = usePagarCommet();
  const [destino, setDestino] = useState(""); // "" = rateio para todas; senão, id da unidade
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
            {r.status !== "pago" && <Btn t={t} className="!px-2 !py-1 text-xs"><Send size={13} /> Reenviar</Btn>}</div>);
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
              {qr.status !== "pago" && (
                <Btn t={t} kind="primary" disabled={pagando} onClick={() => pagarOnline(qr.id)}>
                  <QrCode size={14} /> {pagando ? "Abrindo…" : "Pagar online"}</Btn>)}
              <Btn t={t}><Download size={14} /> Baixar</Btn>
              <Btn t={t}><Send size={14} /> Enviar por WhatsApp</Btn>
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
                    <option key={u.id} value={u.id}>{u.label}{moradorDa(u.label) ? ` — ${moradorDa(u.label)}` : ""}</option>))}
                </select>
              </Field>
              <Field t={t} label="Competência"><input name="competencia" type="month" defaultValue="2026-07" style={inputStyle(t)} /></Field>
              <Field t={t} label={destino ? "Valor da cobrança (R$)" : "Valor total a ratear (R$)"}><input name="total" required placeholder="Ex.: 88.900,00" style={inputStyle(t)} /></Field>
              {!destino && <Field t={t} label="Base de cálculo"><select style={inputStyle(t)}><option>Rateio por fração ideal</option></select></Field>}
              <Field t={t} label="Vencimento"><input name="vencimento" type="date" defaultValue="2026-07-10" style={inputStyle(t)} /></Field>
              <Field t={t} label="Canais de envio"><div className="flex flex-wrap gap-2">{["Portal","E-mail","WhatsApp"].map((c) => (
                <label key={c} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs" style={{ borderColor: t.borderSoft }}>
                  <input type="checkbox" defaultChecked /> {c}</label>))}</div></Field>
              <div className="rounded-xl border px-3 py-2.5 text-xs" style={{ borderColor: t.border, background: t.goldSoft, color: t.gold }}>
                {destino
                  ? `${L("Será gerada 1 cobrança para")} ${db.ctx.unidades.find((x) => x.id === destino)?.label}${moradorDa(db.ctx.unidades.find((x) => x.id === destino)?.label) ? ` (${moradorDa(db.ctx.unidades.find((x) => x.id === destino)?.label)})` : ""}. ${L("O morador verá o aviso no portal dele.")}`
                  : `${L("Serão geradas")} ${nAlvo} ${L("cobranças (unidades com responsável financeiro), rateadas por fração ideal.")}`}</div>
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
          <div className="mb-2 text-xs font-semibold" style={{ color: t.dim }}>PRÉVIA DO DOCUMENTO TIMBRADO</div>
          <Timbrado t={t} tipo={sel.valor > 0 ? "Notificação de multa" : "Advertência formal"} unidade={sel.unidade}
            valor={sel.valor > 0 ? sel.valor : null} prazo={sel.prazo !== "—" ? sel.prazo : null}
            corpo={`Fica a unidade ${sel.unidade} notificada pela infração "${sel.categoria}", registrada em ${sel.data}, conforme base normativa do regimento interno. ${sel.valor > 0 ? "O valor abaixo será lançado na próxima competência caso não haja defesa acolhida." : "Em caso de reincidência, será aplicada multa conforme tabela vigente."}`} />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Btn t={t}><Printer size={14} /> Imprimir PDF</Btn>
            <Btn t={t}><Send size={14} /> Enviar ao responsável</Btn>
            {role !== "morador" && sel.status === "aguardando_defesa" && (<>
              <Btn t={t} kind="danger" disabled={decidindo} onClick={() => decidir(false)}><Ban size={14} /> Cancelar multa</Btn>
              <Btn t={t} kind="primary" disabled={decidindo} onClick={() => decidir(true)}><Check size={14} /> {decidindo ? "Salvando…" : "Aprovar (síndico)"}</Btn></>)}
          </div>
        </Modal>)}
      {nova && (
        <Modal t={t} onClose={() => setNova(false)} wide>
          <ModalHeader t={t} title="Registrar infração" onClose={() => setNova(false)} />
          <form onSubmit={salvar}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field t={t} label="Categoria da infração"><select name="categoria" style={inputStyle(t)}>{["Barulho após horário de silêncio","Uso indevido de vaga","Descarte irregular de resíduos","Animal sem coleira","Dano à área comum","Obra fora do horário","Outra"].map((c)=><option key={c}>{c}</option>)}</select></Field>
              <Field t={t} label="Unidade responsável"><select name="unidade" required style={inputStyle(t)}>{db.ctx.unidades.map((u)=><option key={u.id} value={u.id}>{u.label}</option>)}</select></Field>
              <Field t={t} label="Data e hora"><input name="data" type="datetime-local" style={inputStyle(t)} /></Field>
              <Field t={t} label="Tipo de penalidade"><select name="tipo" style={inputStyle(t)}><option>Advertência (primeira ocorrência)</option><option>Multa</option></select></Field>
              <Field t={t} label="Valor (se multa)"><input name="valor" placeholder="R$ 0,00" style={inputStyle(t)} /></Field>
              <Field t={t} label="Prazo para defesa"><input name="prazo" type="date" style={inputStyle(t)} /></Field>
            </div>
            <Field t={t} label="Base normativa"><input name="base" placeholder="Ex.: Regimento interno, art. 12" style={{ ...inputStyle(t), marginTop: 4 }} /></Field>
            <Field t={t} label="Descrição detalhada"><textarea name="desc" rows={3} style={{ ...inputStyle(t), marginTop: 4, resize: "vertical" }} /></Field>
            <div className="mt-3"><Field t={t} label="Provas (foto, vídeo, áudio ou documento)">
              <div className="flex h-16 items-center justify-center rounded-xl border border-dashed text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>Arraste os arquivos de prova</div></Field></div>
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
  const [salvar, saving] = useSubmit(async (f) => { await criarComunicado(db.ctx, f); await reload(); setNovo(false); });
  return (
    <div className="vfade space-y-4">
      <div className="flex justify-end"><Btn t={t} kind="primary" onClick={() => setNovo(true)}><Plus size={15} /> Novo comunicado</Btn></div>
      <div className="space-y-2">
        {db.comunic.map((c) => (
          <Card t={t} key={c.id}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-xl p-2" style={{ background: t.goldSoft }}><Megaphone size={16} color={t.gold} /></div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{c.titulo}</div>
                <div className="text-xs" style={{ color: t.dim }}>{c.tipo} · {c.data} · enviado por {c.canal}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold" style={{ color: c.leitura > 80 ? t.ok : t.warn, fontFamily: "'Sora',sans-serif" }}>{c.leitura}%</div>
                <div className="text-[10px]" style={{ color: t.dim }}>leitura confirmada</div>
              </div>
              <Btn t={t} className="!px-2 !py-1 text-xs"><Eye size={13} /> Ver</Btn>
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
                <Field t={t} label="Destinatários"><select name="segmento" style={inputStyle(t)}><option>Todas as unidades</option><option>Bloco A</option><option>Bloco B</option><option>Lojas</option><option>Somente inadimplentes</option></select></Field>
              </div>
              <Field t={t} label="Título"><input name="titulo" required style={inputStyle(t)} /></Field>
              <Field t={t} label="Mensagem"><textarea name="corpo" rows={4} style={{ ...inputStyle(t), resize: "vertical" }} /></Field>
              <Field t={t} label="Canais"><div className="flex flex-wrap gap-2">{["Portal","E-mail","WhatsApp","Impressão"].map((c) => (
                <label key={c} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs" style={{ borderColor: t.borderSoft }}>
                  <input type="checkbox" name={`canal_${c}`} defaultChecked={c !== "Impressão"} /> {c}</label>))}</div></Field>
              <label className="flex items-center gap-2 text-xs" style={{ color: t.dim }}><input type="checkbox" defaultChecked /> Gerar versão timbrada em PDF e arquivar no módulo Documentos</label>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setNovo(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={saving}><Send size={14} /> {saving ? "Publicando…" : "Publicar e enviar"}</Btn></div>
          </form>
        </Modal>)}
    </div>
  );
}

/* ══════════════ DOCUMENTOS TIMBRADOS ══════════════ */
function Documentos({ t }) {
  const { db } = useData();
  const tipos = ["Todos","Comunicados","Convocações","Atas","Advertências","Multas","Recibos","Extratos","Autorizações","Ordens de serviço"];
  const [tipo, setTipo] = useState("Todos"); const [preview, setPreview] = useState(false);
  const docs = db.docs.filter((d) => tipo === "Todos" || d.tipo === tipo);
  return (
    <div className="vfade space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sel t={t} value={tipo} onChange={setTipo} opts={tipos.map((x) => [x, x])} />
        <Sel t={t} value="2026" onChange={() => {}} opts={[["2026","2026"],["2025","2025"]]} />
        <div className="ml-auto"><Btn t={t} kind="primary" onClick={() => setPreview(true)}><Plus size={15} /> Criar documento timbrado</Btn></div>
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
              <Btn t={t} className="!px-2 !py-1 text-xs"><Eye size={13} /> Ver</Btn>
              <Btn t={t} className="!px-2 !py-1 text-xs"><Download size={13} /> PDF</Btn>
            </div>
          </Card>))}</div>
      ) : (
        <EmptyState t={t} icon={FileText} title="Nenhum documento nesta categoria"
          hint="Documentos timbrados de multas, comunicados, atas e recibos são arquivados automaticamente aqui, com retenção por anos." />)}
      {preview && (
        <Modal t={t} onClose={() => setPreview(false)} wide>
          <ModalHeader t={t} title="Novo documento timbrado" onClose={() => setPreview(false)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field t={t} label="Tipo"><select style={inputStyle(t)}>{tipos.slice(1).map((x)=><option key={x}>{x}</option>)}</select></Field>
            <Field t={t} label="Unidade (se aplicável)"><select style={inputStyle(t)}><option>—</option>{db.ctx.unidades.map((u)=><option key={u.id}>{u.label}</option>)}</select></Field>
          </div>
          <Field t={t} label="Conteúdo"><textarea rows={3} defaultValue="Texto do documento…" style={{ ...inputStyle(t), marginTop: 4, resize: "vertical" }} /></Field>
          <div className="mb-2 mt-4 text-xs font-semibold" style={{ color: t.dim }}>PRÉVIA COM PAPEL TIMBRADO</div>
          <Timbrado t={t} tipo="Autorização" unidade="—" corpo="Texto do documento… O cabeçalho, logo, CNPJ, rodapé e assinatura são aplicados automaticamente pela identidade visual configurada no cadastro do condomínio." />
          <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setPreview(false)}>Cancelar</Btn>
            <Btn t={t} kind="primary" onClick={() => setPreview(false)}><Printer size={14} /> Gerar PDF</Btn></div>
        </Modal>)}
    </div>
  );
}

/* ══════════════ CHAMADOS DE MANUTENÇÃO ══════════════ */
function Chamados({ t }) {
  const { db, reload } = useData();
  const [novo, setNovo] = useState(false); const [st, setSt] = useState("todos");
  const [salvar, saving] = useSubmit(async (f) => { await criarChamado(db.ctx, f); await reload(); setNovo(false); });
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
                  <Card t={t} key={c.id}>
                    <div className="flex items-center justify-between text-xs" style={{ color: t.dim }}>
                      <span>{c.num} · {c.cat}</span><Badge t={t} s={c.prio} /></div>
                    <div className="mt-1 text-sm font-medium">{c.desc}</div>
                    <div className="mt-2 flex items-center justify-between text-xs" style={{ color: t.dim }}>
                      <span><User size={11} className="mr-1 inline" />{c.resp}</span>
                      <span>{c.custo > 0 ? BRL(c.custo) : L("sem custo lançado")}</span></div>
                  </Card>))}
              </div>
            </div>);
        })}
      </div>
      {novo && (
        <Modal t={t} onClose={() => setNovo(false)} wide>
          <ModalHeader t={t} title="Abrir chamado de manutenção" onClose={() => setNovo(false)} />
          <form onSubmit={salvar}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field t={t} label="Categoria"><select name="categoria" style={inputStyle(t)}>{["Elétrica","Hidráulica","Pintura","Limpeza","Elevador","Portão","Câmeras","Jardinagem","Estrutural","Telhado","Área comum","Equipamentos","Emergência"].map((c)=><option key={c}>{c}</option>)}</select></Field>
              <Field t={t} label="Prioridade"><select name="prioridade" style={inputStyle(t)}><option>Baixa</option><option>Média</option><option>Alta</option></select></Field>
              <Field t={t} label="Responsável"><select name="responsavel" style={inputStyle(t)}><option value="">Designar depois</option>{db.ctx.operacionais.map((o)=><option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
              <Field t={t} label="Prazo"><input name="prazo" type="date" style={inputStyle(t)} /></Field>
              <Field t={t} label="Custo estimado"><input name="custo" placeholder="R$ 0,00" style={inputStyle(t)} /></Field>
              <Field t={t} label="Fotos / vídeos"><div className="flex h-[42px] items-center justify-center rounded-xl border border-dashed text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>Anexar mídia</div></Field>
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
function Portaria({ t }) {
  const { db, reload } = useData();
  const S = db.stats;
  const [novo, setNovo] = useState(false);
  const [salvar, saving] = useSubmit(async (f) => { await criarPreAutorizacao(db.ctx, f); await reload(); setNovo(false); });
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
        <Btn t={t} kind="soft"><QrCode size={14} /> Gerar QR de acesso</Btn>
        <Btn t={t}><AlertCircle size={14} /> Registrar ocorrência</Btn>
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
              <Field t={t} label="Unidade de destino"><select name="unidade" required style={inputStyle(t)}>{db.ctx.unidades.map((u)=><option key={u.id} value={u.id}>{u.label}</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field t={t} label="Data"><input name="data" type="date" style={inputStyle(t)} /></Field>
                <Field t={t} label="Janela de horário"><input name="janela" placeholder="14h — 18h" style={inputStyle(t)} /></Field>
              </div>
              <Field t={t} label="Veículo (opcional)"><input name="placa" placeholder="Placa" style={inputStyle(t)} /></Field>
              <div className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: t.border, background: t.goldSoft, color: t.gold }}>
                Um QR Code de acesso será enviado ao visitante e validado pela portaria na entrada.</div>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setNovo(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={saving}><QrCode size={14} /> {saving ? "Autorizando…" : "Autorizar e gerar QR"}</Btn></div>
          </form>
        </Modal>)}
    </div>
  );
}

/* ══════════════ GERENCIAR EMAILS (exclusivo do diretor) ══════════════ */
function GerenciarEmails({ t }) {
  const { db } = useData();
  const unidades = db.ctx.unidades; // unidades cadastradas na tela Unidades
  const [usuarios, setUsuarios] = useState(null); // null = carregando do banco
  const [novo, setNovo] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [perfil, setPerfil] = useState("sindico");
  const perfis = ["sindico", "tesouraria", "administradora", "morador"];

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
          Os acessos criados aqui são o que cada pessoa usará na tela de entrada. Síndico, tesouraria e administradora entram com e-mail; o morador entra com o nome cadastrado.</div>
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
          hint="Cadastre o primeiro e-mail e senha para que síndico, tesouraria, administradora e moradores consigam entrar."
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
                        {unidades.map((u) => <option key={u.id} value={u.label}>{u.label}</option>)}
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

/* ══════════════ PAINEL SAAS DA ADMINISTRADORA ══════════════ */
function SaaS({ t }) {
  const { db } = useData();
  const S = db.stats;
  const [novo, setNovo] = useState(false);
  return (
    <div className="vfade space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard t={t} icon={Building2} label="Condomínios ativos" value={String(S.tenantsAtivos)} />
        <StatCard t={t} icon={Wallet} label="Receita recorrente (MRR)" value={BRL(S.mrr)} color={t.ok} />
        <StatCard t={t} icon={Clock} label="Em período de teste" value={String(S.tenantsTeste)} color={t.warn} />
        <StatCard t={t} icon={AlertCircle} label="Licenças inadimplentes" value={String(S.tenantsInadimplentes)} color={t.danger} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card t={t} className="lg:col-span-2">
          <SectionTitle t={t}>Evolução da receita recorrente</SectionTitle>
          <div style={{ height: 190 }}>
            <ResponsiveContainer><AreaChart data={M_MRR}>
              <defs><linearGradient id="gm" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={t.gold} stopOpacity={0.35} /><stop offset="100%" stopColor={t.gold} stopOpacity={0} />
              </linearGradient></defs>
              <CartesianGrid stroke={t.borderSoft} vertical={false} />
              <XAxis dataKey="m" tick={{ fill: t.dim, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: t.dim, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => "R$" + v} />
              <RTooltip {...chartTip(t)} formatter={(v) => BRL(v)} />
              <Area dataKey="v" stroke={t.gold} strokeWidth={2.5} fill="url(#gm)" />
            </AreaChart></ResponsiveContainer>
          </div>
        </Card>
        <Card t={t}>
          <SectionTitle t={t}>Planos</SectionTitle>
          <div className="space-y-2 text-sm">
            {[["Essencial","até 40 unidades · módulos básicos", BRL(290)],
              ["Standard","até 80 unidades · + portaria e chamados", BRL(490)],
              ["Premium","ilimitado · todos os módulos + WhatsApp", BRL(890)]].map(([n, d, p]) => (
              <div key={n} className="rounded-xl border p-3" style={{ borderColor: n === "Premium" ? t.border : t.borderSoft, background: n === "Premium" ? t.goldSoft : "transparent" }}>
                <div className="flex items-center justify-between">
                  <b style={{ color: n === "Premium" ? t.gold : t.text }}>{n}</b>
                  <span className="text-xs font-semibold">{p}/mês</span></div>
                <div className="text-xs" style={{ color: t.dim }}>{d}</div>
              </div>))}
          </div>
        </Card>
      </div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ fontFamily: "'Sora',sans-serif" }}>Condomínios contratantes</h2>
        <Btn t={t} kind="primary" onClick={() => setNovo(true)}><Plus size={15} /> Novo cliente</Btn>
      </div>
      <Tbl t={t} cols={[{k:"nome",l:"Condomínio"},{k:"plano",l:"Plano"},{k:"unidades",l:"Unidades"},{k:"mrr",l:"Mensalidade"},{k:"venc",l:"Renovação"},{k:"status",l:"Status"},{k:"acao",l:""}]}
        rows={db.tenants} empty={null}
        renderCell={(r, k) => {
          if (k === "mrr") return r.mrr ? BRL(r.mrr) : "—";
          if (k === "status") return <Badge t={t} s={r.status} />;
          if (k === "acao") return r.status === "inadimplente"
            ? <Btn t={t} kind="danger" className="!px-2 !py-1 text-xs"><Ban size={12} /> Bloquear acesso</Btn>
            : <Btn t={t} className="!px-2 !py-1 text-xs"><ArrowUpRight size={12} /> Abrir painel</Btn>;
          return r[k];
        }} />
      {novo && (
        <Modal t={t} onClose={() => setNovo(false)} wide>
          <ModalHeader t={t} title="Contratar novo condomínio" onClose={() => setNovo(false)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field t={t} label="Razão social"><input style={inputStyle(t)} /></Field>
            <Field t={t} label="Nome fantasia"><input style={inputStyle(t)} /></Field>
            <Field t={t} label="CNPJ"><input style={inputStyle(t)} /></Field>
            <Field t={t} label="Responsável"><input style={inputStyle(t)} /></Field>
            <Field t={t} label="Plano"><select style={inputStyle(t)}><option>Essencial</option><option>Standard</option><option>Premium</option></select></Field>
            <Field t={t} label="Forma de pagamento da licença"><select style={inputStyle(t)}><option>QR Verum Pay mensal</option><option>Transferência</option></select></Field>
          </div>
          <div className="mt-3 space-y-1.5 rounded-xl border p-3 text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>
            <div className="font-semibold" style={{ color: t.text }}>Checklist de implantação</div>
            {["Aceite do contrato","Verificação de documentos","Carga inicial de unidades e pessoas","Configuração da identidade visual","Ativação dos módulos do plano"].map((s) => (
              <label key={s} className="flex items-center gap-2"><input type="checkbox" /> {s}</label>))}
          </div>
          <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setNovo(false)}>Cancelar</Btn>
            <Btn t={t} kind="primary" onClick={() => setNovo(false)}><Check size={14} /> Iniciar implantação</Btn></div>
        </Modal>)}
    </div>
  );
}

/* ══════════════ PORTAL DO MORADOR ══════════════ */
function PortalMorador({ t, onLogout, dark, setDark, lang, onLang, morador }) {
  const { db, reload } = useData();
  const [tab, setTab] = useState("inicio"); const [qr, setQr] = useState(null); const [chamado, setChamado] = useState(false);
  const [aviso, setAviso] = useState(null); // comunicado aberto para leitura completa
  const [multa, setMulta] = useState(null); // multa aberta para ver os detalhes
  const [pagarOnline, pagando] = usePagarCommet();
  const [enviarChamado, enviando] = useSubmit(async (f) => { await criarChamado(db.ctx, f); await reload(); setChamado(false); });
  /* unidade do morador logado (escolhida pelo diretor em Gerenciar Emails); fallback: demo 102-A */
  const unidade = morador?.unidade || (db.unidades.find((u) => u.num === "102") ? "102-A" : (db.unidades[0] ? `${db.unidades[0].num}-${db.unidades[0].bloco}` : "—"));
  const boletos = morador?.unidade
    ? db.cobr.filter((c) => c.unidade === unidade).map((c) => ({ id: c.id, comp: c.comp, desc: "Taxa condominial", valor: c.valor, venc: c.vencFull, status: c.status }))
    : db.boletos;
  const pend = boletos.find((b) => b.status === "vencida") || boletos.find((b) => b.status === "emitida");
  const abertas = boletos.filter((b) => b.status === "vencida" || b.status === "emitida").length;
  const minhasMultasLista = db.multas.filter((m) => m.unidade === unidade);
  const minhasMultas = minhasMultasLista.filter((m) => m.status === "aguardando_defesa").length;
  const meusChamados = db.chamados.filter((c) => c.status === "aberto" || c.status === "andamento").length;
  return (
    <div style={{ background: t.bg, color: t.text, minHeight: "100vh", fontFamily: "'Inter',system-ui,sans-serif" }}>
      <header className="sticky top-0 z-30 border-b px-4 py-3 backdrop-blur-md" style={{ background: t.glass, borderColor: t.borderSoft }}>
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold" style={{ background: t.goldSoft, color: t.gold, fontFamily: "'Sora',sans-serif" }}>AC</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold" style={{ fontFamily: "'Sora',sans-serif" }}>Residencial Águas Claras</div>
            <div className="text-xs" style={{ color: t.dim }}>{morador?.nome || L("Morador")} · {L("Unidade")} {unidade}</div>
          </div>
          <LangSel t={t} lang={lang} onLang={onLang} />
          <button onClick={() => setDark(!dark)} className="rounded-lg p-2" style={{ background: t.surface2 }}>{dark ? <Sun size={15} color={t.gold} /> : <Moon size={15} color={t.gold} />}</button>
          <button onClick={onLogout} className="rounded-lg p-2" style={{ background: t.surface2 }} title={L("Sair")}><LogOut size={15} color={t.dim} /></button>
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
              {[["Boletos e QR", QrCode, "pagamentos"], ["Extrato", Wallet, "pagamentos"], ["Comunicados", Megaphone, "comunicados"], ["Abrir chamado", Wrench, null]].map(([l, Ic, dest]) => (
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
            {minhasMultasLista.length > 0 && (
              <Card t={t}>
                <SectionTitle t={t}>Multas da unidade</SectionTitle>
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
              </Card>)}
            <Card t={t}>
              <SectionTitle t={t}>Minha situação</SectionTitle>
              <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: t.dim }}>
                <div>Multas ativas: <b style={{ color: minhasMultas ? t.warn : t.text }}>{minhasMultas ? `${minhasMultas} em prazo de defesa` : "nenhuma"}</b></div>
                <div>Vagas: <b style={{ color: t.text }}>{db.unidades.find((u) => `${u.num}-${u.bloco}` === unidade)?.vagas ?? 0}</b></div>
                <div>Encomendas: <b style={{ color: t.gold }}>{db.stats.encomendas} registrada(s)</b></div>
                <div>Chamados abertos: <b style={{ color: t.text }}>{meusChamados}</b></div>
              </div>
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
      </main>
      {/* navegação inferior mobile-first */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t px-4 py-2 backdrop-blur-md" style={{ background: t.glass, borderColor: t.borderSoft }}>
        <div className="mx-auto flex max-w-lg justify-around">
          {[["inicio","Início",Home],["pagamentos","Pagamentos",QrCode],["comunicados","Avisos",Megaphone]].map(([k,l,Ic]) => (
            <button key={k} onClick={() => setTab(k)} className="relative flex flex-col items-center gap-0.5 rounded-lg px-4 py-1.5 text-[10px] font-medium"
              style={{ color: tab === k ? t.gold : t.dim }}>
              <Ic size={18} /> {L(l)}
              {k === "pagamentos" && abertas > 0 && (
                <span className="absolute -top-1 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold"
                  style={{ background: t.danger, color: "#fff" }}>{abertas}</span>)}
            </button>))}
        </div>
      </nav>
      {qr && (
        <Modal t={t} onClose={() => setQr(null)}>
          <ModalHeader t={t} title={`Pagar ${qr.desc} — ${qr.comp}`} onClose={() => setQr(null)} />
          <div className="flex flex-col items-center gap-3 text-center">
            <QRMock seed={qr.id} />
            <div className="text-2xl font-bold" style={{ fontFamily: "'Sora',sans-serif", color: t.gold }}>{BRL(qr.valor)}</div>
            <div className="text-xs" style={{ color: t.dim }}>Aponte a câmera do seu app de pagamento.<br />A confirmação é automática e o comprovante ficará disponível aqui.</div>
            <div className="flex flex-wrap justify-center gap-2">
              <Btn t={t} kind="primary" disabled={pagando} onClick={() => pagarOnline(qr.id)}>
                <QrCode size={14} /> {pagando ? "Abrindo…" : "Pagar online"}</Btn>
              <Btn t={t} kind="soft"><Download size={14} /> Copiar código</Btn>
            </div>
          </div>
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
          {multa.status === "aguardando_defesa" && (
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
          <ModalHeader t={t} title="Abrir chamado" onClose={() => setChamado(false)} />
          <form onSubmit={enviarChamado}>
            <div className="space-y-3">
              <Field t={t} label="Categoria"><select name="categoria" style={inputStyle(t)}><option>Hidráulica</option><option>Elétrica</option><option>Área comum</option><option>Outro</option></select></Field>
              <Field t={t} label="Descrição"><textarea name="desc" required rows={3} style={{ ...inputStyle(t), resize: "vertical" }} /></Field>
              <Field t={t} label="Foto (opcional)"><div className="flex h-14 items-center justify-center rounded-xl border border-dashed text-xs" style={{ borderColor: t.borderSoft, color: t.dim }}>Anexar foto</div></Field>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Btn t={t} onClick={() => setChamado(false)}>Cancelar</Btn>
              <Btn t={t} kind="primary" type="submit" disabled={enviando}><Send size={14} /> {enviando ? "Enviando…" : "Enviar chamado"}</Btn></div>
          </form>
        </Modal>)}
    </div>
  );
}

/* ══════════════ PAYWALL — LICENÇA SAAS ══════════════
   Bloqueia o acesso ao sistema enquanto a assinatura do condomínio não
   estiver ativa. O pagamento abre o checkout Commet; a ativação chega
   pelo webhook (subscription.activated) e o botão "Verificar" recarrega. */
function Paywall({ t, licenca, tenant, condominioId, onLogout, onReload }) {
  const [gerando, setGerando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [erro, setErro] = useState("");

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
      const url = await assinarLicencaCommet(condominioId);
      window.open(url, "_blank", "noopener");
    } catch (e) { setErro(e.message); }
    finally { setGerando(false); }
  };

  const MSG = {
    teste: "O período de avaliação requer a ativação da assinatura para continuar.",
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
          <h1 className="text-lg font-bold" style={{ fontFamily: "'Sora',sans-serif" }}>{L("Assinatura pendente")}</h1>
          <p className="mt-2 text-sm" style={{ color: t.dim }}>
            {L(MSG[licenca] || "O acesso é liberado após a confirmação do pagamento da licença.")}</p>
          {tenant && tenant.plano !== "—" && (
            <div className="mt-4 rounded-xl border p-3 text-sm" style={{ borderColor: t.borderSoft }}>
              <div className="flex items-center justify-between">
                <span style={{ color: t.dim }}>{L("Plano")}</span><b>{tenant.plano}</b></div>
              {tenant.precoPlano ? (
                <div className="mt-1 flex items-center justify-between">
                  <span style={{ color: t.dim }}>{L("Mensalidade")}</span><b>{BRL(tenant.precoPlano)}/mês</b></div>) : null}
            </div>)}
          {erro && <div className="mt-3 rounded-xl border p-2.5 text-xs" style={{ borderColor: t.danger, color: t.danger }}>{erro}</div>}
          <div className="mt-5 space-y-2">
            <Btn t={t} kind="primary" className="w-full" disabled={gerando} onClick={pagar}>
              <QrCode size={15} /> {gerando ? L("Gerando checkout…") : L("Pagar assinatura")}</Btn>
            <Btn t={t} className="w-full" disabled={verificando}
              onClick={async () => { setErro(""); if (!(await verificar())) setErro(L("O Commet ainda não confirmou este pagamento. Aguarde alguns instantes e verifique de novo.")); }}>
              <RefreshCw size={15} className={verificando ? "vpulse" : ""} /> {L("Já paguei — verificar")}</Btn>
            <Btn t={t} className="w-full" onClick={onLogout}><LogOut size={15} /> {L("Sair")}</Btn>
          </div>
          <p className="mt-4 text-[11px]" style={{ color: t.dim }}>
            {L("O pagamento abre em uma nova aba, em ambiente seguro. A liberação é automática após a confirmação.")}</p>
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
  const [role, setRole] = useState(null);
  const [morador, setMorador] = useState(null); // { nome, unidade } do morador logado
  const [diretorConta, setDiretorConta] = useState(null); // conta do diretor logado (para o 1º acesso)
  const [screen, setScreen] = useState("dashboard");
  const [sideOpen, setSideOpen] = useState(false);
  const t = dark ? THEMES.dark : THEMES.light;
  const [phase, retry] = useLoad(screen);

  /* carga dos dados do Supabase */
  const [db, setDb] = useState(null);
  const [dbErr, setDbErr] = useState(null);
  const reload = useCallback(async () => {
    setDbErr(null);
    try { setDb(await loadAll()); }
    catch (e) { console.error("[Supabase]", e); setDbErr(e); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const dataValue = useMemo(() => ({ db, reload }), [db, reload]);

  const go = useCallback((s) => { setScreen(s); setSideOpen(false); }, []);
  const nav = NAV.filter((n) => role && n.roles.includes(role));

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

  if (!role) return <DataCtx.Provider value={dataValue}>{globalStyle}<Login t={t} dark={dark} setDark={setDark} lang={lang} onLang={onLang} onEnter={(r, m, d) => { setMorador(m || null); setDiretorConta(d || null); setRole(r); setScreen(r === "administradora" ? "saas" : "dashboard"); }} /></DataCtx.Provider>;
  if (db?.vazio) return (
    <DataCtx.Provider value={dataValue}>{globalStyle}
      <SetupCondominio t={t} role={role} diretor={diretorConta} dark={dark} setDark={setDark} onCriado={reload} onSair={() => setRole(null)} />
    </DataCtx.Provider>);

  /* ── PAYWALL: sem assinatura ativa, nenhum perfil do condomínio entra ──
     (a administradora — dona do SaaS — continua acessando o painel) */
  const tenantPrincipal = db && !db.vazio ? db.tenants.find((x) => x.id === db.ctx.condominioId) : null;
  if (db && role !== "administradora" && tenantPrincipal && tenantPrincipal.status !== "ativo") return (
    <DataCtx.Provider value={dataValue}>{globalStyle}
      <Paywall t={t} licenca={tenantPrincipal.status} tenant={tenantPrincipal} condominioId={db.ctx.condominioId}
        onLogout={() => setRole(null)} onReload={reload} />
    </DataCtx.Provider>);

  if (role === "morador") return (
    <DataCtx.Provider value={dataValue}>{globalStyle}
      {db ? <PortalMorador t={t} dark={dark} setDark={setDark} lang={lang} onLang={onLang} morador={morador} onLogout={() => setRole(null)} />
        : <div className="mx-auto max-w-lg p-4" style={{ background: t.bg, minHeight: "100vh" }}>
            {dbErr ? <ErrorState t={t} onRetry={reload} /> : <Skeleton t={t} />}</div>}
    </DataCtx.Provider>);

  const SCREENS = {
    dashboard: <Dashboard t={t} role={role} go={go} />, condominio: <Condominio t={t} />,
    unidades: <Unidades t={t} />, pessoas: <Pessoas t={t} />, financeiro: <Financeiro t={t} />,
    cobrancas: <Cobrancas t={t} />, multas: <Multas t={t} role={role} />, comunicados: <Comunicados t={t} />,
    documentos: <Documentos t={t} />, chamados: <Chamados t={t} />, portaria: <Portaria t={t} />, saas: <SaaS t={t} />,
    emails: <GerenciarEmails t={t} />,
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
                <div className="text-[10px]" style={{ color: t.dim }}>{role === "administradora" ? "Painel SaaS" : (db?.ctx.condominioNome || "…")}</div>
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
            <div className="mt-4 border-t pt-3" style={{ borderColor: t.borderSoft }}>
              <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold" style={{ background: t.goldSoft, color: t.gold }}>
                  {L(PROFILES[role].label)[0]}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{L(PROFILES[role].label)}</div>
                  <div className="text-[10px]" style={{ color: t.dim }}>{L("Perfil de acesso")}</div>
                </div>
                <button onClick={() => setRole(null)} title="Sair" className="rounded-lg p-1.5" style={{ background: t.surface2 }}><LogOut size={14} color={t.dim} /></button>
              </div>
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
                  {L({dashboard:"Visão geral do condomínio em tempo real",condominio:"Cadastro-mãe: dados legais, gestão e regras internas",
                    unidades:"96 unidades · 2 torres + térreo comercial",pessoas:"Papéis separados: proprietário, inquilino, funcionário e prestador",
                    financeiro:"Competência 06/2026 · aprovações do síndico ativas",cobrancas:"QR Code Verum Pay com baixa automática",
                    multas:"Fluxo com prova, defesa e aprovação",comunicados:"Envio por portal, e-mail e WhatsApp",
                    documentos:"Arquivo timbrado com retenção histórica",chamados:"Ordens de serviço por categoria e prioridade",
                    portaria:"Controle de acessos, entregas e ocorrências",saas:"Clientes, planos, licenças e implantação",
                    emails:"E-mails e senhas de acesso dos perfis síndico, tesouraria, administradora e morador"}[screen])}</div>
              </div>
              <LangSel t={t} lang={lang} onLang={onLang} />
              <button className="relative rounded-lg p-2" style={{ background: t.surface2 }} title={L("Notificações")}>
                <Bell size={16} color={t.dim} />
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full" style={{ background: t.danger }} /></button>
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
