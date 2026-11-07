// Worker : sert la page de vente (assets statiques) et gère le paiement SebPay.
//
// Routes :
//   POST /api/checkout  -> crée une session SebPay et renvoie { checkout_url }
//   GET  /merci         -> page de retour : vérifie le paiement côté serveur puis donne le lien de téléchargement
//
// Secrets (jamais dans le code ni dans Git) :
//   SEBPAY_PUBLIC_KEY, SEBPAY_SECRET_KEY   -> wrangler secret put ...
// Variables facultatives (wrangler.jsonc ou secret) :
//   SEBPAY_API_BASE  (défaut : https://newapi.sebpay.bj/api/v1)
//   DOWNLOAD_URL     (lien de téléchargement du carnet, https)

const DEFAULT_API = "https://newapi.sebpay.bj/api/v1";
const AMOUNT = 2900;
const CURRENCY = "XAF";
const PRODUCT = "carnet-bilan-plan-2027";
const PIXEL_ID = "2109476576672442"; // MyMusikaPixel (identifiant public)

function apiBase(env) {
  return (env.SEBPAY_API_BASE || DEFAULT_API).replace(/\/+$/, "");
}

function sebHeaders(env) {
  return {
    "X-Public-Key": env.SEBPAY_PUBLIC_KEY,
    "X-Secret-Key": env.SEBPAY_SECRET_KEY, // serveur uniquement
    "Content-Type": "application/json",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function page(title, body, status = 200) {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title}</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#fffaf0;color:#1b1b1f;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;line-height:1.55}
main{max-width:460px;text-align:center}
h1{font-size:1.7rem;line-height:1.15;margin:0 0 12px;color:#14213d}
p{margin:0 0 16px;color:#5d6270}
.btn{display:flex;align-items:center;justify-content:center;min-height:56px;padding:0 22px;border-radius:14px;background:#f2a900;color:#14213d;font-weight:900;text-decoration:none}
</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function createCheckout(request, env) {
  if (!env.SEBPAY_PUBLIC_KEY || !env.SEBPAY_SECRET_KEY) {
    return json({ error: "Paiement non configuré" }, 500);
  }
  const origin = new URL(request.url).origin;

  // Email facultatif : sert à envoyer le carnet par email après le paiement.
  let email = "";
  try {
    const body = await request.json();
    if (body && isEmail(body.email)) email = body.email.trim().toLowerCase();
  } catch {}

  const payload = {
    amount: AMOUNT,
    currency: CURRENCY,
    redirect_url: `${origin}/merci`,
    callback_url: `${origin}/api/webhook`,
    external_reference: `carnet-${crypto.randomUUID()}`,
    metadata: { product: PRODUCT, ...(email ? { email } : {}) },
  };
  if (email) payload.customer_email = email;

  const res = await fetch(`${apiBase(env)}/checkout/sessions`, {
    method: "POST",
    headers: sebHeaders(env),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("SebPay checkout error", res.status, await res.text());
    return json({ error: "Paiement indisponible" }, 502);
  }
  const session = await res.json();
  if (!session.checkout_url) return json({ error: "Réponse SebPay invalide" }, 502);
  return json({ checkout_url: session.checkout_url });
}

async function thankYou(url, env) {
  const id = url.searchParams.get("checkout_session_id");
  if (!id) return page("Paiement", "<h1>Session manquante</h1><p>Retourne sur la page du carnet pour payer.</p><a class=\"btn\" href=\"/\">Retour</a>", 400);

  const res = await fetch(`${apiBase(env)}/checkout/sessions/${encodeURIComponent(id)}`, {
    headers: sebHeaders(env),
  });
  if (!res.ok) {
    console.error("SebPay verify error", res.status);
    return page("Paiement", "<h1>Vérification impossible</h1><p>Recharge cette page dans quelques secondes.</p>", 502);
  }
  const session = await res.json();

  if (session.transaction_status === "approved") {
    const link = env.DOWNLOAD_URL && env.DOWNLOAD_URL.startsWith("https://") ? env.DOWNLOAD_URL : null;
    const action = link
      ? `<a class="btn" href="${link}">Télécharger mon carnet</a>`
      : "<p>Ton lien de téléchargement arrive très vite. Garde cette page ouverte.</p>";
    // Pixel Meta : événement Purchase, une seule fois par session (anti-doublon au rechargement).
    const pixel = `<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${PIXEL_ID}');
fbq('track','PageView');
try{var k='purchase_'+${JSON.stringify(id).replace(/</g, "\\u003c")};if(!localStorage.getItem(k)){fbq('track','Purchase',{value:${AMOUNT},currency:'${CURRENCY}',content_name:'Carnet Bilan 2026 & Plan 2027'});localStorage.setItem(k,'1');}}catch(e){fbq('track','Purchase',{value:${AMOUNT},currency:'${CURRENCY}'});}
<\/script>`;
    return page("Merci !", `<h1>Paiement confirmé. Merci !</h1><p>Ton carnet Bilan 2026 &amp; Plan 2027 est prêt.</p>${action}${pixel}`);
  }
  if (session.transaction_status === "rejected") {
    return page("Paiement", "<h1>Paiement non abouti</h1><p>Tu n'as pas été débité. Tu peux réessayer.</p><a class=\"btn\" href=\"/\">Réessayer</a>");
  }
  return page("Paiement en cours", "<h1>Paiement en cours de confirmation</h1><p>Recharge cette page dans quelques secondes.</p>");
}

function isEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value.trim());
}

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Email de livraison via Resend. La clé d'idempotence évite les doublons si SebPay renvoie le webhook.
async function sendDelivery(env, to, sessionId) {
  if (!env.RESEND_API_KEY || !(env.DOWNLOAD_URL || "").startsWith("https://")) {
    console.error("Email de livraison non configuré (RESEND_API_KEY ou DOWNLOAD_URL manquant)");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `carnet-${sessionId}`,
    },
    body: JSON.stringify({
      from: env.RESEND_FROM || "Carnet 2027 <carnet@wooplans.com>",
      to: [to],
      subject: "Ton carnet Bilan 2026 & Plan 2027",
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1b1b1f">
<h2 style="color:#14213d">Merci pour ton achat !</h2>
<p>Ton carnet <b>Bilan 2026 &amp; Plan 2027</b> est prêt. Prends 1 à 2 heures au calme pour le remplir.</p>
<p><a href="${env.DOWNLOAD_URL}" style="display:inline-block;background:#f2a900;color:#14213d;font-weight:bold;padding:14px 22px;border-radius:12px;text-decoration:none">Télécharger mon carnet</a></p>
<p style="color:#5d6270;font-size:14px">Tu peux le remplir sur ton téléphone ou l'imprimer.</p></div>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}`);
}

// Webhook SebPay : signature HMAC-SHA256 du corps brut, puis relecture de la session avant toute livraison.
async function webhook(request, env) {
  if (!env.SEBPAY_SECRET_KEY) return new Response("not configured", { status: 500 });
  const raw = await request.arrayBuffer();
  const signature = (request.headers.get("X-SebPay-Signature") || "").toLowerCase();
  const expected = await hmacHex(env.SEBPAY_SECRET_KEY, raw);
  if (!signature || !safeEqual(signature, expected)) return new Response("invalid signature", { status: 401 });

  let event;
  try {
    event = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (event.status !== "approved" || !event.checkout_session_id) return new Response("ok");
  if (!event.metadata || event.metadata.product !== PRODUCT) return new Response("ok");

  try {
    const res = await fetch(`${apiBase(env)}/checkout/sessions/${encodeURIComponent(event.checkout_session_id)}`, {
      headers: sebHeaders(env),
    });
    if (!res.ok) return new Response("verify failed", { status: 502 }); // SebPay réessaiera
    const session = await res.json();
    if (session.transaction_status !== "approved") return new Response("ok");

    const email = event.metadata.email || (session.metadata && session.metadata.email);
    if (isEmail(email)) await sendDelivery(env, email.trim(), event.checkout_session_id);
    return new Response("ok");
  } catch (err) {
    console.error("Webhook error", String(err));
    return new Response("error", { status: 502 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/webhook" && request.method === "POST") return webhook(request, env);
    if (url.pathname === "/api/checkout" && request.method === "POST") return createCheckout(request, env);
    if (url.pathname === "/merci" && request.method === "GET") return thankYou(url, env);
    return env.ASSETS.fetch(request);
  },
};
