/* Documentos legales — ESPAÑOL (traducción 1:1 de conteudo.pt.js, que es la
   fuente de la verdad). Ante cualquier cambio, actualizar primero el PT. */
export default {
  ui: {
    atualizado: "Última actualización",
    voltar: "Volver a la app",
    temaClaro: "Tema claro",
    temaEscuro: "Tema oscuro",
    locale: "es",
  },

  termos: {
    titulo: "Términos de Servicio",
    atualizado: "2026-09-22",
    secoes: [
      {
        h: "1. Quiénes somos y definiciones",
        p: [
          "Estos Términos de Servicio rigen la contratación y el uso de la plataforma CondoMaster Pro (“Plataforma”), disponible en condomaster.servenowglobal.com, operada por Util Atividades Web LTDA, inscrita en el CNPJ (registro fiscal brasileño) con el nº 47.509.953/0001-43, con sede en Balneário Piçarras, Santa Catarina, Brasil (“Operadora”). Contacto: suporte@servenowglobal.com.",
        ],
        itens: [
          "Condominio (Contratante): el condominio que contrata la licencia de uso, representado por el Director.",
          "Director: la persona que crea la cuenta, registra el Condominio y lo representa ante la Operadora.",
          "Usuarios: las personas con acceso creado por el Director (administrador, tesorería y residente).",
          "Licencia: la suscripción que da a un Condominio el derecho de uso de la Plataforma.",
        ],
      },
      {
        h: "2. Aceptación",
        p: [
          "Al crear una cuenta y registrar un Condominio, el Director acepta estos Términos en nombre propio y en nombre del Condominio, declarando tener poderes para representarlo (por ejemplo, como administrador, síndico o director electo). Si no está de acuerdo con estos Términos, no utilice la Plataforma.",
          "El uso de la Plataforma por los demás Usuarios se rige también por los Términos de Uso, y el tratamiento de datos personales, por la Política de Privacidad — ambos disponibles en la Plataforma y parte integrante de estos Términos.",
        ],
      },
      {
        h: "3. Qué ofrece la Plataforma",
        p: [
          "La Plataforma es un software de gestión de condominios en modalidad SaaS (software como servicio), accesible desde el navegador e instalable como aplicación (PWA). Los módulos disponibles incluyen:",
        ],
        itens: [
          "finanzas con flujo de aprobaciones;",
          "cobros del condominio con QR y pago en línea;",
          "multas y advertencias con flujo de descargo;",
          "comunicados con confirmación de lectura;",
          "documentos membretados en PDF;",
          "tickets de mantenimiento;",
          "portería con preautorización de visitantes mediante QR de un solo uso;",
          "portal del residente;",
          "interfaz en 15 idiomas.",
        ],
        p2: [
          "Las funcionalidades disponibles son las ofrecidas en la Plataforma en el momento del uso y pueden evolucionar. Los recursos en desarrollo o anunciados no integran el objeto contratado mientras no estén efectivamente disponibles.",
        ],
      },
      {
        h: "4. Planes, precios y prueba gratuita",
        p: [
          "La Licencia se contrata por plan (con límite de unidades) y por período (mensual o anual), con valores en reales brasileños (R$) mostrados en la pantalla de Planes al momento de la contratación. Para clientes fuera de Brasil, el valor puede presentarse convertido a la moneda local por Stripe, nuestra procesadora de pagos.",
          "La primera suscripción de cada Condominio puede incluir un período de prueba gratuita de 30 días, con registro de tarjeta. La prueba puede extenderse una única vez, a criterio de la Operadora. La Operadora también puede ofrecer códigos de activación que crean la suscripción con pago por factura, con vencimiento indicado en la propia factura.",
          "Cada plan tiene un límite de unidades. Superar el límite no interrumpe el uso; la Operadora se reserva el derecho de cobrar por las unidades excedentes o de solicitar el cambio de plan, con aviso previo.",
        ],
      },
      {
        h: "5. Pago de la licencia, mora y bloqueo",
        p: [
          "Los pagos de la Licencia son procesados por Stripe. Los datos de la tarjeta se informan directamente a Stripe y nunca pasan por los servidores de la Operadora. Las facturas, recibos y el cambio de tarjeta están disponibles en el portal de facturación (Stripe), accesible dentro de la Plataforma.",
          "En caso de fallo de pago o factura vencida, la suscripción entra en mora y el acceso a la Plataforma se bloquea hasta la regularización. El bloqueo no borra los datos del Condominio.",
          "Los valores pueden ser reajustados; los reajustes rigen a partir del período siguiente y serán comunicados con antelación razonable.",
        ],
      },
      {
        h: "6. Cobro de cuotas del condominio",
        p: [
          "Para recibir cuotas del condominio en línea, el Condominio abre su propia cuenta de cobro en Stripe (Stripe Connect), pasa por la verificación de identidad (KYC) conducida por Stripe y acepta los términos de Stripe. El Condominio es el titular de los cobros: los recibos salen a su nombre y las tarifas de Stripe se debitan de él.",
          "Sobre cada cobro pagado en línea, la Operadora retiene una tarifa de servicio del 1% del valor, limitada a 1 unidad de la moneda del cobro (por ejemplo, R$ 1,00). El Condominio puede optar por trasladar ese costo al pagador como tasa de conveniencia, con el valor mostrado antes del pago.",
          "En países donde Stripe no ofrece cuentas de cobro, o por opción del Condominio, están disponibles medios manuales: transferencia bancaria con envío de comprobante, criptomoneda (con verificación del hash de la transacción en redes públicas de blockchain) y efectivo, con conciliación manual justificada. La verificación de los pagos informados y la conciliación manual son responsabilidad de la administración del Condominio.",
          "La Operadora no es una institución financiera y no intermedia, no custodia ni garantiza valores debidos al Condominio o por él.",
        ],
      },
      {
        h: "7. Obligaciones del Condominio y del Director",
        itens: [
          "Proporcionar información verdadera, completa y actualizada en el registro, y mantenerla así.",
          "Crear, gestionar y revocar los accesos de los Usuarios, respondiendo por el uso que ellos hagan de la Plataforma.",
          "Ingresar datos personales de residentes, empleados, proveedores y visitantes solo con base legal para ello — ante la legislación de protección de datos, el Condominio es el responsable (controlador) de esos datos.",
          "Utilizar la Plataforma conforme a la ley aplicable a la administración del condominio (estatutos, reglamento interno y legislación local).",
          "Guardar con seguridad las credenciales de acceso y mantener válido y accesible el correo de la cuenta del Director — es allí donde la Plataforma envía el enlace de restablecimiento de contraseña.",
        ],
      },
      {
        h: "8. Protección de datos",
        p: [
          "En el tratamiento de los datos ingresados por el Condominio, la Operadora actúa como encargada (procesadora), siguiendo las instrucciones del Condominio reflejadas en las funcionalidades de la Plataforma. En los datos de la relación comercial (cuenta del Director, registro del Condominio y cobro de la Licencia), la Operadora es la responsable (controladora). Los detalles — datos recopilados, finalidades, comunicaciones, retención y derechos — están en la Política de Privacidad.",
        ],
      },
      {
        h: "9. Disponibilidad y soporte",
        p: [
          "La Operadora emplea sus mejores esfuerzos para mantener la Plataforma disponible y segura, pero no garantiza disponibilidad ininterrumpida ni ofrece un acuerdo de nivel de servicio (SLA). Mantenimientos, actualizaciones y factores externos (proveedores de nube, procesadora de pagos, redes) pueden causar indisponibilidades temporales.",
          "El soporte se presta por el correo suporte@servenowglobal.com, con un plazo de hasta 24 horas para la respuesta.",
        ],
      },
      {
        h: "10. Limitación de responsabilidad",
        p: [
          "La Plataforma es una herramienta de gestión. La Operadora no responde: por las decisiones de la administración del Condominio; por la exactitud de los datos y documentos ingresados por los Usuarios; por disputas entre el Condominio y copropietarios, empleados o terceros; por actos e indisponibilidades de terceros (Stripe, proveedores de nube y de correo, redes de blockchain); ni por caso fortuito o fuerza mayor.",
          "En la máxima medida permitida por la ley, la responsabilidad total de la Operadora se limita al valor pagado por el Condominio por la Licencia en los 12 (doce) meses anteriores al evento. Nada en estos Términos excluye responsabilidades que no puedan ser excluidas por ley, incluidas las normas de protección al consumidor, cuando sean aplicables.",
        ],
      },
      {
        h: "11. Vigencia, cancelación y término",
        p: [
          "La suscripción se renueva automáticamente cada período (mensual o anual) hasta su cancelación. La cancelación puede hacerse en cualquier momento dentro de la Plataforma y surte efecto al final del período ya pagado; hasta entonces, el acceso permanece activo. No hay reembolso proporcional de períodos ya pagados, salvo previsión legal en contrario.",
          "Terminada la Licencia, el acceso se bloquea. Los datos se conservan y eliminan conforme a los plazos de la Política de Privacidad; el Condominio puede solicitar copia o eliminación de los datos a través del soporte, respetando las retenciones legales.",
          "La Operadora puede suspender o terminar el acceso en caso de violación de estos Términos, uso ilícito o riesgo para la seguridad de la Plataforma o de terceros.",
        ],
      },
      {
        h: "12. Propiedad intelectual",
        p: [
          "El software, la marca CondoMaster Pro, el diseño y los demás elementos de la Plataforma pertenecen a la Operadora o a sus licenciantes. La Licencia otorga al Condominio un derecho de uso limitado, no exclusivo e intransferible, sin ninguna cesión de propiedad intelectual. Los datos ingresados por el Condominio siguen siendo del Condominio.",
        ],
      },
      {
        h: "13. Cambios en estos Términos",
        p: [
          "Estos Términos pueden modificarse para reflejar cambios en la Plataforma, en la legislación o en el modelo de negocio. Los cambios relevantes serán comunicados en la propia Plataforma con antelación razonable, y el uso continuado tras la vigencia de la nueva versión vale como aceptación. La versión vigente está siempre disponible en esta página, con la fecha de actualización.",
        ],
      },
      {
        h: "14. Ley aplicable, jurisdicción e idioma",
        p: [
          "Estos Términos se rigen por las leyes de la República Federativa de Brasil. Se elige el fuero de la comarca de la sede de la Operadora, en Balneário Piçarras/SC, para resolver controversias, salvo el fuero garantizado por norma de orden público — como el del domicilio del consumidor, cuando sea aplicable.",
          "Este documento se ofrece en portugués, español e inglés. En caso de divergencia entre las versiones, prevalece la versión en portugués.",
        ],
      },
    ],
  },

  privacidade: {
    titulo: "Política de Privacidad",
    atualizado: "2026-09-22",
    secoes: [
      {
        h: "1. Visión general y roles",
        p: [
          "Esta Política describe cómo la plataforma CondoMaster Pro (condomaster.servenowglobal.com) trata datos personales. La plataforma es operada por Util Atividades Web LTDA, CNPJ 47.509.953/0001-43, con sede en Balneário Piçarras/SC, Brasil (“nosotros”). Canal de privacidad: suporte@servenowglobal.com.",
          "Roles en el tratamiento, según la LGPD brasileña (Ley nº 13.709/2018) y normas equivalentes:",
        ],
        itens: [
          "El condominio es el responsable (controlador) de los datos de residentes, empleados, proveedores y visitantes que ingresa en la plataforma — es él quien decide a quién registrar y para qué.",
          "Nosotros somos el encargado (procesador) de esos datos: los tratamos al servicio del condominio, conforme a las funcionalidades de la plataforma.",
          "Nosotros somos el responsable de los datos de la relación comercial: la cuenta del director, el registro del condominio y el cobro de la licencia.",
        ],
      },
      {
        h: "2. Datos que tratamos",
        itens: [
          "Cuenta de acceso: nombre, correo electrónico (director, administrador y tesorería; el residente entra con nombre y contraseña, sin necesidad de correo) y contraseña — almacenada exclusivamente como hash criptográfico (scrypt), nunca en texto claro. Preferencia de idioma.",
          "Registro de personas (ingresado por el condominio): nombre, documento fiscal o de identidad (CPF, CNPJ, RG, CI, DNI, CUIT, RUT, RFC y equivalentes), teléfono y correo opcionales, unidad y vínculo con el condominio, y copia del documento de identidad cuando se adjunta.",
          "Gestión del condominio: movimientos financieros, cobros y pagos, comprobantes y hashes de transacción cripto informados, multas con descargos y pruebas, comunicados y confirmaciones de lectura, tickets de mantenimiento, registros de portería (nombre de visitantes, placas de vehículos, entregas e incidencias) y documentos generados.",
          "Registros técnicos y de seguridad: dirección IP e identificador de inicio de sesión en el registro de auditoría y en contadores de protección contra abuso, con fecha y hora de los eventos.",
          "País aproximado: usamos solo el país informado por la infraestructura de borde (Vercel) para sugerir idioma y moneda. La dirección IP no se lee, no se guarda ni se comparte para esa finalidad.",
        ],
      },
      {
        h: "3. Lo que no hacemos",
        itens: [
          "No tenemos acceso a los datos de su tarjeta — se informan directamente a Stripe, en una página de la propia Stripe.",
          "No vendemos datos personales ni los usamos para publicidad.",
          "No usamos cookies de terceros ni rastreo entre sitios.",
          "No enviamos SMS, push ni mensajes de WhatsApp. Por correo electrónico, enviamos solo mensajes transaccionales solicitados por usted — hoy, el enlace de restablecimiento de contraseña del director y del administrador, desde el remitente no-reply@servenowglobal.com. Los correos de factura y recibo de la licencia los envía Stripe. Nunca marketing.",
        ],
      },
      {
        h: "4. Cookies y almacenamiento en el dispositivo",
        p: ["Usamos solo lo necesario para el funcionamiento de la app:"],
        itens: [
          "Cookie cm_refresh (esencial): mantiene su sesión con seguridad (HttpOnly, Secure). Dura hasta 30 días.",
          "localStorage cm_sessao: datos de la sesión en su dispositivo (perfil y token de acceso — nunca la contraseña). Se elimina al salir.",
          "localStorage cm_lang y cm_lang_auto: idioma elegido e idioma sugerido por el país.",
          "localStorage cm_geo: país, idioma y moneda sugeridos (validez de 7 días).",
          "localStorage cm_cookies_ok: registra que usted vio el aviso de cookies.",
          "sessionStorage (cm_tela y similares): última pantalla abierta; se borra al cerrar la pestaña.",
          "Vercel Analytics: métricas agregadas y anónimas de uso, sin cookies.",
        ],
        p2: [
          "Como no usamos cookies de publicidad ni de rastreo, el aviso de cookies de la app es solo informativo.",
        ],
      },
      {
        h: "5. Finalidades y bases legales",
        itens: [
          "Prestar el servicio contratado (ejecución de contrato): autenticación, registros, cobros, comunicados, portería y demás módulos.",
          "Seguridad y prevención de fraudes (interés legítimo): registro de auditoría, límites de intentos de acceso y detección de reuso de sesión.",
          "Cumplimiento de obligaciones legales: registros fiscales y contables de la licencia.",
          "Mejora del producto (interés legítimo): métricas agregadas de uso, sin identificación individual.",
        ],
      },
      {
        h: "6. Comunicación de datos y subencargados",
        p: ["Compartimos datos solo con los proveedores necesarios para el funcionamiento de la plataforma:"],
        itens: [
          "Supabase — base de datos y almacenamiento de archivos.",
          "Vercel — alojamiento, funciones de servidor, métricas agregadas e identificación del país.",
          "Stripe — procesamiento de los pagos de la licencia y de los cobros del condominio, y verificación de identidad (KYC) de la cuenta de cobro del condominio, conducida por la propia Stripe.",
          "Proveedor de correo del dominio servenowglobal.com — envío de los mensajes transaccionales de la plataforma (como el enlace de restablecimiento de contraseña).",
          "Redes públicas de blockchain — consulta del hash de transacción informado en pagos cripto (el hash es, por naturaleza, público).",
        ],
        p2: [
          "Además, podemos comunicar datos para cumplir una obligación legal o una orden de autoridad competente. No vendemos datos personales.",
        ],
      },
      {
        h: "7. Archivos adjuntos",
        p: [
          "Los archivos enviados a la plataforma (copias de documentos, comprobantes, pruebas de multas, fotos de tickets) se guardan en un repositorio accesible mediante enlaces no listados públicamente: quien tenga el enlace puede abrir el archivo, sin contraseña. Trate esos enlaces como confidenciales. Recomendamos al condominio adjuntar solo lo necesario y evitar documentos sensibles prescindibles.",
        ],
      },
      {
        h: "8. Seguridad",
        itens: [
          "Contraseñas almacenadas con scrypt (hash con sal); códigos de recuperación, tokens de restablecimiento por correo, QRs de portería y tokens de sesión guardados solo como hash.",
          "Aislamiento por condominio en la base de datos (RLS): cada condominio solo accede a sus propios datos.",
          "Tráfico cifrado (HTTPS/HSTS), política restrictiva de contenido (CSP) y cabeceras de seguridad.",
          "Sesiones con rotación de token y detección de reuso — una sospecha de robo revoca todas las sesiones relacionadas.",
          "Registro de auditoría inmutable para eventos de seguridad.",
        ],
      },
      {
        h: "9. Cuánto tiempo guardamos",
        itens: [
          "Registros y datos de gestión: mientras exista la cuenta del condominio y por los plazos legales aplicables. Los registros vinculados a historial financiero pueden impedir la eliminación inmediata de un registro.",
          "Registro de auditoría (incluye IP): inmutable y conservado por un mínimo de 365 días.",
          "Documentos membretados: retención prevista de 5 años desde la emisión.",
          "Sesiones: hasta 30 días. Registros de idempotencia de operaciones: 24 horas.",
        ],
      },
      {
        h: "10. Sus derechos",
        p: [
          "La LGPD (y normas equivalentes, como el RGPD) le garantiza, entre otros: confirmación de la existencia de tratamiento, acceso, corrección, anonimización o eliminación (con los límites de retención anteriores), portabilidad, información sobre comunicaciones de datos y revocación del consentimiento cuando el tratamiento se base en él.",
          "Cómo ejercerlos: si usted es residente, empleado o visitante, diríjase primero a la administración de su condominio — ella es la responsable de sus datos y puede corregirlos o eliminarlos directamente en la plataforma. También puede contactarnos en suporte@servenowglobal.com; responderemos en un plazo razonable y, cuando la solicitud corresponda al condominio, se la remitiremos.",
        ],
      },
      {
        h: "11. Transferencia internacional",
        p: [
          "Nuestros proveedores (Supabase, Vercel y Stripe) pueden procesar datos en servidores ubicados fuera de su país de residencia. En esos casos, se aplican las salvaguardas contractuales y certificaciones de los propios proveedores, y la transferencia observa los requisitos legales aplicables.",
        ],
      },
      {
        h: "12. Niños y adolescentes",
        p: [
          "La plataforma está destinada a mayores de edad. Los datos de dependientes menores solo existen cuando el condominio los ingresa, bajo su responsabilidad, para fines de gestión del condominio.",
        ],
      },
      {
        h: "13. Cambios y contacto",
        p: [
          "Podemos actualizar esta Política; la versión vigente está siempre en esta página, con la fecha de actualización, y los cambios relevantes serán comunicados en la app. En caso de divergencia entre traducciones, prevalece la versión en portugués.",
          "Util Atividades Web LTDA — CNPJ 47.509.953/0001-43 — Balneário Piçarras/SC, Brasil. Delegado de protección de datos (DPO) y canal de privacidad: suporte@servenowglobal.com.",
        ],
      },
    ],
  },

  termosDeUso: {
    titulo: "Términos de Uso",
    atualizado: "2026-09-22",
    secoes: [
      {
        h: "1. Sobre este documento",
        p: [
          "Estos Términos de Uso valen para toda persona que accede a la plataforma CondoMaster Pro — director, administrador, tesorería y residente. Complementan los Términos de Servicio (el contrato del condominio con la operadora de la plataforma, Util Atividades Web LTDA, CNPJ 47.509.953/0001-43) y la Política de Privacidad. Al usar la plataforma, usted acepta estas reglas.",
        ],
      },
      {
        h: "2. Cuentas y acceso",
        p: [
          "La cuenta del director se crea por autorregistro. Las demás cuentas (administrador, tesorería y residente) las crea el director del condominio, en Gestionar Accesos. El residente entra con nombre y contraseña — no se necesita correo electrónico.",
          "El acceso es personal e intransferible. Usted responde por todo lo que se haga con sus credenciales; comunique de inmediato a la administración si sospecha de un uso indebido.",
        ],
      },
      {
        h: "3. Contraseña y recuperación de acceso",
        p: [
          "Su contraseña tiene un mínimo de 8 caracteres y se almacena de forma protegida (solo el hash criptográfico). La forma de restablecerla depende del perfil:",
        ],
        itens: [
          "Director y administrador: en \"Olvidé mi contraseña\", informan el correo de la cuenta y reciben un enlace de restablecimiento por correo, válido por 60 minutos y de un solo uso.",
          "Tesorería y residente: justo después de entrar, pueden generar un código de recuperación permanente, mostrado una única vez — guárdelo en un lugar seguro. Quien pierda la contraseña y el código puede pedir al director un código temporal de 24 horas, en Gestionar Accesos.",
          "Mantenga el correo de su cuenta correcto y accesible: es allí donde se envía el enlace de restablecimiento. Si el correo registrado del administrador está equivocado o inaccesible, el director puede eliminar y recrear el acceso en Gestionar Accesos.",
        ],
        p2: [
          "La sesión puede permanecer activa hasta 30 días en el dispositivo. En dispositivos compartidos, use siempre el botón Salir.",
        ],
      },
      {
        h: "4. Uso aceptable",
        p: ["Está prohibido, entre otras conductas:"],
        itens: [
          "acceder o intentar acceder a cuentas o datos de terceros, o eludir los mecanismos de seguridad y de aislamiento entre condominios;",
          "sobrecargar la plataforma con accesos automatizados, raspado de datos o uso abusivo;",
          "ingresar contenido ilícito, ofensivo, discriminatorio o que viole derechos de terceros;",
          "registrar datos personales de terceros sin base legal o autorización para ello;",
          "usar la plataforma para fines ajenos a la gestión del condominio.",
        ],
      },
      {
        h: "5. Contenido enviado",
        p: [
          "Al enviar cualquier contenido — comprobantes, descargos de multas, pruebas, fotos, videos, documentos —, usted declara que es verdadero y que tiene derecho a enviarlo. Los comprobantes falsos o adulterados, y los hashes de transacción que no correspondan al pago, pueden generar responsabilidad civil y penal, además de la suspensión del acceso.",
          "Los archivos adjuntos quedan accesibles mediante enlaces no listados públicamente: cualquier persona con el enlace puede abrir el archivo. No comparta esos enlaces fuera del contexto de la gestión del condominio y adjunte solo lo necesario.",
        ],
      },
      {
        h: "6. Pagos por el portal",
        p: [
          "El pago en línea es procesado por Stripe, en una página de la propia Stripe — los datos de la tarjeta no pasan por la plataforma. Los pagos informados manualmente (transferencia bancaria o criptomoneda) quedan pendientes hasta la verificación por la administración del condominio; los pagos en criptomoneda se verifican en las redes públicas de blockchain a partir del hash informado.",
          "La plataforma registra los cobros y los pagos, pero quien define valores, vencimientos y reglas de cobro es la administración del condominio. Las dudas o reclamaciones sobre cobros deben tratarse directamente con ella.",
        ],
      },
      {
        h: "7. Privacidad",
        p: [
          "El tratamiento de sus datos personales está descrito en la Política de Privacidad. En resumen: el condominio, que ingresa y administra los registros, es el responsable de sus datos; la operadora de la plataforma los trata como encargada. El canal para asuntos de privacidad es suporte@servenowglobal.com.",
        ],
      },
      {
        h: "8. Propiedad intelectual",
        p: [
          "El software, la marca y el diseño de la plataforma están protegidos por derechos de propiedad intelectual. Usted recibe una licencia de uso personal, limitada y revocable, solo para utilizar la plataforma (incluso instalada como aplicación). Está prohibido copiar, modificar, distribuir o hacer ingeniería inversa.",
        ],
      },
      {
        h: "9. Suspensión y término del acceso",
        p: [
          "El director puede crear y eliminar accesos del condominio en cualquier momento. La operadora puede suspender accesos en caso de violación de estos Términos o de riesgo para la seguridad. El término de la licencia del condominio finaliza el acceso de todos sus usuarios.",
        ],
      },
      {
        h: "10. Disposiciones finales",
        p: [
          "Estos Términos pueden actualizarse; la versión vigente está siempre en esta página, con la fecha de actualización. Se aplican las leyes brasileñas, con jurisdicción en la comarca de Balneário Piçarras/SC, sede de la operadora, salvo el fuero garantizado por norma de orden público — como el del domicilio del consumidor, cuando sea aplicable. En caso de divergencia entre traducciones, prevalece la versión en portugués. Contacto: suporte@servenowglobal.com.",
        ],
      },
    ],
  },
};
