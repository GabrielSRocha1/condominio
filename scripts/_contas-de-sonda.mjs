/* Teardown das CONTAS DE TESTE das sondas — e por que não é um delete.

   `auditoria` é APPEND-ONLY por decisão de projeto: um gatilho recusa DELETE
   de linha com menos de 365 dias ("auditoria é append-only — DELETE só para
   linhas com mais de 365 dias"). Qualquer conta de sonda que faça LOGIN já
   deixa uma linha lá, e `auditoria.usuario_id` referencia `usuarios` — então
   a partir do primeiro login a conta **não pode mais ser apagada**, e não
   deveria: apagar o rastro para limpar o cenário é exatamente o que a tabela
   existe para impedir.

   O que isso causava: o endpoint `/api/auth/acessos` (acao: remover) falhava
   em SILÊNCIO na linha de `usuarios`, sobrando uma conta SEM PERFIL — que
   existe, duplica o e-mail e não entra. A execução seguinte batia em 409 "já
   existe um acesso cadastrado com este e-mail" e o bloco inteiro ia para
   "login de teste falhou", sem nenhuma pista de que a causa era uma sobra da
   execução anterior. Mesma classe das sobras documentadas em
   testar-aprovacoes.mjs, com uma diferença importante: ali o service role
   resolvia; aqui não há delete que resolva.

   A saída é LIBERAR O E-MAIL em vez de apagar a conta: a linha fica (com o
   rastro intacto), mas sai da frente do dedupe — que é por e-mail, em
   `usuarios` e em `pessoas`. Quando não há auditoria presa, o delete normal
   ainda acontece; o apelido só entra quando o delete é recusado. */

const sufixo = () => `consumido.${Date.now().toString(36)}`;

/* Remove a conta de sonda e a pessoa que nasceu com ela. O que a auditoria
   prender é apelidado, não apagado. Devolve o que fez, para a sonda logar. */
export async function liberarEmailDaSonda(admin, email) {
  const feito = { apagadas: 0, apelidadas: 0 };
  const { data: us } = await admin.from("usuarios").select("id, pessoa_id, email").eq("email", email);
  for (const u of us || []) {
    await admin.from("usuario_perfis").delete().eq("usuario_id", u.id);
    /* FKs que já travaram delete de conta de sonda antes */
    await admin.from("pagamentos").delete().eq("baixado_por", u.id);
    await admin.from("alteracoes_pendentes").delete().eq("solicitado_por", u.id);
    const { error } = await admin.from("usuarios").delete().eq("id", u.id);
    if (!error) { feito.apagadas++; continue; }
    /* preso pela auditoria: tira o e-mail da frente e segue */
    await admin.from("usuarios").update({ email: `${email}.${sufixo()}` }).eq("id", u.id);
    feito.apelidadas++;
  }
  const { data: ps } = await admin.from("pessoas").select("id").eq("email", email);
  for (const p of ps || []) {
    await admin.from("pessoa_vinculos").delete().eq("pessoa_id", p.id);
    const { error } = await admin.from("pessoas").delete().eq("id", p.id);
    if (error) await admin.from("pessoas").update({ email: `${email}.${sufixo()}` }).eq("id", p.id);
  }
  return feito;
}
