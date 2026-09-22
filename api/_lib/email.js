/* Envio transacional por SMTP próprio (nodemailer) — Etapa 5, usado por
   /api/auth/esqueci. Serverless: sem pool (uma conexão por invocação),
   timeouts curtos, conexão fechada no finally. Sem as envs SMTP_* o
   handler responde 503 — o envio nunca degrada silenciosamente para
   "fingir que mandou". */
import nodemailer from "nodemailer";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };

export const smtpConfigurado = () =>
  !!(envVal("SMTP_HOST") && envVal("SMTP_PORT") && envVal("SMTP_USER") && envVal("SMTP_PASS"));

const REMETENTE_PADRAO = '"CondoMaster Pro" <no-reply@servenowglobal.com>';

export async function enviarEmail({ para, assunto, texto, html }) {
  const porta = Number(envVal("SMTP_PORT"));
  const transporte = nodemailer.createTransport({
    host: envVal("SMTP_HOST"), port: porta,
    secure: porta === 465,            // 465 = TLS implícito; 587/2525 = STARTTLS
    auth: { user: envVal("SMTP_USER"), pass: envVal("SMTP_PASS") },
    pool: false,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
  try {
    await transporte.sendMail({
      from: envVal("EMAIL_REMETENTE") || REMETENTE_PADRAO,
      to: para, subject: assunto, text: texto, html,
    });
  } finally { transporte.close(); }
}

/* ── e-mail do link de redefinição de senha (diretor/síndico) ──
   Idioma segue a preferência da conta entre pt/es/en; fora disso cai no
   espanhol (idioma de entrada do app). Rótulos de perfil espelham as
   traduções da interface. */
const TXT = {
  pt: {
    assunto: "Redefinição de senha — CondoMaster Pro",
    perfil: { diretor: "Diretor", sindico: "Síndico" },
    ola: "Olá,",
    linha1: (p) => `Recebemos um pedido para redefinir a senha da conta de ${p} ligada a este e-mail no CondoMaster Pro.`,
    instrucao: "Abra o link abaixo para criar a senha nova (válido por 60 minutos, uso único):",
    botao: "Criar senha nova",
    ignorar: "Se você não pediu a redefinição, ignore este e-mail — sua senha continua a mesma e nenhuma ação é necessária.",
    rodape: "E-mail automático — não responda.",
  },
  es: {
    assunto: "Restablecimiento de contraseña — CondoMaster Pro",
    perfil: { diretor: "Director", sindico: "Administrador" },
    ola: "Hola,",
    linha1: (p) => `Recibimos una solicitud para restablecer la contraseña de la cuenta de ${p} vinculada a este correo en CondoMaster Pro.`,
    instrucao: "Abra el enlace de abajo para crear la contraseña nueva (válido por 60 minutos, de un solo uso):",
    botao: "Crear contraseña nueva",
    ignorar: "Si usted no pidió el restablecimiento, ignore este correo — su contraseña sigue igual y no hace falta ninguna acción.",
    rodape: "Correo automático — no responda.",
  },
  en: {
    assunto: "Password reset — CondoMaster Pro",
    perfil: { diretor: "Director", sindico: "Manager" },
    ola: "Hello,",
    linha1: (p) => `We received a request to reset the password of the ${p} account linked to this email on CondoMaster Pro.`,
    instrucao: "Open the link below to create a new password (valid for 60 minutes, single use):",
    botao: "Create new password",
    ignorar: "If you didn't request this, ignore this email — your password remains unchanged and no action is needed.",
    rodape: "Automated email — please don't reply.",
  },
};

export function emailRedefinicao({ link, perfil, idioma }) {
  const t = TXT[idioma] || TXT.es;
  const p = t.perfil[perfil] || perfil;
  const texto = [
    t.ola, "", t.linha1(p), "", t.instrucao, "", link, "", t.ignorar, "",
    "CondoMaster Pro · Serve Now Global", t.rodape,
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#171E2E">
  <h2 style="font-size:18px;margin:0 0 16px">CondoMaster <span style="color:#9E7C14">PRO</span></h2>
  <p>${t.ola}</p>
  <p>${t.linha1(p)}</p>
  <p style="margin:24px 0">
    <a href="${link}" style="background:#9E7C14;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">${t.botao}</a></p>
  <p style="font-size:12px;color:#68708A">${t.instrucao}<br>${link}</p>
  <p style="font-size:12px;color:#68708A">${t.ignorar}</p>
  <hr style="border:none;border-top:1px solid #eeeeee">
  <p style="font-size:11px;color:#68708A">CondoMaster Pro · Serve Now Global — ${t.rodape}</p>
</div>`;
  return { assunto: t.assunto, texto, html };
}
