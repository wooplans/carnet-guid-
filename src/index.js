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
  const res = await fetch(`${apiBase(env)}/checkout/sessions`, {
    method: "POST",
    headers: sebHeaders(env),
    body: JSON.stringify({
      amount: AMOUNT,
      currency: CURRENCY,
      redirect_url: `${origin}/merci`,
      external_reference: `carnet-${crypto.randomUUID()}`,
      metadata: { product: PRODUCT },
    }),
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/checkout" && request.method === "POST") return createCheckout(request, env);
    if (url.pathname === "/merci" && request.method === "GET") return thankYou(url, env);
    return env.ASSETS.fetch(request);
  },
};
