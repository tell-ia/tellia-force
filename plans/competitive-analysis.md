# TelliaForce — Benchmark concurrentiel & plus-value

> Note pour storyboard de présentation. Sources en bas.

## Le point de départ : "Ygo"

L'app évoquée ("Ygo") = très probablement **Hygo**, par la startup française **Alvie**.
Piège important : **Hygo fait de la pulvérisation (phyto), PAS de l'irrigation.**

- Capteur météo embarqué + prévisions locales + 20 000 références agro.
- Conseille dose et moment des **traitements** → économie 10-17 % du budget phyto.
- Recommandations 5 jours, code couleur.
- **Fonction irrigation : aucune.** → pas un concurrent direct.

## Vrais concurrents (irrigation)

| App | Éditeur / pays | Approche |
|-----|----------------|----------|
| IrrigAssistant | Corhize, FR | Conseil irrigation à 3 jours, réactualisé en continu |
| IREY | INGC, Tunisie | Déclenche l'irrigation à 50 % d'épuisement de la réserve sol |
| SOWATER | Sowit, Maroc | Besoin en eau par parcelle via météo + satellite |
| Irré-LIS / Net-Irrig | FR | Bilan hydrique classique, orienté conseil |

## Notre plus-value (TelliaForce)

| Axe | Concurrents | Nous |
|-----|-------------|------|
| Sujet | Hygo = phyto · autres = chiffres irrigation | Irrigation, **conseil quotidien actionnable** |
| Sortie | Prévisions / couleurs / dose | "**Quelle parcelle, quand, combien de mm, pourquoi**" — 1 reco héros/jour |
| Moteur | Boîte noire / seuil simple | **FAO-56, bilan hydrique transparent** (météo réelle + stade culture + sol) + data-viz réserve sol |
| Saisie | Formulaire | **Voix** — log d'arrosage parlé, le modèle se met à jour en direct = le "wow" |
| Preuve | — | Chaque chiffre vient d'une API réelle (`get_parcel_report`), rien n'est simulé |

### Différenciateurs forts

1. **Transparence FAO-56** — on montre le *pourquoi* (réserve 97/144 mm, seuil confort 79 mm), pas juste "arrose". Hygo = opaque.
2. **Conseil décisionnel quotidien** vs dashboard de chiffres à interpréter soi-même.
3. **Log vocal → réserve/courbe bougent sous les yeux** — boucle de feedback absente chez les concurrents.
4. **Chat assistant IA** style WhatsApp — brief du matin + Q/R par parcelle.

### Honnêteté (à garder en tête pour le pitch)

- Hygo n'est **pas** un vrai concurrent (phyto, pas eau). Ne pas le présenter comme tel.
- Vrais rivaux = IrrigAssistant, Sowit, Irré-LIS → eux aussi font du bilan hydrique.
- FAO-56 = standard du secteur, utilisé par tous → **ce n'est pas notre edge technique**.
- Notre edge réel = **UX mobile + saisie voix + transparence du calcul + assistant conversationnel.**

## Sources

- [HYGO sur App Store](https://apps.apple.com/FR/app/id1494676431)
- [Alvie / Hygo — startup profile](https://startup-seeker.com/company/hygo~ag)
- [La startup Alvie présente l'assistant pulvé Hygo (Pleinchamp)](https://www.pleinchamp.com/actualite/la-start-up-alvie-presente-l-assistant-pulve-hygo)
- [Avec Hygo, Alvie aide les agriculteurs dans leurs pulvérisations (Techniques de l'Ingénieur)](https://www.techniques-ingenieur.fr/actualite/articles/avec-hygo-alvie-aide-les-agriculteurs-dans-leurs-pulverisations-110693/)
- [IrrigAssistant — préconisation à 3 jours (Pleinchamp)](https://www.pleinchamp.com/actualite/irrigassistant-une-preconisation-a-3-jours-en-3-phrases-reactualisee-toutes-les-3-secondes)
- [SOWIT accompagne Asma Invest (EcoActu)](https://ecoactu.ma/sowit-accompagne-asma-invest/)
