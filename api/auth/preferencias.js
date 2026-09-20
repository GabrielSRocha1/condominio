/* POST /api/auth/preferencias  (Authorization: Bearer)  { idioma }
   Guarda o idioma escolhido na PRÓPRIA conta, para a pessoa reencontrá-lo em
   qualquer aparelho. Vale para todos os perfis, inclusive morador e diretor
   que ainda não criou o condomínio — por isso não se exige condominio_id.

   Blindagem:
   · a linha alterada é sempre claims.sub; o corpo não carrega usuarioId e o
     validador descarta qualquer campo fora do esquema, então não há como
     escrever na conta de outra pessoa;
   · precisa de service_role: supabase-seguranca.sql:106-107 tira do navegador
     o grant de escrita em usuarios (e a coluna preferencias nem aparece no
     grant de leitura);
   · sem idempotência — é uma escrita last-write-wins de um único valor, então
     repetir a chamada dá exatamente no mesmo;
   · sem auditoria — preferência de interface não é evento de segurança. */
import { createClient } from "@supabase/supabase-js";
import { corpoValidado } from "../_lib/validar.js";
import { lerClaimsReq, origemBloqueada, logSeguro } from "../_lib/seguranca.js";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
/* espelho de LANGS (src/lib/i18n.js) — api/ não importa de src/ */
const IDIOMAS = ["pt", "en", "es", "fr", "de", "it", "zh", "ja", "ko", "ru", "ar", "hi", "tr", "id", "bn"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const serviceKey = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return res.status(503).json({ error: "Configure SUPABASE_SERVICE_ROLE_KEY no servidor." });

  const claims = lerClaimsReq(req);
  if (!claims?.sub) return res.status(401).json({ error: "Sessão inválida — entre de novo." });
  if (origemBloqueada(req, res)) return;

  const supabase = createClient(envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL, serviceKey);
  try {
    const f = corpoValidado(res, typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}), {
      idioma: { tipo: "enum", valores: IDIOMAS, obrigatorio: true },
    });
    if (!f) return;

    /* merge, nunca troca do objeto inteiro: preferências que outras telas
       venham a gravar aqui não podem sumir por causa de uma troca de idioma */
    const { data: atual, error: eL } = await supabase.from("usuarios")
      .select("preferencias").eq("id", claims.sub).maybeSingle();
    /* o alter que cria a coluna acompanha o supabase-schema.sql; sem ele a
       preferência simplesmente não tem onde morar (o login segue normal) */
    if (eL && /does not exist|schema cache|column/i.test(eL.message || ""))
      return res.status(503).json({ error: "Rode o alter table de usuarios.preferencias (supabase-schema.sql)." });
    if (eL) throw new Error(eL.message);
    if (!atual) return res.status(401).json({ error: "Conta não encontrada — entre de novo." });

    const preferencias = { ...(atual.preferencias || {}), idioma: f.idioma };
    const { error } = await supabase.from("usuarios")
      .update({ preferencias, atualizado_em: new Date().toISOString() }).eq("id", claims.sub);
    if (error) throw new Error(error.message);

    return res.status(200).json({ ok: true, preferencias });
  } catch (e) {
    logSeguro("[auth/preferencias]", e);
    return res.status(500).json({ error: "Erro ao salvar a preferência." });
  }
}
