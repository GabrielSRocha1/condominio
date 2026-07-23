# CondoMaster Pro — Especificação do Front-end (v1)

Interface premium no design system Verum (navy `#0A0E1A` / gold `#D4AF37`, Sora + Inter, glassmorphism), sem back-end, banco ou integrações reais. Tudo abaixo está implementado no arquivo `CondoMasterPro.jsx` com dados mock.

---

## 1. Mapa das telas

| # | Tela | Perfis | Conteúdo |
|---|------|--------|----------|
| 0 | **Login** | todos | Seleção de perfil → e-mail/senha (demo) |
| 1 | **Dashboard** | diretor, síndico, tesouraria | Cards KPI, 4 gráficos, ações rápidas, aprovações/alertas, atividade recente |
| 2 | **Condomínio** | diretor, síndico | Cadastro-mãe em 4 abas: dados gerais, gestão, regras internas, identidade visual |
| 3 | **Unidades** | diretor, síndico, tesouraria | Tabela filtrável + modal detalhe + modal criação |
| 4 | **Pessoas** | diretor, síndico | Tabela com papéis separados + cadastro |
| 5 | **Financeiro** | diretor, síndico, tesouraria | KPIs + 5 abas (lançamentos, a pagar, a receber, rateio, extrato) + modal de lançamento |
| 6 | **Cobranças QR** | diretor, síndico, tesouraria | KPIs, tabela, modal QR Verum Pay, geração em lote da competência |
| 7 | **Multas** | diretor, síndico | Lista com reincidência, detalhe com provas/defesa/aprovação + **prévia timbrada** |
| 8 | **Comunicados** | diretor, síndico | Lista com % de leitura + composer multicanal |
| 9 | **Documentos** | diretor, síndico, tesouraria | Arquivo por tipo/ano + gerador de documento timbrado |
| 10 | **Manutenção** | diretor, síndico | Kanban 3 colunas (aberto/andamento/concluído) + abertura de OS |
| 11 | **Portaria** | diretor, síndico | KPIs, timeline de acessos, pré-autorização com QR |
| 12 | **Painel SaaS** | administradora | MRR, planos, tenants, bloqueio por inadimplência, checklist de implantação |
| 13 | **Portal do morador** | morador | Layout próprio mobile-first: início, pagamentos (QR), avisos, chamado |

## 2. Estrutura de navegação

- **Login → shell por perfil.** O array `NAV` define `roles` por item; o menu é filtrado automaticamente.
- **Admin shell**: sidebar fixa (desktop) / drawer (mobile) + topbar com título contextual, notificações e tema.
- **Morador**: shell separado com bottom-nav (Início · Pagamentos · Avisos) — padrão de app.
- **Administradora**: entra direto no Painel SaaS; do tenant, botão "Abrir painel" (futura troca de contexto).
- Ações profundas via modais (detalhe/criação), mantendo a navegação rasa: nenhuma tela está a mais de 2 toques.

## 3. Componentes reutilizáveis

`Badge` (status semânticos centralizados em `STATUS_META`) · `Card` · `StatCard` (KPI com tendência) · `SectionTitle` · `Btn` (primary/ghost/danger/soft) · `Field`/`inputStyle` · `Modal` + `ModalHeader` · `EmptyState` · `ErrorState` · `Skeleton` · `Tbl` (tabela → cards no mobile) · `Toolbar` (busca + filtros + ação) · `Sel` · `QRMock` (QR ilustrativo determinístico) · `Timbrado` (**assinatura visual do produto**: papel creme, filete dourado, cabeçalho com logo/CNPJ, assinatura) · hook `useLoad` (ciclo loading→ready por tela).

## 4. Layout da dashboard

1. **Linha 1** — 4 StatCards: saldo em caixa, receitas, despesas, inadimplência (com tendência ↑↓).
2. **Linha 2** — botões de ação rápida (nova cobrança, gasto, multa, comunicado, chamado), filtrados por perfil.
3. **Linha 3** — gráfico de linha (evolução receita × despesa, 2/3) + donut de distribuição de receitas (1/3).
4. **Linha 4** — barras horizontais (despesas por categoria) + área (inadimplência no tempo).
5. **Linha 5** — aprovações pendentes/alertas clicáveis (navegam ao módulo) + atividade recente.

Responde em segundos: quanto entrou, quanto saiu, quem deve, o que está vencendo.

## 5. Organização visual por perfil

- **Diretor**: dashboard completo + card "Aprovações pendentes"; acesso a tudo, foco em leitura.
- **Síndico**: mesmo shell, alertas operacionais; botões de decisão (aprovar multa) aparecem para ele.
- **Tesouraria**: menu reduzido a unidades/financeiro/cobranças/documentos; dashboard financeiro.
- **Administradora**: só Painel SaaS (MRR, tenants, planos, bloqueio).
- **Morador**: app separado, 3 abas, linguagem simples, CTA de pagamento em destaque.
- O conceito **alto vs. baixo padrão** entra depois como feature flags no mesmo shell (menos itens de menu, menos abas).

## 6. Campos por tela (resumo)

