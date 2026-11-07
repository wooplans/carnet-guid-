# Carnet « Bilan 2026 & Plan 2027 » : page de vente + paiement SebPay

Page de vente mobile du carnet guidé (2 900 XAF), servie sur https://carnet.mymusika.com par un Worker Cloudflare qui gère aussi le paiement SebPay (Mobile Money + carte).

## Fonctionnement

1. Le client clique sur un bouton d'achat : la page appelle `POST /api/checkout`.
2. Le Worker crée une session SebPay (clés secrètes côté serveur) et renvoie `checkout_url`.
3. Le client paie sur la page SebPay, puis revient sur `/merci?checkout_session_id=...`.
4. Le Worker relit la session auprès de SebPay et n'affiche le lien de téléchargement que si `transaction_status` vaut `approved`.

## Mise en route

```bash
npm i -g wrangler          # ou npx wrangler ...
npx wrangler login

# Clés SebPay : d'abord les clés de TEST (pk_test_ / sk_test_)
npx wrangler secret put SEBPAY_PUBLIC_KEY
npx wrangler secret put SEBPAY_SECRET_KEY

# Lien de téléchargement du carnet (https)
npx wrangler secret put DOWNLOAD_URL

npx wrangler deploy
```

Ne jamais mettre les clés dans le code, dans Git ou dans le chat. Passer aux clés `live` seulement après un paiement de test réussi (le serveur sandbox peut avoir une URL différente : la renseigner dans `SEBPAY_API_BASE`).

Le Worker `mymusika` (application MyMusika sur la racine du domaine) ne doit pas être modifié.

## À faire ensuite

- Webhook SebPay (`callback_url`, vérification HMAC-SHA256 de `X-SebPay-Signature`) + email de livraison via Resend, pour livrer aussi quand le client ferme l'onglet avant le retour.
- Lien de téléchargement protégé (R2 avec lien temporaire) à la place d'un lien fixe.
- Pixel Meta (MyMusikaPixel, ID 2109476576672442) : actif. PageView et InitiateCheckout sur la page, Purchase sur `/merci` (une seule fois par session). À vérifier avec « Test Events » dans le Gestionnaire d'événements.
