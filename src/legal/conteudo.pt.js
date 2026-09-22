/* Documentos legais — PORTUGUÊS (fonte da verdade: es/en traduzem 1:1 esta
   estrutura). O texto descreve apenas o que o produto realmente entrega —
   ao mudar uma funcionalidade, atualize aqui e nas duas traduções, e avance
   a data em `atualizado`. Minuta técnica: revisão por advogado recomendada. */
export default {
  ui: {
    atualizado: "Última atualização",
    voltar: "Voltar ao app",
    temaClaro: "Tema claro",
    temaEscuro: "Tema escuro",
    locale: "pt-BR",
  },

  termos: {
    titulo: "Termos de Serviço",
    atualizado: "2026-09-22",
    secoes: [
      {
        h: "1. Quem somos e definições",
        p: [
          "Estes Termos de Serviço regem a contratação e o uso da plataforma CondoMaster Pro (“Plataforma”), disponível em condomaster.servenowglobal.com, operada por Util Atividades Web LTDA, inscrita no CNPJ sob o nº 47.509.953/0001-43, com sede em Balneário Piçarras, Santa Catarina, Brasil (“Operadora”). Contato: suporte@servenowglobal.com.",
        ],
        itens: [
          "Condomínio (Contratante): o condomínio que contrata a licença de uso, representado pelo Diretor.",
          "Diretor: a pessoa que cria a conta, cadastra o Condomínio e o representa perante a Operadora.",
          "Usuários: as pessoas com acesso criado pelo Diretor (síndico, tesouraria e morador).",
          "Licença: a assinatura que dá a um Condomínio o direito de uso da Plataforma.",
        ],
      },
      {
        h: "2. Aceitação",
        p: [
          "Ao criar uma conta e cadastrar um Condomínio, o Diretor aceita estes Termos em nome próprio e em nome do Condomínio, declarando ter poderes para representá-lo (por exemplo, como síndico, administrador ou diretor eleito). Se você não concorda com estes Termos, não utilize a Plataforma.",
          "O uso da Plataforma pelos demais Usuários é regido também pelos Termos de Uso, e o tratamento de dados pessoais, pela Política de Privacidade — ambos disponíveis na Plataforma e parte integrante destes Termos.",
        ],
      },
      {
        h: "3. O que a Plataforma oferece",
        p: [
          "A Plataforma é um software de gestão condominial na modalidade SaaS (software como serviço), acessado pelo navegador e instalável como aplicativo (PWA). Os módulos disponíveis incluem:",
        ],
        itens: [
          "financeiro com fluxo de aprovações;",
          "cobranças condominiais com QR e pagamento on-line;",
          "multas e advertências com fluxo de defesa;",
          "comunicados com confirmação de leitura;",
          "documentos timbrados em PDF;",
          "chamados de manutenção;",
          "portaria com pré-autorização de visitantes por QR de uso único;",
          "portal do morador;",
          "interface em 15 idiomas.",
        ],
        p2: [
          "As funcionalidades disponíveis são as oferecidas na Plataforma no momento do uso e podem evoluir. Recursos em desenvolvimento ou anunciados não integram o objeto contratado enquanto não estiverem efetivamente disponíveis.",
        ],
      },
      {
        h: "4. Planos, preços e teste gratuito",
        p: [
          "A Licença é contratada por plano (com limite de unidades) e por período (mensal ou anual), com valores em reais (R$) exibidos na tela de Planos no momento da contratação. Para clientes fora do Brasil, o valor pode ser apresentado convertido para a moeda local pela Stripe, nossa processadora de pagamentos.",
          "A primeira assinatura de cada Condomínio pode incluir um período de teste gratuito de 30 dias, com cadastro de cartão. O teste pode ser estendido uma única vez, a critério da Operadora. A Operadora também pode disponibilizar códigos de ativação que criam a assinatura com pagamento por fatura, com vencimento informado na própria fatura.",
          "Cada plano tem um limite de unidades. Exceder o limite não interrompe o uso; a Operadora se reserva o direito de cobrar pelas unidades excedentes ou de solicitar a migração de plano, mediante aviso prévio.",
        ],
      },
      {
        h: "5. Pagamento da licença, inadimplência e bloqueio",
        p: [
          "Os pagamentos da Licença são processados pela Stripe. Os dados de cartão são informados diretamente à Stripe e nunca passam pelos servidores da Operadora. Faturas, recibos e troca de cartão ficam disponíveis no portal de cobrança (Stripe), acessível dentro da Plataforma.",
          "Em caso de falha de pagamento ou fatura vencida, a assinatura fica inadimplente e o acesso à Plataforma é bloqueado até a regularização. O bloqueio não apaga os dados do Condomínio.",
          "Os valores podem ser reajustados; reajustes valem a partir do período seguinte e serão comunicados com antecedência razoável.",
        ],
      },
      {
        h: "6. Recebimento de cobranças condominiais",
        p: [
          "Para receber taxas condominiais on-line, o Condomínio abre a própria conta de recebimento na Stripe (Stripe Connect), passa pela verificação de identidade (KYC) conduzida pela Stripe e aceita os termos da Stripe. O Condomínio é o titular dos recebimentos: os recibos saem em seu nome e as tarifas da Stripe são debitadas dele.",
          "Sobre cada cobrança paga on-line, a Operadora retém uma tarifa de serviço de 1% do valor, limitada a 1 unidade da moeda da cobrança (por exemplo, R$ 1,00). O Condomínio pode optar por repassar esse custo ao pagador como taxa de conveniência, com o valor exibido antes do pagamento.",
          "Em países onde a Stripe não oferece contas de recebimento, ou por opção do Condomínio, ficam disponíveis meios manuais: transferência bancária com envio de comprovante, criptomoeda (com verificação do hash da transação em redes públicas de blockchain) e dinheiro, com baixa manual justificada. A conferência dos pagamentos informados e a baixa manual são de responsabilidade da gestão do Condomínio.",
          "A Operadora não é instituição financeira e não intermedeia, não custodia e não garante valores devidos ao Condomínio ou por ele.",
        ],
      },
      {
        h: "7. Obrigações do Condomínio e do Diretor",
        itens: [
          "Fornecer informações verdadeiras, completas e atualizadas no cadastro, e mantê-las assim.",
          "Criar, gerenciar e revogar os acessos dos Usuários, respondendo pelo uso que eles fizerem da Plataforma.",
          "Inserir dados pessoais de moradores, funcionários, prestadores e visitantes somente com base legal para tanto — perante a legislação de proteção de dados, o Condomínio é o controlador desses dados.",
          "Utilizar a Plataforma conforme a lei aplicável à administração do condomínio (convenção, regimento interno e legislação local).",
          "Guardar com segurança as credenciais de acesso e manter válido e acessível o e-mail da conta do Diretor — é para ele que a Plataforma envia o link de redefinição de senha.",
        ],
      },
      {
        h: "8. Proteção de dados",
        p: [
          "No tratamento dos dados inseridos pelo Condomínio, a Operadora atua como operadora (processadora), seguindo as instruções do Condomínio refletidas nas funcionalidades da Plataforma. Nos dados da relação comercial (conta do Diretor, cadastro do Condomínio e cobrança da Licença), a Operadora é a controladora. Os detalhes — dados coletados, finalidades, compartilhamentos, retenção e direitos — estão na Política de Privacidade.",
        ],
      },
      {
        h: "9. Disponibilidade e suporte",
        p: [
          "A Operadora emprega os melhores esforços para manter a Plataforma disponível e segura, mas não garante disponibilidade ininterrupta nem oferece acordo de nível de serviço (SLA). Manutenções, atualizações e fatores externos (provedores de nuvem, processadora de pagamentos, redes) podem causar indisponibilidades temporárias.",
          "O suporte é prestado pelo e-mail suporte@servenowglobal.com, com prazo de até 24 horas para a resposta.",
        ],
      },
      {
        h: "10. Limitação de responsabilidade",
        p: [
          "A Plataforma é uma ferramenta de gestão. A Operadora não responde: pelas decisões da administração do Condomínio; pela exatidão dos dados e documentos inseridos pelos Usuários; por disputas entre o Condomínio e condôminos, funcionários ou terceiros; por atos e indisponibilidades de terceiros (Stripe, provedores de nuvem e de e-mail, redes de blockchain); nem por caso fortuito ou força maior.",
          "Na máxima extensão permitida em lei, a responsabilidade total da Operadora limita-se ao valor pago pelo Condomínio pela Licença nos 12 (doze) meses anteriores ao evento. Nada nestes Termos exclui responsabilidades que não possam ser afastadas por lei, inclusive as previstas no Código de Defesa do Consumidor, quando aplicável.",
        ],
      },
      {
        h: "11. Vigência, cancelamento e término",
        p: [
          "A assinatura renova-se automaticamente a cada período (mensal ou anual) até ser cancelada. O cancelamento pode ser feito a qualquer momento dentro da Plataforma e tem efeito ao final do período já pago; até lá, o acesso permanece ativo. Não há reembolso proporcional de períodos já pagos, salvo previsão legal em contrário.",
          "Encerrada a Licença, o acesso é bloqueado. Os dados são conservados e eliminados conforme os prazos da Política de Privacidade; o Condomínio pode solicitar cópia ou eliminação dos dados pelo suporte, respeitadas as retenções legais.",
          "A Operadora pode suspender ou encerrar o acesso em caso de violação destes Termos, uso ilícito ou risco à segurança da Plataforma ou de terceiros.",
        ],
      },
      {
        h: "12. Propriedade intelectual",
        p: [
          "O software, a marca CondoMaster Pro, o layout e os demais elementos da Plataforma pertencem à Operadora ou a seus licenciantes. A Licença dá ao Condomínio um direito de uso limitado, não exclusivo e intransferível, sem qualquer cessão de propriedade intelectual. Os dados inseridos pelo Condomínio continuam sendo do Condomínio.",
        ],
      },
      {
        h: "13. Alterações destes Termos",
        p: [
          "Estes Termos podem ser alterados para refletir mudanças na Plataforma, na legislação ou no modelo de negócio. Alterações relevantes serão comunicadas na própria Plataforma com antecedência razoável, e o uso continuado após a vigência da nova versão vale como concordância. A versão vigente fica sempre disponível nesta página, com a data de atualização.",
        ],
      },
      {
        h: "14. Lei aplicável, foro e idioma",
        p: [
          "Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca da sede da Operadora, em Balneário Piçarras/SC, para dirimir controvérsias, ressalvado o foro assegurado por norma de ordem pública — como o do domicílio do consumidor, quando aplicável.",
          "Este documento é disponibilizado em português, espanhol e inglês. Em caso de divergência entre as versões, prevalece a versão em português.",
        ],
      },
    ],
  },

  privacidade: {
    titulo: "Política de Privacidade",
    atualizado: "2026-09-22",
    secoes: [
      {
        h: "1. Visão geral e papéis",
        p: [
          "Esta Política descreve como a plataforma CondoMaster Pro (condomaster.servenowglobal.com) trata dados pessoais. A plataforma é operada por Util Atividades Web LTDA, CNPJ 47.509.953/0001-43, com sede em Balneário Piçarras/SC, Brasil (“nós”). Canal de privacidade: suporte@servenowglobal.com.",
          "Papéis no tratamento, nos termos da LGPD (Lei nº 13.709/2018) e de normas equivalentes:",
        ],
        itens: [
          "O condomínio é o controlador dos dados de moradores, funcionários, prestadores e visitantes que insere na plataforma — é ele quem decide quem cadastrar e para quê.",
          "Nós somos a operadora desses dados: nós os tratamos a serviço do condomínio, conforme as funcionalidades da plataforma.",
          "Nós somos a controladora dos dados da relação comercial: a conta do diretor, o cadastro do condomínio e a cobrança da licença.",
        ],
      },
      {
        h: "2. Dados que tratamos",
        itens: [
          "Conta de acesso: nome, e-mail (diretor, síndico e tesouraria; o morador entra por nome e senha, sem precisar de e-mail) e senha — armazenada exclusivamente como hash criptográfico (scrypt), nunca em texto claro. Preferência de idioma.",
          "Cadastro de pessoas (inserido pelo condomínio): nome, documento fiscal ou de identidade (CPF, CNPJ, RG, CI, DNI, CUIT, RUT, RFC e equivalentes), telefone e e-mail opcionais, unidade e vínculo com o condomínio, e cópia de documento de identidade quando anexada.",
          "Gestão condominial: lançamentos financeiros, cobranças e pagamentos, comprovantes e hashes de transação cripto informados, multas com defesas e provas, comunicados e confirmações de leitura, chamados de manutenção, registros de portaria (nome de visitantes, placas de veículo, entregas e ocorrências) e documentos gerados.",
          "Registros técnicos e de segurança: endereço IP e identificador de login em trilha de auditoria e em contadores de proteção contra abuso, com data e hora dos eventos.",
          "País aproximado: usamos apenas o país informado pela infraestrutura de borda (Vercel) para sugerir idioma e moeda. O endereço IP não é lido, guardado nem repassado para essa finalidade.",
        ],
      },
      {
        h: "3. O que não fazemos",
        itens: [
          "Não temos acesso aos dados do seu cartão — eles são informados diretamente à Stripe, em página da própria Stripe.",
          "Não vendemos dados pessoais nem os usamos para publicidade.",
          "Não usamos cookies de terceiros nem rastreamento entre sites.",
          "Não enviamos SMS, push nem mensagens de WhatsApp. Por e-mail, enviamos apenas mensagens transacionais solicitadas por você — hoje, o link de redefinição de senha do diretor e do síndico, a partir do remetente no-reply@servenowglobal.com. Os e-mails de fatura e recibo da licença são enviados pela Stripe. Nunca marketing.",
        ],
      },
      {
        h: "4. Cookies e armazenamento no dispositivo",
        p: ["Usamos apenas o necessário para o funcionamento do app:"],
        itens: [
          "Cookie cm_refresh (essencial): mantém a sua sessão com segurança (HttpOnly, Secure). Dura até 30 dias.",
          "localStorage cm_sessao: dados da sessão no seu dispositivo (perfil e token de acesso — nunca a senha). Removido ao sair.",
          "localStorage cm_lang e cm_lang_auto: idioma escolhido e idioma sugerido pelo país.",
          "localStorage cm_geo: país, idioma e moeda sugeridos (validade de 7 dias).",
          "localStorage cm_cookies_ok: registra que você viu o aviso de cookies.",
          "sessionStorage (cm_tela e afins): última tela aberta; apaga-se ao fechar a aba.",
          "Vercel Analytics: métricas agregadas e anônimas de uso, sem cookies.",
        ],
        p2: [
          "Como não usamos cookies de publicidade ou de rastreamento, o aviso de cookies do app é apenas informativo.",
        ],
      },
      {
        h: "5. Finalidades e bases legais",
        itens: [
          "Prestar o serviço contratado (execução de contrato): autenticação, cadastros, cobranças, comunicados, portaria e demais módulos.",
          "Segurança e prevenção a fraudes (legítimo interesse): trilha de auditoria, limites de tentativas de acesso e detecção de reuso de sessão.",
          "Cumprimento de obrigações legais: registros fiscais e contábeis da licença.",
          "Melhoria do produto (legítimo interesse): métricas agregadas de uso, sem identificação individual.",
        ],
      },
      {
        h: "6. Compartilhamento e subprocessadores",
        p: ["Compartilhamos dados apenas com os provedores necessários ao funcionamento da plataforma:"],
        itens: [
          "Supabase — banco de dados e armazenamento de arquivos.",
          "Vercel — hospedagem, funções de servidor, métricas agregadas e identificação do país.",
          "Stripe — processamento dos pagamentos da licença e das cobranças condominiais, e verificação de identidade (KYC) da conta de recebimento do condomínio, conduzida pela própria Stripe.",
          "Provedor de e-mail do domínio servenowglobal.com — envio das mensagens transacionais da plataforma (como o link de redefinição de senha).",
          "Redes públicas de blockchain — consulta do hash de transação informado em pagamentos cripto (o hash é, por natureza, público).",
        ],
        p2: [
          "Além disso, podemos compartilhar dados para cumprir obrigação legal ou ordem de autoridade competente. Não vendemos dados pessoais.",
        ],
      },
      {
        h: "7. Arquivos anexados",
        p: [
          "Arquivos enviados à plataforma (cópias de documentos, comprovantes, provas de multa, fotos de chamados) ficam em repositório acessível por links não listados publicamente: quem tiver o link consegue abrir o arquivo, sem senha. Trate esses links como confidenciais. Recomendamos ao condomínio anexar somente o necessário e evitar documentos sensíveis dispensáveis.",
        ],
      },
      {
        h: "8. Segurança",
        itens: [
          "Senhas armazenadas com scrypt (hash com sal); códigos de recuperação, tokens de redefinição por e-mail, QRs de portaria e tokens de sessão guardados apenas como hash.",
          "Isolamento por condomínio no banco de dados (RLS): cada condomínio só acessa os próprios dados.",
          "Tráfego cifrado (HTTPS/HSTS), política restritiva de conteúdo (CSP) e cabeçalhos de segurança.",
          "Sessões com rotação de token e detecção de reuso — suspeita de roubo revoga todas as sessões relacionadas.",
          "Trilha de auditoria imutável para eventos de segurança.",
        ],
      },
      {
        h: "9. Por quanto tempo guardamos",
        itens: [
          "Cadastros e registros de gestão: enquanto a conta do condomínio existir e pelos prazos legais aplicáveis. Registros vinculados a histórico financeiro podem impedir a exclusão imediata de um cadastro.",
          "Trilha de auditoria (inclui IP): imutável e conservada por no mínimo 365 dias.",
          "Documentos timbrados: retenção prevista de 5 anos a partir da emissão.",
          "Sessões: até 30 dias. Registros de idempotência de operações: 24 horas.",
        ],
      },
      {
        h: "10. Seus direitos",
        p: [
          "A LGPD (e normas equivalentes, como o GDPR) garante a você, entre outros: confirmação da existência de tratamento, acesso, correção, anonimização ou eliminação (com os limites de retenção acima), portabilidade, informação sobre compartilhamentos e revogação do consentimento quando o tratamento se basear nele.",
          "Como exercer: se você é morador, funcionário ou visitante, dirija-se primeiro à administração do seu condomínio — ela é a controladora dos seus dados e pode corrigi-los ou removê-los diretamente na plataforma. Você também pode nos contatar em suporte@servenowglobal.com; responderemos em prazo razoável e, quando o pedido couber ao condomínio, o encaminharemos a ele.",
        ],
      },
      {
        h: "11. Transferência internacional",
        p: [
          "Nossos provedores (Supabase, Vercel e Stripe) podem processar dados em servidores localizados fora do seu país de residência. Nesses casos, aplicam-se as salvaguardas contratuais e certificações dos próprios provedores, e a transferência observa os requisitos legais aplicáveis.",
        ],
      },
      {
        h: "12. Crianças e adolescentes",
        p: [
          "A plataforma destina-se a maiores de idade. Dados de dependentes menores só existem quando inseridos pelo condomínio, sob responsabilidade dele, para fins de gestão condominial.",
        ],
      },
      {
        h: "13. Alterações e contato",
        p: [
          "Podemos atualizar esta Política; a versão vigente fica sempre nesta página, com a data de atualização, e mudanças relevantes serão comunicadas no app. Em caso de divergência entre traduções, prevalece a versão em português.",
          "Util Atividades Web LTDA — CNPJ 47.509.953/0001-43 — Balneário Piçarras/SC, Brasil. Encarregado (DPO) e canal de privacidade: suporte@servenowglobal.com.",
        ],
      },
    ],
  },

  termosDeUso: {
    titulo: "Termos de Uso",
    atualizado: "2026-09-22",
    secoes: [
      {
        h: "1. Sobre este documento",
        p: [
          "Estes Termos de Uso valem para toda pessoa que acessa a plataforma CondoMaster Pro — diretor, síndico, tesouraria e morador. Eles complementam os Termos de Serviço (o contrato do condomínio com a operadora da plataforma, Util Atividades Web LTDA, CNPJ 47.509.953/0001-43) e a Política de Privacidade. Ao usar a plataforma, você concorda com estas regras.",
        ],
      },
      {
        h: "2. Contas e acesso",
        p: [
          "A conta do diretor é criada por autocadastro. As demais contas (síndico, tesouraria e morador) são criadas pelo diretor do condomínio, em Gerenciar Acessos. O morador entra com nome e senha — não é necessário e-mail.",
          "O acesso é pessoal e intransferível. Você responde por tudo o que for feito com as suas credenciais; comunique imediatamente a administração se suspeitar de uso indevido.",
        ],
      },
      {
        h: "3. Senha e recuperação de acesso",
        p: [
          "Sua senha tem no mínimo 8 caracteres e é armazenada de forma protegida (apenas o hash criptográfico). A forma de redefinir a senha depende do perfil:",
        ],
        itens: [
          "Diretor e síndico: em \"Esqueci minha senha\", informam o e-mail da conta e recebem um link de redefinição por e-mail, válido por 60 minutos e de uso único.",
          "Tesouraria e morador: logo após entrar, podem gerar um código de recuperação permanente, exibido uma única vez — guarde-o em local seguro. Quem perder a senha e o código pode pedir ao diretor um código temporário de 24 horas, em Gerenciar Acessos.",
          "Mantenha o e-mail da sua conta correto e acessível: é para ele que o link de redefinição é enviado. Se o e-mail cadastrado do síndico estiver errado ou inacessível, o diretor pode remover e recriar o acesso em Gerenciar Acessos.",
        ],
        p2: [
          "A sessão pode permanecer ativa por até 30 dias no dispositivo. Em dispositivos compartilhados, use sempre o botão Sair.",
        ],
      },
      {
        h: "4. Uso aceitável",
        p: ["É proibido, entre outras condutas:"],
        itens: [
          "acessar ou tentar acessar contas ou dados de terceiros, ou burlar os mecanismos de segurança e de isolamento entre condomínios;",
          "sobrecarregar a plataforma com acessos automatizados, raspagem de dados ou uso abusivo;",
          "inserir conteúdo ilícito, ofensivo, discriminatório ou que viole direitos de terceiros;",
          "cadastrar dados pessoais de terceiros sem base legal ou autorização para tanto;",
          "usar a plataforma para finalidade alheia à gestão do condomínio.",
        ],
      },
      {
        h: "5. Conteúdo enviado",
        p: [
          "Ao enviar qualquer conteúdo — comprovantes, defesas de multa, provas, fotos, vídeos, documentos —, você declara que ele é verdadeiro e que tem o direito de enviá-lo. Comprovantes falsos ou adulterados, e hashes de transação que não correspondam ao pagamento, podem gerar responsabilização civil e criminal, além da suspensão do acesso.",
          "Os arquivos anexados ficam acessíveis por meio de links não listados publicamente: qualquer pessoa com o link consegue abrir o arquivo. Não compartilhe esses links fora do contexto da gestão do condomínio e anexe somente o necessário.",
        ],
      },
      {
        h: "6. Pagamentos pelo portal",
        p: [
          "O pagamento on-line é processado pela Stripe, em página da própria Stripe — os dados do cartão não passam pela plataforma. Pagamentos informados manualmente (transferência bancária ou criptomoeda) ficam pendentes até a conferência pela administração do condomínio; pagamentos em criptomoeda são verificados nas redes públicas de blockchain a partir do hash informado.",
          "A plataforma registra as cobranças e os pagamentos, mas quem define valores, vencimentos e regras de cobrança é a administração do condomínio. Dúvidas ou contestações sobre cobranças devem ser tratadas diretamente com ela.",
        ],
      },
      {
        h: "7. Privacidade",
        p: [
          "O tratamento dos seus dados pessoais está descrito na Política de Privacidade. Em resumo: o condomínio, que insere e administra os cadastros, é o controlador dos seus dados; a operadora da plataforma os trata como operadora. O canal para assuntos de privacidade é suporte@servenowglobal.com.",
        ],
      },
      {
        h: "8. Propriedade intelectual",
        p: [
          "O software, a marca e o design da plataforma são protegidos por direitos de propriedade intelectual. Você recebe uma licença de uso pessoal, limitada e revogável, apenas para utilizar a plataforma (inclusive instalada como aplicativo). É proibido copiar, modificar, distribuir ou fazer engenharia reversa.",
        ],
      },
      {
        h: "9. Suspensão e encerramento do acesso",
        p: [
          "O diretor pode criar e remover acessos do condomínio a qualquer momento. A operadora pode suspender acessos em caso de violação destes Termos ou de risco à segurança. O término da licença do condomínio encerra o acesso de todos os seus usuários.",
        ],
      },
      {
        h: "10. Disposições finais",
        p: [
          "Estes Termos podem ser atualizados; a versão vigente fica sempre nesta página, com a data de atualização. Aplicam-se as leis brasileiras, com foro na comarca de Balneário Piçarras/SC, sede da operadora, ressalvado o foro assegurado por norma de ordem pública — como o do domicílio do consumidor, quando aplicável. Em caso de divergência entre traduções, prevalece a versão em português. Contato: suporte@servenowglobal.com.",
        ],
      },
    ],
  },
};
