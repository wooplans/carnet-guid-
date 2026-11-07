# Contexte du projet

Page de vente du carnet « Bilan 2026 & Plan 2027 » (produit numérique de fin d'année, 2 900 XAF).
Marché : Afrique francophone. Acquisition : publicités Facebook, donc rester conforme aux règles Meta (pas de promesse de résultat, pas de formulation qui vise l'état personnel, pas de faux témoignages).
Paiement : SebPay (Mobile Money + carte) via un Worker Cloudflare. Docs : https://new.sebpay.bj/fr/docs (v2).

## Règles de travail
- Répondre en français, de façon concise.
- Copy courte et percutante, pensée pour mobile.
- Page autonome dans `public/index.html` ; logique serveur dans `src/index.js`.
- Domaine : `carnet.mymusika.com` (sous-domaine). Ne jamais modifier ni écraser le Worker `mymusika`.
- SÉCURITÉ : ne jamais écrire de clé SebPay (`pk_`/`sk_`) dans le code, le README ou un commit. Elles vivent uniquement dans les secrets Cloudflare (`wrangler secret put`). La clé secrète ne va jamais côté navigateur.
- Confirmer un paiement uniquement en relisant la session côté serveur (`transaction_status === "approved"`), jamais sur la seule foi du retour navigateur.

## Reste à faire
- Déployer avec les clés de test, faire un paiement de test, puis passer en live.
- Webhook SebPay + email Resend : codés et testés en local (signature, idempotence). Reste à tester en réel après déploiement (secret RESEND_API_KEY à créer).
- Lien de téléchargement protégé (R2).
- Pixel Meta : fait (MyMusikaPixel 2109476576672442 ; PageView, InitiateCheckout, Purchase sur /merci). Reste à vérifier dans Test Events.
- 3 pubs Facebook de test (angles : nouveau départ, argent, méthode).
