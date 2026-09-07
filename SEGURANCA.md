# Segurança — arquitetura de defesa e runbook

Consolidação das Etapas 1–3 de blindagem. Cada camada degrada graciosa:
sem os SQLs aplicados o app funciona, mas as proteções correspondentes
ficam inertes (com aviso no log do servidor).

## Camadas ativas

| Camada | Onde | O que garante |
|---|---|---|
| RLS por condomínio | `supabase-rls.sql` | navegador só enxerga o próprio prédio; `senha_hash` invisível; `usuarios`/`usuario_perfis` só via backend |
| JWT curto + refresh | `api/_lib/seguranca.js` + `auth_sessoes` | acesso de 1h; cookie HttpOnly SameSite=Strict com rotação; reuso = roubo detectado → família revogada |
| Senhas | scrypt+salt (`s2$…`) | legado SHA-256 aceito e migrado no login; mínimo 8 caracteres |
| Força bruta | `auth_protecao` (RPC `registrar_tentativa`) | lockout por conta/IP no login; limites no registro, cripto on-chain e endpoints Stripe |
| Validação | `api/_lib/validar.js` | deny-by-default em todo payload: UUID/enum/limites, campos desconhecidos descartados |
| Idempotência | `api_idempotencia` + header `Idempotency-Key` | retry de rede nunca duplica pagamento/informe; chave repassada à Stripe |
| Origem estrita | `origemBloqueada()` | POSTs que escrevem exigem Origin do próprio host ou de `APP_ORIGINS` (nunca wildcard) |
| CSP/headers | `vercel.json` | `default-src 'self'`, frame-ancestors none, HSTS, nosniff; câmera liberada só para o QR da portaria |
| OpSec | `logSeguro()` | 500 genérico; JWT/chaves/cookies/senhas redigidos de qualquer log |
| Auditoria | `auditoria_eventos` (append-only) | trilha imutável: logins, bloqueios, reuso de sessão, acessos, pagamentos e informes (triggers pegam até RPC do navegador) |

SQLs (rodar no SQL Editor, nesta ordem, todos idempotentes):
`supabase-rls.sql` → `supabase-seguranca.sql` → `supabase-seguranca2.sql` → `supabase-seguranca3.sql`.

## Ferramentas

| Script | Para quê |
|---|---|
| `scripts/testar-seguranca.mjs` | sondas da Etapa 1 (23): auth, lockout, refresh, RLS |
| `scripts/testar-seguranca2.mjs` | sondas da Etapa 2 (14): origem, idempotência, redação |
| `scripts/testar-seguranca3.mjs` | pentest: isolamento entre condomínios, fuzzing, auditoria |
| `scripts/relatorio-seguranca.mjs [horas]` | resumo da trilha: falhas de login por IP, eventos ALTA, financeiro |
| `scripts/emergencia-sessoes.mjs` | revogação em massa (`--todas` / `--usuario` / `--condominio`) |
| `scripts/verificar-segredos-bundle.mjs` | após `vite build`: nenhum segredo do `.env` no `dist/` |

Rotina sugerida: `npm audit` + `verificar-segredos-bundle` antes de cada
deploy; `relatorio-seguranca` semanal (atenção a `sessao_reuso_detectado`
e picos de `login_falha`).

## Rotação de segredos

- **SUPABASE_JWT_SECRET** (assina os JWTs e valida no PostgREST): rotacione
  pelo dashboard do Supabase (Settings → API → JWT Settings). ATENÇÃO: isso
  invalida também `anon` e `service_role` keys — atualize `.env`/Vercel com
  as três novas de uma vez. Todos os tokens vivos morrem na hora; rode
  `emergencia-sessoes.mjs --todas` para limpar as sessões de refresh (elas
  não valem nada sem o secret antigo, mas a tabela fica limpa).
- **SUPABASE_SERVICE_ROLE_KEY**: regenerada junto com o JWT secret (acima).
  Nunca aparece no frontend — `verificar-segredos-bundle.mjs` confere.
- **STRIPE_SECRET_KEY / STRIPE_SECRET_KEY_LIVE**: Dashboard Stripe →
  Developers → API keys → Roll key. Atualize o ambiente e reimplante.
  Webhook secrets (`whsec_…`): recrie o endpoint ou role o secret em
  Developers → Webhooks.
- Depois de QUALQUER rotação: `node scripts/testar-seguranca.mjs` confirma
  que login/refresh seguem de pé.

## Resposta a incidente

1. **Conta comprometida**: `emergencia-sessoes.mjs --usuario <email>` +
   trocar a senha da conta (Gerenciar Acessos recria o acesso) + ler a
   trilha: `relatorio-seguranca.mjs 168` e filtrar o `usuario_id`.
2. **Suspeita de vazamento de token/secret**: rotacionar o segredo
   afetado (acima) + `--todas`. JWTs de acesso expiram sozinhos em ≤1h.
3. **`sessao_reuso_detectado` na trilha**: a família já foi revogada
   automaticamente; investigue o IP registrado e avise o usuário.
4. **Flood/DDoS de aplicação**: os 429 já seguram por conta/IP; na Vercel,
   ative o Firewall/Attack Challenge Mode para o volumétrico.
5. **Preservar evidência**: a trilha é append-only — nem a service role
   altera/apaga (expurgo só de linhas com +365 dias).

## Backup e recuperação

- Supabase faz backup diário automático (planos pagos: PITR). Teste de
  restore: Dashboard → Database → Backups → restaurar num projeto NOVO e
  apontar um `.env` de homologação para validar.
- O que não está no banco: `.env` (guarde num cofre — nunca no git; o
  histórico foi verificado e está limpo) e as configurações do dashboard
  Stripe (webhooks/portal — recriáveis por `scripts/preparar-stripe-producao.mjs`).