- **Condomínio**: nome fantasia, razão social, CNPJ, inscrição municipal, endereço, tipo, porte, torres/blocos, unidades/vagas | administradora, síndico, diretor, tesouraria, início da gestão, status SaaS | horário de silêncio, mudanças, obras, visitantes, animais, áreas comuns | logo, cor primária.
- **Unidade**: tipo, número, bloco, andar, status, fração ideal, área privativa, vagas, proprietário, responsável financeiro + atalhos para históricos (pagamentos, multas, moradores).
- **Pessoa**: nome, CPF/CNPJ, papel, unidade vinculada, telefone, e-mail, data de entrada, documento anexo.
- **Lançamento**: tipo, valor, categoria (23 do escopo), subcategoria/centro de custo, data, competência, forma de pagamento, rateio, descrição, NF anexa → "enviar para aprovação".
- **Cobrança (lote)**: competência, base de cálculo (fração/fixo/bloco), vencimento, canais (portal/e-mail/WhatsApp).
- **Multa**: categoria, unidade, data/hora, advertência vs. multa, valor, prazo de defesa, descrição, provas — com prévia do timbrado antes da emissão.
- **Comunicado**: tipo, destinatários, título, mensagem, canais, opção de arquivar timbrado.
- **Chamado**: categoria (13 do escopo), prioridade, responsável, prazo, custo estimado, mídia, descrição.
- **Pré-autorização**: tipo, nome, unidade destino, data, janela de horário, placa → QR de acesso.
- **Tenant SaaS**: razão social, fantasia, CNPJ, responsável, plano, forma de pagamento + checklist de implantação (5 passos).

## 7. Estados vazio, loading e erro

- **Loading**: `Skeleton` com pulso em toda troca de tela (simulado em 600ms) — pronto para virar estado real de fetch.
- **Vazio**: `EmptyState` com ícone, título, orientação e CTA ("Cadastrar unidade", "Gerar cobranças do mês"). Cada vazio orienta a próxima ação, nunca só constata.
- **Erro**: `ErrorState` com explicação e botão "Tentar novamente".
- Estados locais: filtros sem resultado, colunas kanban vazias, botões com feedback ("Salvo ✓"), QR marcado como ilustrativo.

## 8. Responsividade

- **Mobile-first**: `Tbl` colapsa tabelas em cards etiquetados; sidebar vira drawer com overlay; modais sobem como bottom-sheet (`rounded-t-3xl` + `items-end`); grids `2 → 4` colunas; portal do morador usa bottom-nav nativa de app.
- Breakpoints Tailwind: base (≤640) empilhado · `sm` formulários em 2 colunas · `md` tabelas reais e kanban 3 colunas · `lg` sidebar fixa + grids 3-4 colunas.
- Acessibilidade de base: `focus-visible` dourado, `prefers-reduced-motion`, `aria-modal`, alvos de toque ≥ 40px.

## 9. Componentes de gráfico (recharts)

| Gráfico | Uso | Componente |
|---|---|---|
| Linha dupla | Receita × despesa mensal | `LineChart` |
| Barras horizontais | Despesa por categoria | `BarChart layout="vertical"` |
| Donut | Distribuição de receitas | `PieChart` + `innerRadius` |
| Área com gradiente | Inadimplência no tempo; MRR do SaaS | `AreaChart` + `linearGradient` |
| Anel de progresso | % concluído (reuso do padrão Canvas) | SVG próprio |

Todos com tooltip estilizado no tema, eixos limpos (sem linhas), `ResponsiveContainer`. Na produção, mesma API alimentada pelo endpoint de indicadores.

## 10. Organização de pastas (para a migração Vite)

```
src/
├── app/                    # shell, rotas, providers
│   ├── App.tsx
│   ├── router.tsx          # react-router com guarda por perfil
│   └── providers/          # ThemeProvider, AuthProvider (mock → real)
├── design-system/
│   ├── tokens.ts           # THEMES, STATUS_META, cores Verum
│   └── components/         # Badge, Card, StatCard, Btn, Modal, Tbl,
│                           # Toolbar, EmptyState, ErrorState, Skeleton,
│                           # Field, QRMock, Timbrado
├── features/               # 1 pasta por módulo (tela + subcomponentes + mocks)
│   ├── auth/  dashboard/  condominio/  unidades/  pessoas/
│   ├── financeiro/  cobrancas/  multas/  comunicados/
│   ├── documentos/  chamados/  portaria/  saas/  portal-morador/
├── lib/
│   ├── api/                # client HTTP (hoje mock, depois REST/GraphQL)
│   ├── format.ts           # BRL, datas pt-BR
│   └── permissions.ts      # NAV + matriz perfil × módulo
└── mocks/                  # dados de demonstração centralizados
```

Regra: `features/` não importa entre si — comunicação só via `lib/` e `design-system/`, o que deixa o corte por plano (alto/baixo padrão) trivial via flags em `permissions.ts`.

---

**Próximos passos sugeridos**: (1) validar navegação e telas neste protótipo; (2) migrar para Vite na estrutura acima; (3) conectar autenticação real; (4) integrar Verum Pay na tela de cobranças.
