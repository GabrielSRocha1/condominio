/* Legal documents — ENGLISH (1:1 translation of conteudo.pt.js, which is the
   source of truth). For any change, update the PT file first. */
export default {
  ui: {
    atualizado: "Last updated",
    voltar: "Back to the app",
    temaClaro: "Light theme",
    temaEscuro: "Dark theme",
    locale: "en",
  },

  termos: {
    titulo: "Terms of Service",
    atualizado: "2026-09-22",
    secoes: [
      {
        h: "1. Who we are and definitions",
        p: [
          "These Terms of Service govern the subscription to and use of the CondoMaster Pro platform (“Platform”), available at condomaster.servenowglobal.com and operated by Util Atividades Web LTDA, registered under Brazilian tax ID (CNPJ) no. 47.509.953/0001-43, headquartered in Balneário Piçarras, Santa Catarina, Brazil (“Operator”). Contact: suporte@servenowglobal.com.",
        ],
        itens: [
          "Condominium (Customer): the condominium that subscribes to the usage license, represented by the Director.",
          "Director: the person who creates the account, registers the Condominium, and represents it before the Operator.",
          "Users: the people whose access is created by the Director (building manager, treasury, and resident).",
          "License: the subscription that entitles a Condominium to use the Platform.",
        ],
      },
      {
        h: "2. Acceptance",
        p: [
          "By creating an account and registering a Condominium, the Director accepts these Terms on their own behalf and on behalf of the Condominium, declaring they have the authority to represent it (for example, as building manager, administrator, or elected director). If you do not agree with these Terms, do not use the Platform.",
          "Use of the Platform by the other Users is also governed by the Terms of Use, and the processing of personal data by the Privacy Policy — both available on the Platform and an integral part of these Terms.",
        ],
      },
      {
        h: "3. What the Platform offers",
        p: [
          "The Platform is condominium-management software delivered as SaaS (software as a service), accessed through the browser and installable as an app (PWA). Available modules include:",
        ],
        itens: [
          "finance with approval workflows;",
          "condominium charges with QR codes and online payment;",
          "fines and warnings with a defense workflow;",
          "announcements with read confirmation;",
          "letterheaded PDF documents;",
          "maintenance tickets;",
          "front desk with visitor pre-authorization via single-use QR codes;",
          "resident portal;",
          "interface in 15 languages.",
        ],
        p2: [
          "The available features are those offered on the Platform at the time of use and may evolve. Features under development or merely announced are not part of the subscribed service until they are actually available.",
        ],
      },
      {
        h: "4. Plans, prices, and free trial",
        p: [
          "The License is subscribed per plan (with a unit limit) and per period (monthly or annual), with prices in Brazilian reais (R$) displayed on the Plans screen at the time of subscription. For customers outside Brazil, the amount may be shown converted to the local currency by Stripe, our payment processor.",
          "Each Condominium's first subscription may include a 30-day free trial, with a card on file. The trial may be extended once, at the Operator's discretion. The Operator may also provide activation codes that create the subscription with payment by invoice, with the due date stated on the invoice itself.",
          "Each plan has a unit limit. Exceeding the limit does not interrupt use; the Operator reserves the right to charge for the excess units or to request a plan upgrade, upon prior notice.",
        ],
      },
      {
        h: "5. License payment, default, and blocking",
        p: [
          "License payments are processed by Stripe. Card data is provided directly to Stripe and never passes through the Operator's servers. Invoices, receipts, and card changes are available in the billing portal (Stripe), accessible within the Platform.",
          "In case of payment failure or an overdue invoice, the subscription becomes delinquent and access to the Platform is blocked until it is settled. Blocking does not delete the Condominium's data.",
          "Prices may be adjusted; adjustments take effect from the following period and will be communicated with reasonable notice.",
        ],
      },
      {
        h: "6. Collecting condominium charges",
        p: [
          "To collect condominium fees online, the Condominium opens its own payout account at Stripe (Stripe Connect), goes through Stripe's identity verification (KYC), and accepts Stripe's terms. The Condominium is the holder of the funds: receipts are issued in its name and Stripe's fees are debited from it.",
          "On each charge paid online, the Operator withholds a service fee of 1% of the amount, capped at 1 unit of the charge's currency (for example, R$ 1.00). The Condominium may choose to pass this cost on to the payer as a convenience fee, with the amount shown before payment.",
          "In countries where Stripe does not offer payout accounts, or at the Condominium's option, manual methods are available: bank transfer with proof of payment, cryptocurrency (with verification of the transaction hash on public blockchain networks), and cash, with justified manual settlement. Reviewing reported payments and manual settlement are the responsibility of the Condominium's management.",
          "The Operator is not a financial institution and does not intermediate, hold in custody, or guarantee amounts owed to or by the Condominium.",
        ],
      },
      {
        h: "7. Obligations of the Condominium and the Director",
        itens: [
          "Provide true, complete, and up-to-date information at registration, and keep it that way.",
          "Create, manage, and revoke Users' access, being accountable for their use of the Platform.",
          "Enter personal data of residents, employees, service providers, and visitors only with a legal basis to do so — under data protection law, the Condominium is the controller of that data.",
          "Use the Platform in accordance with the law applicable to condominium administration (bylaws, internal regulations, and local legislation).",
          "Keep access credentials safe and keep the Director's account email valid and accessible — that is where the Platform sends the password reset link.",
        ],
      },
      {
        h: "8. Data protection",
        p: [
          "When processing data entered by the Condominium, the Operator acts as a processor, following the Condominium's instructions as reflected in the Platform's features. For data related to the commercial relationship (the Director's account, the Condominium's registration, and License billing), the Operator is the controller. The details — data collected, purposes, sharing, retention, and rights — are in the Privacy Policy.",
        ],
      },
      {
        h: "9. Availability and support",
        p: [
          "The Operator uses its best efforts to keep the Platform available and secure, but does not guarantee uninterrupted availability nor offer a service level agreement (SLA). Maintenance, updates, and external factors (cloud providers, payment processor, networks) may cause temporary unavailability.",
          "Support is provided via the email suporte@servenowglobal.com, with a response time of up to 24 hours.",
        ],
      },
      {
        h: "10. Limitation of liability",
        p: [
          "The Platform is a management tool. The Operator is not liable: for decisions made by the Condominium's management; for the accuracy of data and documents entered by Users; for disputes between the Condominium and unit owners, employees, or third parties; for acts and outages of third parties (Stripe, cloud and email providers, blockchain networks); or for unforeseeable circumstances or force majeure.",
          "To the maximum extent permitted by law, the Operator's total liability is limited to the amount paid by the Condominium for the License in the 12 (twelve) months preceding the event. Nothing in these Terms excludes liabilities that cannot be waived by law, including consumer protection rules where applicable.",
        ],
      },
      {
        h: "11. Term, cancellation, and termination",
        p: [
          "The subscription renews automatically each period (monthly or annual) until canceled. Cancellation can be done at any time within the Platform and takes effect at the end of the period already paid; until then, access remains active. There is no pro-rated refund of periods already paid, unless required by law.",
          "Once the License ends, access is blocked. Data is retained and deleted according to the periods in the Privacy Policy; the Condominium may request a copy or deletion of its data through support, subject to legal retention requirements.",
          "The Operator may suspend or terminate access in case of violation of these Terms, unlawful use, or risk to the security of the Platform or third parties.",
        ],
      },
      {
        h: "12. Intellectual property",
        p: [
          "The software, the CondoMaster Pro brand, the layout, and the other elements of the Platform belong to the Operator or its licensors. The License grants the Condominium a limited, non-exclusive, non-transferable right of use, with no assignment of intellectual property. Data entered by the Condominium remains the Condominium's.",
        ],
      },
      {
        h: "13. Changes to these Terms",
        p: [
          "These Terms may be changed to reflect changes in the Platform, in legislation, or in the business model. Relevant changes will be communicated on the Platform itself with reasonable notice, and continued use after the new version takes effect constitutes agreement. The current version is always available on this page, with its update date.",
        ],
      },
      {
        h: "14. Governing law, venue, and language",
        p: [
          "These Terms are governed by the laws of the Federative Republic of Brazil. The courts of the district of the Operator's headquarters, in Balneário Piçarras/SC, are elected to settle disputes, except where a public-order rule guarantees another venue — such as the consumer's domicile, where applicable.",
          "This document is provided in Portuguese, Spanish, and English. In case of divergence between versions, the Portuguese version prevails.",
        ],
      },
    ],
  },

  privacidade: {
    titulo: "Privacy Policy",
    atualizado: "2026-09-22",
    secoes: [
      {
        h: "1. Overview and roles",
        p: [
          "This Policy describes how the CondoMaster Pro platform (condomaster.servenowglobal.com) processes personal data. The platform is operated by Util Atividades Web LTDA, Brazilian tax ID (CNPJ) 47.509.953/0001-43, headquartered in Balneário Piçarras/SC, Brazil (“we”). Privacy channel: suporte@servenowglobal.com.",
          "Processing roles, under Brazil's LGPD (Law no. 13,709/2018) and equivalent regulations:",
        ],
        itens: [
          "The condominium is the controller of the data of residents, employees, service providers, and visitors it enters into the platform — it decides who to register and why.",
          "We are the processor of that data: we process it on the condominium's behalf, according to the platform's features.",
          "We are the controller of the commercial relationship data: the director's account, the condominium's registration, and license billing.",
        ],
      },
      {
        h: "2. Data we process",
        itens: [
          "Access account: name, email (director, building manager, and treasury; residents sign in with name and password, no email needed), and password — stored exclusively as a cryptographic hash (scrypt), never in plain text. Language preference.",
          "People records (entered by the condominium): name, tax or identity document (CPF, CNPJ, RG, CI, DNI, CUIT, RUT, RFC, and equivalents), optional phone and email, unit and relationship with the condominium, and a copy of an identity document when attached.",
          "Condominium management: financial entries, charges and payments, proofs of payment and reported crypto transaction hashes, fines with defenses and evidence, announcements and read confirmations, maintenance tickets, front-desk records (visitor names, vehicle plates, deliveries, and incidents), and generated documents.",
          "Technical and security records: IP address and login identifier in the audit trail and in abuse-protection counters, with the date and time of events.",
          "Approximate country: we use only the country reported by the edge infrastructure (Vercel) to suggest language and currency. The IP address is not read, stored, or shared for that purpose.",
        ],
      },
      {
        h: "3. What we do not do",
        itens: [
          "We have no access to your card data — it is provided directly to Stripe, on Stripe's own page.",
          "We do not sell personal data or use it for advertising.",
          "We do not use third-party cookies or cross-site tracking.",
          "We do not send SMS, push, or WhatsApp messages. By email, we send only transactional messages you request — today, the password reset link for the director and the building manager, from the sender no-reply@servenowglobal.com. License invoice and receipt emails are sent by Stripe. Never marketing.",
        ],
      },
      {
        h: "4. Cookies and on-device storage",
        p: ["We use only what is needed for the app to work:"],
        itens: [
          "cm_refresh cookie (essential): keeps your session secure (HttpOnly, Secure). Lasts up to 30 days.",
          "localStorage cm_sessao: session data on your device (profile and access token — never the password). Removed on sign-out.",
          "localStorage cm_lang and cm_lang_auto: chosen language and country-suggested language.",
          "localStorage cm_geo: suggested country, language, and currency (valid for 7 days).",
          "localStorage cm_cookies_ok: records that you saw the cookie notice.",
          "sessionStorage (cm_tela and similar): last open screen; erased when the tab closes.",
          "Vercel Analytics: aggregated, anonymous usage metrics, without cookies.",
        ],
        p2: [
          "Since we do not use advertising or tracking cookies, the app's cookie notice is informational only.",
        ],
      },
      {
        h: "5. Purposes and legal bases",
        itens: [
          "Providing the subscribed service (performance of contract): authentication, records, charges, announcements, front desk, and the other modules.",
          "Security and fraud prevention (legitimate interest): audit trail, sign-in attempt limits, and session reuse detection.",
          "Compliance with legal obligations: tax and accounting records for the license.",
          "Product improvement (legitimate interest): aggregated usage metrics, without individual identification.",
        ],
      },
      {
        h: "6. Sharing and sub-processors",
        p: ["We share data only with the providers needed to run the platform:"],
        itens: [
          "Supabase — database and file storage.",
          "Vercel — hosting, server functions, aggregated metrics, and country identification.",
          "Stripe — processing of license payments and condominium charges, and identity verification (KYC) of the condominium's payout account, conducted by Stripe itself.",
          "Email provider of the servenowglobal.com domain — delivery of the platform's transactional messages (such as the password reset link).",
          "Public blockchain networks — lookup of the transaction hash reported for crypto payments (the hash is, by nature, public).",
        ],
        p2: [
          "In addition, we may share data to comply with a legal obligation or an order from a competent authority. We do not sell personal data.",
        ],
      },
      {
        h: "7. Attached files",
        p: [
          "Files uploaded to the platform (document copies, proofs of payment, fine evidence, ticket photos) are kept in a repository accessible through unlisted links: anyone with the link can open the file, without a password. Treat those links as confidential. We recommend the condominium attach only what is necessary and avoid dispensable sensitive documents.",
        ],
      },
      {
        h: "8. Security",
        itens: [
          "Passwords stored with scrypt (salted hash); recovery codes, email reset tokens, front-desk QR codes, and session tokens stored only as hashes.",
          "Per-condominium isolation in the database (RLS): each condominium can only access its own data.",
          "Encrypted traffic (HTTPS/HSTS), a restrictive content policy (CSP), and security headers.",
          "Sessions with token rotation and reuse detection — suspected theft revokes all related sessions.",
          "Immutable audit trail for security events.",
        ],
      },
      {
        h: "9. How long we keep data",
        itens: [
          "Records and management data: for as long as the condominium's account exists and for the applicable legal periods. Records tied to financial history may prevent the immediate deletion of a person's record.",
          "Audit trail (includes IP): immutable and kept for at least 365 days.",
          "Letterheaded documents: planned retention of 5 years from issuance.",
          "Sessions: up to 30 days. Operation idempotency records: 24 hours.",
        ],
      },
      {
        h: "10. Your rights",
        p: [
          "The LGPD (and equivalent regulations, such as the GDPR) guarantees you, among others: confirmation that processing exists, access, correction, anonymization or deletion (within the retention limits above), portability, information about sharing, and withdrawal of consent when processing is based on it.",
          "How to exercise them: if you are a resident, employee, or visitor, first contact your condominium's management — it is the controller of your data and can correct or remove it directly on the platform. You can also contact us at suporte@servenowglobal.com; we will respond within a reasonable time and, when the request falls to the condominium, we will forward it to them.",
        ],
      },
      {
        h: "11. International transfer",
        p: [
          "Our providers (Supabase, Vercel, and Stripe) may process data on servers located outside your country of residence. In those cases, the providers' own contractual safeguards and certifications apply, and the transfer follows the applicable legal requirements.",
        ],
      },
      {
        h: "12. Children and adolescents",
        p: [
          "The platform is intended for adults. Data about minor dependents exists only when entered by the condominium, under its responsibility, for condominium-management purposes.",
        ],
      },
      {
        h: "13. Changes and contact",
        p: [
          "We may update this Policy; the current version is always on this page, with its update date, and relevant changes will be communicated in the app. In case of divergence between translations, the Portuguese version prevails.",
          "Util Atividades Web LTDA — CNPJ 47.509.953/0001-43 — Balneário Piçarras/SC, Brazil. Data protection officer (DPO) and privacy channel: suporte@servenowglobal.com.",
        ],
      },
    ],
  },

  termosDeUso: {
    titulo: "Terms of Use",
    atualizado: "2026-09-22",
    secoes: [
      {
        h: "1. About this document",
        p: [
          "These Terms of Use apply to everyone who accesses the CondoMaster Pro platform — director, building manager, treasury, and resident. They complement the Terms of Service (the condominium's contract with the platform operator, Util Atividades Web LTDA, Brazilian tax ID 47.509.953/0001-43) and the Privacy Policy. By using the platform, you agree to these rules.",
        ],
      },
      {
        h: "2. Accounts and access",
        p: [
          "The director's account is created by self-registration. The other accounts (building manager, treasury, and resident) are created by the condominium's director, in Manage Access. Residents sign in with name and password — no email is needed.",
          "Access is personal and non-transferable. You are responsible for everything done with your credentials; notify the management immediately if you suspect misuse.",
        ],
      },
      {
        h: "3. Password and access recovery",
        p: [
          "Your password is at least 8 characters long and is stored in protected form (only its cryptographic hash). How you reset it depends on your profile:",
        ],
        itens: [
          "Director and building manager: under \"I forgot my password\", they enter the account email and receive a reset link by email, valid for 60 minutes and single use.",
          "Treasury and residents: right after signing in, they can generate a permanent recovery code, shown only once — keep it in a safe place. Anyone who loses both the password and the code can ask the director for a temporary 24-hour code, in Manage Access.",
          "Keep your account email correct and accessible: that is where the reset link is sent. If the building manager's registered email is wrong or inaccessible, the director can remove and recreate the access in Manage Access.",
        ],
        p2: [
          "The session can stay active for up to 30 days on the device. On shared devices, always use the Sign out button.",
        ],
      },
      {
        h: "4. Acceptable use",
        p: ["It is prohibited, among other conduct:"],
        itens: [
          "to access or attempt to access third parties' accounts or data, or to bypass the security and cross-condominium isolation mechanisms;",
          "to overload the platform with automated access, data scraping, or abusive use;",
          "to enter unlawful, offensive, or discriminatory content, or content that violates third-party rights;",
          "to register third parties' personal data without a legal basis or authorization to do so;",
          "to use the platform for purposes unrelated to condominium management.",
        ],
      },
      {
        h: "5. Submitted content",
        p: [
          "By submitting any content — proofs of payment, fine defenses, evidence, photos, videos, documents — you declare it is true and that you have the right to submit it. False or altered proofs, and transaction hashes that do not correspond to the payment, may lead to civil and criminal liability, in addition to suspension of access.",
          "Attached files are accessible through unlisted links: anyone with the link can open the file. Do not share those links outside the context of condominium management, and attach only what is necessary.",
        ],
      },
      {
        h: "6. Payments through the portal",
        p: [
          "Online payment is processed by Stripe, on Stripe's own page — card data does not pass through the platform. Manually reported payments (bank transfer or cryptocurrency) remain pending until reviewed by the condominium's management; cryptocurrency payments are verified on public blockchain networks from the reported hash.",
          "The platform records charges and payments, but it is the condominium's management that defines amounts, due dates, and billing rules. Questions or disputes about charges must be handled directly with them.",
        ],
      },
      {
        h: "7. Privacy",
        p: [
          "The processing of your personal data is described in the Privacy Policy. In short: the condominium, which enters and manages the records, is the controller of your data; the platform operator processes it as a processor. The channel for privacy matters is suporte@servenowglobal.com.",
        ],
      },
      {
        h: "8. Intellectual property",
        p: [
          "The platform's software, brand, and design are protected by intellectual property rights. You receive a personal, limited, revocable license only to use the platform (including installed as an app). Copying, modifying, distributing, or reverse engineering is prohibited.",
        ],
      },
      {
        h: "9. Suspension and termination of access",
        p: [
          "The director may create and remove the condominium's accesses at any time. The operator may suspend access in case of violation of these Terms or risk to security. The end of the condominium's license terminates access for all of its users.",
        ],
      },
      {
        h: "10. Final provisions",
        p: [
          "These Terms may be updated; the current version is always on this page, with its update date. Brazilian law applies, with venue in the district of Balneário Piçarras/SC, the operator's headquarters, except where a public-order rule guarantees another venue — such as the consumer's domicile, where applicable. In case of divergence between translations, the Portuguese version prevails. Contact: suporte@servenowglobal.com.",
        ],
      },
    ],
  },
};
