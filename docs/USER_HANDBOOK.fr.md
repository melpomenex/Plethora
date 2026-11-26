# Manuel d'utilisation de Plethora

**Votre guide complet pour maîtriser la lecture incrémentielle et la répétition espacée**

---

## Présentation

### Qu'est-ce que Plethora ?

Plethora est une puissante application d'apprentissage qui combine deux techniques éprouvées :

**Lecture incrémentielle** : traitez de grandes quantités d'informations en petits morceaux gérables au fil du temps. Au lieu de lire les articles d'un bout à l'autre, vous extrayez les points clés et développez progressivement votre compréhension.

**Répétition espacée** - Révisez le matériel à des intervalles scientifiquement optimisés pour maximiser la rétention. FSRS-7 prédit quand vous êtes sur le point d'oublier et planifie les révisions juste à temps.

### Concepts clés

- **Documents** : documents sources (PDF, EPUB, articles, vidéos)
- **Extraits** : points ou sections clés que vous avez extraits de documents
- **Éléments d'apprentissage** : Flashcards ou cartes de questions-réponses créées à partir d'extraits
- **File d'attente** : éléments dont l'examen est programmé, organisés par priorité
- **Avis** : sessions où vous rappelez et évaluez activement vos connaissances

---

## Pour commencer

### Premier lancement

Lorsque vous lancez Plethora pour la première fois, vous verrez le **Tableau de bord** composé de quatre sections principales :

1. **File d'attente** - Votre file d'attente de révision (vide au début)
2. **Révision** – Séance de révision active
3. **Documents** - Votre bibliothèque de documents
4. **Analytics** - Statistiques de progression

### Configuration initiale

1. **Choisissez un thème** - Accédez à Paramètres → Apparence → Thème
   - 147 thèmes intégrés disponibles (26 modernes, 121 hérités)
   - Essayez « Modern Dark » ou « Material You » pour un look moderne

2. **Configurer les paramètres de révision** - Paramètres → Apprentissage → Algorithme
   - **Algorithme** : FSRS-7 (planificateur de production)
   - **Rétention souhaitée** : 90 % (par défaut) - cible la qualité dont vous souhaitez vous souvenir
   - **Apprendre par jour** : 20 à 50 éléments recommandés pour les débutants

3. **Configurer les catégories** - Paramètres → Catégories
   - Créer des catégories pour différents sujets (par exemple, "Programmation", "Science", "Langues")
   - Les catégories vous aident à organiser et filtrer votre matériel d'apprentissage

### Votre premier document

Importons votre premier document :

1. Cliquez sur **Documents** dans la barre latérale
2. Cliquez sur le bouton **Importer** (en haut à droite)
3. Choisissez votre méthode d'importation :
   - **Fichier local** : sélectionnez un fichier PDF, EPUB ou texte
   - **URL** : collez n'importe quelle URL Web
   - **Arxiv** : collez un identifiant ou une URL de document de recherche
4. Attendez le traitement
   - Si la segmentation automatique est activée dans Paramètres, le document sera automatiquement divisé en extraits après l'importation

---

## Gestion des documents

### Formats d'importation

| Formater | Descriptif | Cas d'utilisation |
|--------|-------------|--------------|
| **PDF** | Format de document portable | Documents de recherche, ebooks, documentation |
| **EPUB** | Publication électronique | Livres, articles avec texte redistribuable |
| **Marquage** | Fichiers `.md` | Documentation technique, remarques |
| **HTML** | Pages Web | Articles, billets de blog |
| **Anki (.apkg)** | Forfait de pont Anki | Migrer depuis Anki |
| Anciennes applications d'apprentissage | Exportations ZIP | Migrer à partir de collections d'apprentissage incrémentiel compatibles |
| **JSON (.json)** | Fichiers de jeu de cartes mémoire | Importer des decks avec des données de planification |
| **URL** | Tout lien Web | Articles en ligne, blogs |
| **Arxiv** | Articles académiques | Littérature de recherche |
| **Capture d'écran** | Capture d'écran | Captures rapides depuis n'importe quelle application |

### Importation de documents

#### Méthode 1 : fichiers locaux

1. Cliquez sur **Documents** → **Importer**
2. Sélectionnez **Fichier local**
3. Accédez à votre fichier et sélectionnez-le
4. Pléthore :
   - Extraire le contenu du texte
   - Calculer le temps de lecture et le nombre de mots
   - Extraire les métadonnées (titre, auteur, etc.)
   - Si l'auto-segmentation est activée (Paramètres → Documents → Traitement automatique à l'importation), divisez automatiquement le document en extraits

#### Méthode 2 : importation d'URL

1. Copiez n'importe quelle URL Web
2. Cliquez sur **Documents** → **Importer** → **URL**.
3. Collez l'URL
4. Cliquez sur **Importer**
5. Plethora récupère et traite le contenu

**Sites pris en charge :**
- Articles de presse (la plupart des sites majeurs)
- Articles de blog
- Pages de documentation
- Moyen, Sous-pile, etc.

#### Méthode 3 : Documents Arxiv

1. Recherchez un article Arxiv (par exemple, « https://arxiv.org/abs/2301.07041 »)
2. Copiez l'URL ou l'ID papier (`2301.07041`)
3. Cliquez sur **Documents** → **Importer** → **Arxiv**
4. Collez l'URL ou l'ID
5. Pléthore de téléchargements :
   - PDF complet
   - Résumé
   - Auteurs
   -Date de parution
   - Références

#### Méthode 4 : importation de deck JSON

Importez des jeux de cartes mémoire à partir de fichiers JSON qui incluent des données de planification (intervalles, facteurs de facilité, historique des révisions).

**Importation via le sélecteur de fichiers :**

1. Cliquez sur **Documents** → **Importer** → **JSON**.
2. Sélectionnez votre fichier de deck `.json`
3. Plethora crée un document de jeu et importe toutes les cartes, en préservant :
   - Planification (intervalles, facteurs de facilité, dates d'échéance)
   - Revoir l'historique (répétitions, échecs, taux de rétention)
   - États de la carte (nouveau, en cours de révision ou suspendu)

**Importation par glisser-déposer :**

Faites glisser un fichier « .json » directement sur la fenêtre de l'application. Si le fichier correspond au format de deck attendu, il est importé automatiquement.

**Format de plate-forme JSON :**

Le fichier doit être un objet plat mappant le texte de la question aux données de la carte :

```json
{
  "Quelle est la puissance de la cellule ?" : {
    "answer": "Les mitochondries.",
    "subject": "Biologie",
    "deck_name": "Biologie cellulaire",
    "ease_factor": 2.6,
    "intervalle_jours": 7,
    "répétitions": 3,
    "due_at": "2026-04-20T12:00:00Z"
  }
}
```

**Remarques :**
- Chaque fichier `.json` crée un deck. Le nom du deck vient du champ `deck_name`.
- Les cartes importées utilisent l'algorithme Plethora Classic par défaut. Vous pouvez changer d'algorithme après l'importation.
- Supprimer deux fois le même fichier ne créera pas de doublons : les cartes existantes sont ignorées.
- Les cartes marquées « known_pile : true » sont importées comme suspendues.

#### Sas d'ingestion et pré-chunking de chapitre/H2

Lorsque vous préparez des clips de navigateur ou des documents longs entrants dans **Needs Review**, cliquez sur **Airlock Triage** pour acheminer le contenu avant qu'il n'inonde votre file d'attente active :
- **`[1]` Cours actif haute priorité (`P10`)** : file d'attente immédiatement pour une étude urgente.
- **`[2]` Evergreen Low-Priority (`P65`)** : Programme un apport progressif normal.
- **`[3]` Reference Only Vault (`P95`, Archivé)** : stocke pour référence/recherche sans entrer dans votre file d'attente SRS due.
- **`[C]` Pre-Chunk by Chapter / H2 Headings** : divise les documents Markdown (`## ` / `# `) ou HTML (`<h2>` / `<h1>`) en sections enfants ordonnées qui héritent de la priorité de niveau choisie.

**Exemple :** L'importation d'un article Markdown en 3 sections ("## Consensus Basics`, `## Leader Election`, `## Log Replication`) avec **Pre-Chunk by Chapter / H2 Headings** activé et en appuyant sur `1` crée 3 sections intitulées à la priorité 10.

### Visionneuse de documents

Une fois importé, ouvrez n'importe quel document pour accéder :

**Fonctionnalités de la visionneuse :**
- **Navigation dans les pages** : faites défiler les pages/sections
- **Zoom** : Ajustez la taille du texte
- **Plein écran** : lecture sans distraction
- **Recherche** : rechercher du texte dans le document
- **Table des matières** : accéder aux sections (si disponible)

**Outils d'annotation :**
1. **Surligner le texte** : Sélectionnez le texte → Choisissez la couleur de surbrillance
   - Jaune : Concepts importants
   - Vert : Exemples
   - Bleu : Définitions
   - Rouge : Points critiques
   - Violet : Thèmes connexes

2. **Créer un extrait** : Sélectionnez le texte → Cliquez sur le bouton "Extraire"
   - L'extrait apparaît dans l'onglet Extraits
   - Peut être converti en flashcard plus tard

3. **Ajouter une note** : Sélectionnez le texte → Cliquez sur le bouton « Note »
   - Joignez vos pensées/notes
   - Des notes apparaissent avec des extraits

4. **Questions et réponses divisées ancrées / Cloze Creator (`Ctrl/Cmd + Shift + Q`)** :
   - Ouvre la création Q&A ou Cloze côte à côte avec le lecteur au lieu de bloquer le passage.
   - Utilisez **Insérer la sélection dans la question** ou **Insérer la sélection dans la réponse** pour extraire le texte en surbrillance directement dans le champ actif.

5. **Puce d'héritage prioritaire et Cloze enchaîné (`C`)** :
   - La barre de sélection affiche la priorité héritée du document (`P<N>`). Maintenez « Shift » et faites défiler la puce (« Shift+Wheel ») pour déplacer la priorité de ± 5 %.
   - Après avoir créé un extrait en ligne, `ArrowUp` / `ArrowDown` ajuste sa priorité pendant 4 secondes.
   - Cliquez sur **[C] Cloze** pour générer une carte de cloze enchaînée en une seule frappe sans quitter le lecteur.

6. **Marge socratique ancrée dans la sélection (`Ctrl/Cmd + J`) et solutions de secours gracieuses pour l'IA** :
   - Mettez en surbrillance un passage et appuyez sur « Ctrl/Cmd + J » (ou cliquez sur **⌘J Socratic**) pour ouvrir un fil de discussion IA en ligne ancré à votre devis.
   - Cliquez sur **Convertir l'explication en extrait** ou **Convertir en Flashcard** pour enregistrer n'importe quelle explication de l'IA en un seul clic.
   - Si votre LLM local ou distant est hors ligne ou expire, **Graceful AI Fallback** préserve votre devis et votre invite et propose **Revenir à l'extraction manuelle** ou **Réessayer avec un contexte plus petit (50 %)**.

7. **Vue éclatée du tableau, des mathématiques et du code** :
   - Survolez ou concentrez n'importe quel bloc large `<table>`, `.katex-display` ou `<pre><code>` (dans Markdown, EPUB ou Extracts) et cliquez sur **Vue éclatée** pour ouvrir un modal panoramique et zoom isolé `0,5x – 3,0x` (`+`, `-`, `0` pour réinitialiser, `Esc` pour fermer).

8. **Mini-carte du métro** :
   - Activez **Subway Map** dans la barre latérale Extraits pour afficher les sections du document et les extraits codés par couleur par état de maîtrise.

### Organisation des documents

**Catégories :**
- Attribuer chaque document à une catégorie
- Filtrer les documents par catégorie
- Les catégories héritent des extraits et des fiches

**Mots clés :**
- Ajouter des balises personnalisées aux documents
- Utiliser des balises pour l'organisation inter-catégories
- Exemples : `#urgent`, `#research`, `#tutorial`

**Recherche :**
- Recherche en texte intégral dans tous les documents
- Filtrer par catégorie, tags, plage de dates
- Trier par titre, date, nombre de mots

---

## Le système d'apprentissage

### Comprendre FSRS-7

**FSRS-7** (Free Spaced Repetition Scheduler, version 7) est le planificateur de cartes mémoire de production de Plethora. Il étend les versions antérieures de FSRS avec un modèle de mémoire **double trace** :

1. **État de mémoire à double trace** : chaque carte suit deux traces de stabilité : une **trace lente** (`stabilité`) pour la rétention à long horizon et une **trace rapide** (`stability_fast`) pour la dynamique de rappel à court horizon. La **récupérabilité** est calculée à partir d'un mélange des deux traces, et non à partir d'une seule valeur de stabilité.
2. **Temps écoulé fractionnaire** : les intervalles d'un même jour et d'une journée partielle entre les avis sont modélisés avec précision (et non arrondis à des jours entiers), de sorte que les intervalles après de courts intervalles sont plus précis.
3. **Modèle à 34 paramètres** : utilise le vecteur de poids FSRS-7 ; l'optimiseur personnel peut les adapter à votre historique d'avis lorsque vous disposez de suffisamment de données.
4. **Notes à quatre boutons** : Encore / Difficile / Bon / Facile (notes 1 à 4) avec intervalles de prévisualisation pour chaque choix.

**Mesures clés :**
- **Stabilité** (trace lente) : force de la mémoire à long horizon (plus élevée = plus stable)
- **Stabilité (rapide)** (trace rapide) : dynamique de rappel à horizon court associée à la trace lente
- **Difficulté** : la difficulté de l'objet pour vous (échelle de 1 à 10)
- **Récupérabilité** : probabilité actuelle de rappel (0 à 100 %), dérivée du modèle à double trace

### Comprendre le SM-18

**SM-18** est le planificateur de génération précédente de la famille. Il représente une évolution significative par rapport au SM-2, introduisant une modélisation de la stabilité de la mémoire et une approche basée sur les données pour le calcul des intervalles.

SM-18 :

1. **Modèles à oubli exponentiel** : utilise la formule « R = 0,9^(t/S) » pour calculer la récupérabilité — la probabilité que vous vous souveniez d'un élément au temps « t » compte tenu de sa stabilité « S »
2. **Suit la difficulté indépendamment** : maintient une valeur de difficulté « D ∈ [0, 1] » pour chaque élément, mise à jour à l'aide d'une formule de moyenne finale qui devient plus réactive à chaque répétition.
3. **Utilise une matrice SInc 3D** : recherche le facteur d'augmentation de la stabilité à partir d'une matrice 21 × 21 × 21 indexée par difficulté, stabilité et récupérabilité – c'est le cœur de l'intelligence du SM-18.
4. **Gère les erreurs avec élégance** : en cas d'échec, réduit la stabilité d'un facteur de 0,87 (divisé en outre par les erreurs accumulées) et réinitialise le compteur de répétitions, mais préserve l'estimation de la difficulté.
5. **Calcule les intervalles à partir de la stabilité** : dérive l'intervalle d'examen suivant à partir de l'objectif de rétention souhaité : `intervalle = S × ln(1-FI) / ln(0.9)`

**Mesures clés :**
- **Stabilité (S)** : combien de temps un souvenir persiste avant de se décomposer (mesuré en jours)
- **Difficulté (D)** : une valeur de 0 (le plus facile) à 1 (le plus difficile), mise à jour via un mélange de moyenne finale après chaque révision
- **Récupérabilité (R)** : probabilité de rappel actuelle, calculée comme `0,9^(écoulé/S)`
- **SInc** : le facteur d'augmentation de la stabilité a été recherché à partir de la matrice de 9 261 entrées : le degré d'augmentation de la stabilité après chaque examen réussi
- **Lapses** : Nombre d'échecs, qui pénalisent la stabilité future sur les laps de temps ultérieurs

### Comprendre le SM-20 et l'arène des algorithmes

L'option **SM-20** de Plethora est une **Algorithm Arena** — une implémentation d'ensemble indépendante qui exécute **cinq** algorithmes à répétition espacée en parallèle sur chaque flashcard et mélange leurs prédictions en un seul calendrier (distinct d'un mode SM-20 pur à noyau unique). Les cinq concurrents, avec les poids de mélange par défaut auxquels ils commencent :

| Fente | Modèle | Poids par défaut | Apprend comment ? |
|------|-------|---------------:|-------------|
| 1 | **SM-2** | 6% | Fixe |
| 2 | **SM-15** | 14% | En continu, à chaque révision |
| 3 | **SM-19** | 45% | En continu, à chaque révision |
| 4 | **SM-20** (le noyau à courbe d'oubli "M4" à 35 paramètres) | 25% | À la demande, via le bouton Optimiser |
| 5 | **FSRS** | 10% | À la demande, via le bouton Optimiser |

**Comment fonctionne le mélange.** Chaque modèle produit indépendamment une estimation de stabilité pour la carte ; l'arène prend une moyenne pondérée et en dérive l'intervalle suivant. Les poids ne sont pas fixes — ils **s'adaptent à vous**. Chaque fois que vous examinez une carte dont la précédente évaluation remonte à au moins un jour, l'Arène évalue la prédiction *précédente* de chaque modèle par rapport à ce qui s'est réellement passé (dont vous vous êtes souvenu ou oublié) et oriente les pondérations vers les modèles qui vous ont le mieux prédit. Aucun modèle n'est jamais complètement éliminé, donc un démarreur lent peut récupérer.

**Deux manières d'apprendre :**

1. **Automatiquement, à chaque révision** — l'optimiseur SM-15 et les matrices SM-19 se mettent à jour immédiatement et les poids de mélange changent. Cela commence dès votre tout premier avis. Vous pouvez le regarder dans Paramètres → Apprentissage : le panneau **Poids d'arène** affiche le pourcentage actuel de chaque modèle et, une fois que vous avez suffisamment d'avis notés, une **R-Metric** (à quel point la prédiction combinée est meilleure que celle du SM-19 seul).
2. **À la demande, lorsque vous cliquez sur Optimiser** — deux des cinq concurrents (le noyau SM-20 et FSRS) peuvent être intégrés à votre historique d'évaluation personnel. Ces ajustements sont sécurisés par une quantité minimale de données (environ plusieurs centaines d'avis espacés de jours) et un contrôle de validation retenu : un ajustement n'est accepté que s'il dépasse réellement les valeurs par défaut expédiées pour les avis que l'ajustement n'a pas vu. Jusque-là, les boutons Optimiser signalent « Pas encore assez d'historique de révision » et ces deux modèles continuent d'utiliser leurs paramètres par défaut.

**Pourquoi il peut dire qu'il n'a pas commencé l'entraînement.** Seules les évaluations espacées d'au moins **un jour** portent le signal — les premières évaluations et les réévaluations le jour même ne disent rien à l'arène (chaque modèle prédit correctement que vous vous en souviendrez), elles ne comptent donc pas dans le total des points. Si vous n'avez qu'une poignée de cartes, attendez-vous à ce que les poids d'arène restent proches de leurs valeurs par défaut et que la R-Metric reste cachée jusqu'à ce que ces cartes commencent à revenir à des intervalles d'un jour. C'est attendu, pas un bug.

**Mesures clés :**
- **Stabilité (S)** : estimation de chaque modèle de la durée de persistance de la mémoire (jours) ; l'Arène les mélange.
- **Difficulté (D)** : estimation de la difficulté de l'objet de chaque modèle.
- **Poids d'arène** : les pourcentages de mélange en direct par modèle, affichés dans les paramètres d'apprentissage.
- **R-Metric** : Amélioration relative du mélange par rapport au SM-19 seul, calculée sur une fenêtre décroissante de vos avis.

**En quoi le SM-20 (Algorithm Arena) diffère du FSRS-7 :**
- FSRS-7 est le planificateur de production unique et la seule option affichée dans les paramètres d'apprentissage.
- SM-20 (Algorithm Arena) est un ensemble expérimental existant qui oppose cinq algorithmes les uns aux autres et permet à vos propres données de choisir le mélange (alors que le mode Pure SM-20 n'exécute directement que le noyau M4). Il reste dans la base de code pour la recherche mais est masqué par le sélecteur du planificateur.

#### Choisir un Horizon Mémoire après un examen du SM-20

Sous **Paramètres → Apprentissage → Algorithm Arena → Après chaque évaluation**, choisissez le niveau de détails de planification souhaité :

- **Gardez le flux (recommandé)** valide immédiatement le choix pondéré d'Arena et passe à la carte suivante. C'est la valeur par défaut.
- **Afficher l'arène** s'arrête après une note éligible et ouvre **Memory Horizon**, avec votre réponse toujours visible pendant que les cinq modèles montrent où ils placeront la prochaine évaluation.

Le même choix compact apparaît sous les six commandes de notation SM-20, de sorte que la notation suivante peut utiliser un mode différent sans quitter la revue. Les deux modes exécutent et entraînent les cinq mêmes modèles de collection ; ce paramètre change uniquement si vous faites le choix final de l'intervalle. L'étape de décision reste limitée aux examens normaux des cartes flash SM-20 ; la lecture de documents, le mode Cram, d'autres algorithmes et le **mode Pure SM-20** conservent leur flux de planification directe existant.

- **Arena Pick** est sélectionné par défaut. Il s’agit de la recommandation pondérée et constitue généralement le meilleur choix lorsque vous souhaitez que l’arène prenne une décision.
- **SM-2, SM-15, SM-19, SM-20 et FSRS** vous permettent de suivre délibérément la proposition exacte d'un modèle pour cette révision. En choisir un ne donne pas à ce modèle un poids de vote supplémentaire ; les pondérations futures continuent d’apprendre uniquement de la précision des prédictions.
- **Personnalisé** accepte un montant et une unité ou une position sur la lentille temporelle logarithmique. Les limites affichées protègent contre les planifications non valides et la date d'échéance exacte est mise à jour avant que vous ne confirmiez.
- **Pourquoi cet intervalle** élargit les propositions, les poids actuels et la gamme Arena. L'intervalle correspond à l'intervalle du plus ancien au plus récent proposé par les cinq modèles, et non à un intervalle d'incertitude ou de confiance.

Rien n'est validé tant que vous n'appuyez sur **Planifier pour …**. Si l'aperçu devient obsolète ou si une sauvegarde échoue, la carte reste en place avec votre note et votre sélection préservées afin que vous puissiez réessayer en toute sécurité. **Retour à la note** supprime la note en attente et vous permet de choisir à nouveau.

Commandes du clavier lorsque Memory Horizon est ouvert :

| Clé | Actions |
|-----|--------|
| `←` / `→` | Explorer les propositions par ordre chronologique |
| `1`–`5` | Sélectionnez SM-2, SM-15, SM-19, SM-20 ou FSRS |
| `A` | Sélectionnez le choix de l'arène |
| 'M' | Sélectionnez Personnalisé |
| « Entrée » ou « Espace » | Confirmer le planning affiché |
| `Évasion` | Retour à la note |

Lors de la révision audio mains libres, Plethora confirme automatiquement Arena Pick afin que la lecture puisse continuer, même lorsque **Afficher l'arène** est sélectionné pour les révisions visuelles. La révision reste récupérable si cette validation automatique échoue.

### Calendrier de lecture des documents (lecture incrémentielle)

FSRS-7 est le planificateur de **flashcard** : il s'entraîne sur les questions-réponses, les cloze et les cartes de base, dont l'objectif est le rappel à long terme. (Les anciens planificateurs tels que SM-18 et SM-20 restent dans la base de code mais sont masqués de l'interface utilisateur.) **Les documents** (les articles, articles et passages que vous lisez via la lecture incrémentielle) sont planifiés par un **FSRS-7** modifié — le planificateur *Engaging* — réglé pour un objectif différent : maintenir le contenu en rotation régulière plutôt que de maximiser la conservation à long terme d'un seul fait. Il s'exécute dans sa propre instance FSRS, distincte de votre planificateur de carte mémoire, de sorte que les valeurs de **stabilité**, **stabilité (rapide)** et **difficulté** que vous voyez pour un document dans la vue Planification sont de véritables paramètres de mémoire FSRS-7.

**Deux pistes de planification, pas une.** C'est la plus grande source de confusion :

- **Flashcards** → FSRS-7 (planificateur de production dans les paramètres d'apprentissage) → écrit dans l'historique des révisions qui entraîne l'optimiseur FSRS.
- **Documents** → un **FSRS-7** modifié (le planificateur *Engaging*, utilisé partout où vous évaluez un document dans l'application ; un planificateur *Incremental* à intervalle fixe est utilisé uniquement comme solution de secours pour l'API/MCP) → suivi séparément, et **n'alimente pas du tout le planificateur de cartes mémoire.**

L'évaluation d'un document utilise les **mêmes quatre boutons** comme une carte mémoire - Encore / Difficile / Bon / Facile - mais la note est attribuée à une instance FSRS ** distincte ** qui n'entraîne pas les algorithmes de votre carte mémoire. L'intervalle qu'il produit dépend du planificateur qui gère la notation :

- ** FSRS-7 engageant (celui utilisé par l'application). ** Lorsque vous évaluez un document de la file d'attente ou de la visionneuse de documents, Plethora exécute FSRS-7 avec un objectif de rétention cible de 0,9, puis applique un multiplicateur *d'engagement* limité (0,25 × – 2,0 ×) pour la nouveauté, la variété et le hasard. Les intervalles sont calculés par FSRS et donc **variables** : ils augmentent avec la stabilité de la double trace du document, tout comme celle d'une carte, et non avec les valeurs fixes ci-dessous. Sur le contenu long que vous ne lisez que partiellement, une limite tenant compte de la durée ramène un intervalle Bon/Facile à 1 à 4 jours en fonction de la quantité de document que vous avez réellement couverte.
- **Planificateur de lecture incrémentielle (la solution de secours).** Le chemin de notation API/MCP simple utilise un planificateur distinct, non FSRS, avec des intervalles courts et **fixes** et un plafond strict de 30 jours :

| Évaluation | Intervalle incrémentiel (de repli) | Intervalle de carte mémoire (varie selon l'algorithme) |
|--------|-----------------------|---------------------------------------------------------|
| **Encore** | ~4 heures | minutes |
| **Dur** | ~1 jour | 1 à 2 jours |
| **Bien** | ~3 jours | jours-semaines |
| **Facile** | ~7 jours | semaines |

Dans le planificateur de secours, les notes consécutives Bon/Facile ajoutent un petit bonus et les notes consécutives Encore/Difficile ajoutent une petite pénalité, et les intervalles sont plafonnés à environ **30 jours** afin que le matériel reste en rotation. (Le chemin Engaging FSRS-7 que vous avez suivi depuis la file d'attente n'a pas de plafond fixe de 30 jours - son seul plafond est celui ci-dessus, tenant compte de la durée.)

**L'engagement affecte à la fois l'ordre et l'espacement.** La couche d'engagement fait deux choses : elle détermine *quel* document apparaîtra ensuite (injection de nouveauté, équilibrage des variétés, hasard) et elle met à l'échelle l'intervalle FSRS-7 dans sa bande 0,25×–2,0×. Il se superpose aux mathématiques FSRS-7 ; il ne le remplace pas.

**Point pratique.** Les révisions de documents s'effectuent via leur **propre** instance FSRS-7 et sont suivies séparément - elles ne forment **pas** l'optimiseur FSRS de flashcard, qui n'apprend que des révisions de flashcard. Si vous souhaitez des poids FSRS personnalisés, vous avez besoin de cartes mémoire examinées à intervalles journaliers.

### Système de notation

Lors des examens, évaluez chaque article en fonction de votre rappel :

| Évaluation | Étiquette | Descriptif | Intervalle typique |
|--------|-------|-------------|------------------|
| **1** | Encore une fois | Panne totale | ~10 minutes |
| **2** | Difficile | Souvenir d'un effort considérable | 1-2 jours |
| **3** | Bon | Souvenir avec réflexion | 5-7 jours |
| **4** | Facile | Le rappel s'est fait sans effort | 10-14 jours |

**Intervalles d'aperçu :**
Avant la notation, Plethora vous indique exactement quand chaque carte apparaîtra ensuite pour les quatre options de notation. Profitez-en pour optimiser votre emploi du temps !

### Types de cartes

#### 1. Flashcards de base
Cartes simples recto/verso

**Recto :** Quelle est la capitale de la France ?
**Retour :** Paris

**Idéal pour :** Faits, définitions, vocabulaire

#### 2. Supprimer la suppression
Style de remplissage

**Texte :** La capitale de la {{France}} est Paris.

**S'affiche comme :** La capitale de _____ est Paris.

**Idéal pour :** Apprentissage contextuel, relations

#### 3. Cartes questions-réponses
Paires de questions et réponses

**Q :** Expliquez la différence entre TCP et UDP.
**R :** TCP est orienté connexion avec une livraison garantie ; UDP est sans connexion sans garantie.

**Idéal pour :** Concepts, explications

#### 4. Occlusion de l'image
Masquer des parties d'une image (schémas, graphiques)

**Idéal pour :** Anatomie, cartes, diagrammes

**Création manuelle :** Passez la souris sur une image dans n'importe quel document et cliquez sur **Créer une carte d'occlusion d'image** pour ouvrir l'éditeur d'occlusion. Dessinez une région en la faisant glisser sur l'image, puis déplacez-la en la faisant glisser à l'intérieur de la région, redimensionnez-la via les poignées de coin, réétiquetez-la dans le panneau de région ou supprimez-la (bouton ou touche Suppr). Vous devez avoir au moins une région à sauvegarder, sinon la sauvegarde est refusée.

**Les propositions de l'IA sont corrigibles :** Lorsque l'IA propose des régions d'occlusion, l'éditeur s'ouvre pré-rempli avec celles-ci. Ajustez, ajoutez ou supprimez des régions avant de sauvegarder ; si le modèle renvoie des régions inutilisables, elles sont fixées à l'image et l'éditeur s'ouvre pour que vous puissiez les dessiner manuellement — une carte avec zéro région utilisable n'est jamais enregistrée silencieusement.

### Création de cartes

#### À partir d'extraits

1. Pendant la lecture, sélectionnez le texte important
2. Cliquez sur **Extraire** pour créer un extrait
3. Dans l'onglet **Extraits**, examinez vos extraits
4. Cliquez sur **Créer une carte** sur n'importe quel extrait
5. Choisissez le type de carte (Flashcard, Cloze, Q&A)
6. Modifier le contenu de la carte
7. Cliquez sur **Enregistrer**

La carte est maintenant programmée pour examen !

#### Création manuelle

1. Cliquez sur **File d'attente** → **Ajouter un élément**
2. Choisissez le type de carte
3. Saisissez le contenu recto/verso
4. Sélectionnez la catégorie
5. Cliquez sur **Créer**

#### Génération basée sur l'IA

Si vous avez configuré l'IA :

1. Sélectionnez un extrait ou une section de document
2. Cliquez sur **Générer des cartes**
3. L'IA créera automatiquement plusieurs cartes
4. Vérifiez et modifiez si nécessaire
5. Enregistrez les meilleurs

---

## Gestionnaire de pont

Le **Deck Manager** est une vue plein écran permettant de parcourir, d'inspecter et de modifier vos jeux de cartes mémoire et leurs cartes. Ouvrez-le à partir du bouton **Deck Manager** sur la page d'accueil de Review.

### Parcourir les decks

- La barre latérale gauche répertorie tous vos decks avec le nombre de cartes et les indicateurs d'échéance aujourd'hui.
- Cliquez sur un deck pour le développer : un seul deck est développé à la fois.
- Les filtres de balises pour chaque deck sont affichés sous forme de petites pilules sous le nom du deck.

### Liste des cartes

Lorsqu'un jeu est développé, ses cartes apparaissent dans une liste virtualisée et déroulante. Chaque rangée de cartes montre :

- **Badge d'État** — code couleur : bleu (Nouveau), orange (Apprentissage), vert (Révision), rouge (Réapprentissage)
- **Aperçu de la question** — jusqu'à 80 caractères
- **Date d'échéance** — étiquette relative (Aujourd'hui, Demain, 5j, en retard)
- **Difficulté** — 1 à 10 mini-barres de progression
- **Intervalle** — intervalle d'examen actuel en jours
- **Nombre de révisions** — combien de fois la carte a été révisée
- **Indicateur de sangsue** — icône d'avertissement jaune pour les cartes avec plus de 5 échecs

### Tri et filtrage

**Triez** les cartes par date d'échéance, état, difficulté, intervalle, nombre de révisions ou échecs. Cliquez à nouveau sur un bouton de tri pour basculer entre ordre croissant/décroissant.

**Filtrer** par :
- **État** – Nouveau, apprentissage, révision, réapprentissage
- **Statut dû** – Dû aujourd'hui, En retard, Non dû

**Recherchez** par texte de question ou par nom de balise à l'aide de la barre de recherche en haut.

### Éditeur de cartes en ligne

Cliquez sur n’importe quelle ligne de carte pour développer un éditeur en ligne en dessous :

- Modifiez directement **question**, **réponse** et **tags** — aucun modal n'est nécessaire.
- Les **Cartes Cloze** affichent le texte Cloze avec les plages de suppression en surbrillance.
- **Les types de cartes complexes** (à choix multiples, occlusion d'image) affichent un aperçu en lecture seule avec un lien "Modifier dans Studio".
- **Suspendre/Annuler la suspension** basculer en un seul clic.
- Les modifications sont enregistrées avec des **mises à jour optimistes** : l'interface utilisateur se met à jour instantanément et est annulée si la sauvegarde échoue.

### Panneau de statistiques de deck

La barre latérale droite affiche les statistiques du deck étendu :

- **Dû aujourd'hui** — nombre de cartes dues maintenant
- **Taux de rétention** — estimé sur la base du taux de déchéance
- **Difficulté moyenne** — sur toutes les cartes du jeu
- **Nombre de sangsues** — cartes avec plus de 5 erreurs (cliquez pour filtrer uniquement les sangsues)
- **Répartition de la maturité** — barre empilée affichant la répartition des cartes Nouveau/Apprentissage/Jeune/Mature
- **Prévisions sur 7 jours** : sparkline affichant le nombre d'échéances projetées pour la semaine prochaine
- **Santé de la mémoire FSRS** — stabilité et difficulté moyennes avec un indicateur de santé à code couleur

### Opérations groupées

Sélectionnez plusieurs cartes à l'aide des cases à cocher, puis utilisez la barre d'outils d'actions groupées :

- **Suspendre / Annuler la suspension** – suspension par lots
- **Supprimer** — supprime les cartes sélectionnées (avec confirmation)
- **Retag** : ajoutez ou supprimez des balises sur toutes les cartes sélectionnées à la fois

### Raccourcis clavier

| Clé | Actions |
|-----|--------|
| `Évasion` | Réduire l'éditeur en ligne ou réduire le deck développé |

---

## Processus de révision

### Démarrage d'une session de révision

1. Cliquez sur **Réviser** dans la barre latérale
2. Voir les cartes dues aujourd'hui (et à venir)
3. Cliquez sur **Démarrer l'examen** pour commencer

### Interface de révision

**Affichage de la carte :**
- Recto de la carte affiché (question ou invite)
- Appuyez sur **Espace** ou cliquez pour afficher la réponse
- La réponse apparaît ci-dessous

**Séances de révision mixtes (fiches + documents) :**
- Les sessions de révision peuvent inclure des **éléments d'apprentissage** et des **documents** qui doivent être lus.
- Lorsqu'un document apparaît, vous pouvez l'ouvrir directement depuis la fiche de session.
- L'évaluation d'un document planifie sa prochaine date de lecture via le planificateur **Engaging FSRS-7** (un FSRS-7 modifié, avec des intervalles courts et favorables à la rotation) — suivi séparément du planificateur de cartes mémoire. Voir [Programmation de lecture de documents](#document-reading-schedule-incremental-reading).

**Interface d'évaluation :**
Après avoir révélé la réponse, quatre boutons d'évaluation apparaissent :

```
[Encore] [Difficile] [Bon] [Facile]
  ~10 min ~2j ~7j ~14j
```

Chaque bouton affiche la **prochaine date de révision** : il s'agit de la fonctionnalité **Intervalle de prévisualisation** !

**Actions de récupération (inspecteur de file d'attente de révision) :**
Utilisez-les lorsque le calendrier d’un élément d’apprentissage nécessite un coup de pouce rapide :

- **Intervalles de compression** : rapprochez la prochaine révision (intervalle plus court).
- **Reprogrammer intelligemment** : déplacez l'élément vers « à rendre maintenant ».
- **Fréquence de rétrogradation** : repoussez la révision suivante (intervalle plus long).

Ces actions s'appliquent aux **éléments d'apprentissage uniquement** et mettent à jour le calendrier immédiatement.

### Raccourcis clavier (mode révision)

| Clé | Actions |
|-----|--------|
| `Espace` | Afficher la réponse |
| '1' | Notez "Encore" |
| '2' | Noter "Difficile" |
| '3' | Noter « Bon » (par défaut recommandé) |
| '4' | Noter "Facile" |
| `Ctrl+Entrée` | Afficher la réponse |
| `Ctrl+1/2/3/4` | Évaluer sans afficher la réponse |
| `Échap` | Pause/fin de session |
| `Ctrl+E` | Modifier la carte actuelle (pas encore implémentée) |
| `Ctrl+D` | Supprimer la carte actuelle (également utilisée globalement pour « Aller au tableau de bord ») |

### Gestion des sessions

**Caractéristiques de la session de révision :**
- **Barre de progression** : affiche les cartes restantes
- **Suivi du temps** : affiche la durée de la session
- **Break Timer** : pauses facultatives toutes les N cartes
- **Limites de session** : définissez le nombre maximum de cartes ou la durée par session

**Fin d'une session :**
- Cliquez sur **Terminer** lorsque vous avez terminé
- Ou définir une limite (Paramètres → Révision → Limites de session)
- Les cartes inachevées restent dues pour la prochaine session

### Stratégies d'examen

#### Routine de révision quotidienne

1. **Séance du matin** (15-30 min)
   - Examiner les cartes à rendre du jour au lendemain
   - Concentrez-vous sur les éléments plus difficiles

2. **Séance du soir** (15-30 min)
   - Cartes de révision ajoutées pendant la journée
   - Créer de nouvelles cartes à partir de la lecture

#### Gestion du backlog

Si vous avez plusieurs cartes à rendre (>100) :

1. **Focus sur les nouvelles cartes** : limiter les révisions à 20-30/jour
2. **Utilisez des filtres** : examinez par catégorie (ne vous submergez pas)
3. **Cram Sessions** : séances de rattrapage du week-end
4. **Ajuster la rétention** : temporairement inférieur à 85 % (moins d'avis)

#### Gérer les cartes "Encore"

Les cartes notées « Encore » réapparaissent rapidement (10 min). Stratégies :

- **Réapprentissage immédiat** : révisez à nouveau les cartes au cours de la même session
- **Session séparée** : révisez à nouveau les cartes plus tard dans la journée
- **Comprendre les problèmes** : Si de nombreuses réponses sont négatives, la carte peut être mal rédigée

---

## Gestion des files d'attente

### Comprendre la file d'attente

La **file d'attente** contient tous les éléments dont la révision est programmée, organisés par :

- **Date d'échéance** : les éléments dus plus tôt apparaissent en premier
- **Priorité** : priorité définie par l'utilisateur (0-100)
- **Catégorie** : Domaine
- **Type de carte** : Flashcard, cloze, etc.

### Vues de la file d'attente

#### Vue due
Affiche les éléments dus aujourd'hui et en retard, triés par heure d'échéance

#### Vue programmée
Affiche tous les éléments planifiés, y compris les révisions futures

#### Nouvelle vue
Affiche les cartes nouvellement créées qui n'ont pas encore été examinées

#### Report automatique
Dans les paramètres d'apprentissage, activez **Report automatique au démarrage de la session** pour reprogrammer les éléments éligibles en retard lorsque Plethora démarre une nouvelle session d'application. Il s'exécute une fois par session, répartit les éléments sur les 30 prochains jours du calendrier local et affiche un résumé non bloquant. L’historique des révisions et l’état de la mémoire sont préservés ; manuel Reporter Tout reste disponible.

### Opérations de file d'attente

**Filtrage :**
- Par catégorie (par exemple, "Afficher uniquement la programmation")
- Par type de carte (par exemple, "Afficher uniquement les cartes Cloze")
- Par plage de priorités (par exemple, "Afficher la priorité 80+")

**Tri :**
- Date d'échéance (par défaut)
- Priorité
- Difficulté
- Aléatoire (pour la variété)

**Actions groupées :**
1. Sélectionnez plusieurs éléments (cases à cocher)
2. Choisissez l'action :
   - **Changer de catégorie** : passer à une autre catégorie
   - **Définir la priorité** : priorité de mise à jour groupée
   - **Suspendre** : masquer temporairement les avis
   - **Supprimer** : Supprimer définitivement

### Lecture d'extraits

Les lignes d'extraction dans la file d'attente ouvrent un **lecteur d'extrait** dédié : le texte de l'extrait est le sujet, et non son document source. Depuis le lecteur, vous pouvez :

- Lire le contenu complet de l'extrait (HTML riche lorsqu'il est conservé, texte brut dans le cas contraire)
- **Évaluez** (Encore / Difficile / Bon / Facile) - la file d'attente se met à jour immédiatement avec le nouveau calendrier, aucun rechargement n'est nécessaire
- **Document open source** pour revenir à la visionneuse de documents sur la carte en surbrillance de l'extrait. Si le document source ne peut plus être chargé, le bouton est désactivé avec une explication
- **Ghost Context Peek (`Alt`-hold)** : maintenez `Alt` (ou cliquez sur le bouton d'aperçu contextuel) pendant la révision d'un extrait pour prévisualiser les paragraphes environnants du document parent sans quitter la file d'attente.
- **Barre de tri de fin d'élément** : au bas d'un extrait, utilisez des actions de tri rapides ("Conserver", "Reporter", "Archiver") pour éliminer les passages terminés ou de faible valeur.

### Modes de session en file d'attente, hygiène et ergonomie mobile

- **Densité Zen vs. Architecte (`Ctrl/Cmd + \`)** : basculez globalement entre le mode **Zen** (surface de lecture/révision propre avec télémétrie de planification masquée) et le mode **Architect** (stabilité FSRS complète, difficulté et télémétrie par intervalles visibles).
- **En-tête de session unifié et pilule de provenance** : basculez entre la commande **Adaptative** et **Manuelle stricte** directement à partir de l'en-tête de session, et cliquez sur la pilule de provenance pour accéder au document source de l'article.
- **Listes de lecture Timebox et anneau d'achèvement** : lancez des sessions limitées (**15 min**, **45 m** ou **10 min Commute**) à partir de la vue Défilement de la file d'attente et suivez la progression avec l'anneau d'achèvement de 0 à 100 %.
- **Triage Compost Sweep** : ouvrez le modal Compost Sweep dans la vue Défilement de file d'attente pour trier rapidement les éléments obsolètes reportés à l'aide de `[J]`, `[K]`, `[L]` et `[Backspace]`.
- **Assistant de refactorisation de sangsue en ligne** : les cartes mémoire avec « 4+ » intervalles affichent automatiquement une bannière de refactorisation proposant ** Diviser en clozes plus simples **, ** Réécrire via l'IA locale ** ou ** Rétrograder vers l'extrait de lecture **.
- **Ergonomie de la file d'attente mobile** : sur les configurations de téléphone, utilisez la bascule **Commute Audio Queue**, le dock **Bottom Thumb-Arc** à une main (`Again`/`Hard`/`Good`/`Easy` et `Boost Priority (-10)`/`Defer (+10)`), et **appuyez deux fois sur n'importe quel paragraphe d'aperçu** pour le capturer directement dans votre boîte de réception de bureau.

### Système de priorité

Chaque document, extrait et carte se trouve quelque part dans une **liste classée unique** : une file d'attente, tous les types d'éléments ensemble. La priorité est ce classement. Définir la priorité sur un élément revient à indiquer à Plethora *où il appartient dans votre collection*, sans lui attacher de score.

**La priorité est une position, pas une étiquette.**

Il s’agit du modèle de file d’attente prioritaire, et c’est la raison pour laquelle les nombres se comportent comme ils le font. Lorsque vous définissez un objet à 70 %, il se déplace jusqu'à 70 % de la hauteur de votre collection, soit au-dessus d'environ 70 % de tout ce que vous possédez, en dessous des 30 % supérieurs. Rien d'autre n'est renuméroté ; l'article s'insère simplement.

Définissez la priorité de 0 à 100 sur n'importe quel élément :

- **90-100** : par-dessus presque tout le reste – la poignée de choses que vous voulez en premier
- **70-80** : Partie supérieure de la collection
- **50-60** : Milieu du pack (valeur par défaut pour les nouveaux matériaux)
- **20-40** : Partie inférieure — lisez-la éventuellement
- **0-10** : bas de la file d'attente — référence, archive, un jour

**Le niveau d'importance de 1 à 5.** Certaines vues affichent également un niveau d'importance compact de **1 à 5** à côté d'un élément. Ce nombre ne représente que votre curseur 0 à 100 % réparti en cinq bandes : **5 est le plus élevé** (la plage de 81 à 100 %), 1 est le plus bas. Ainsi, un document défini à 100 % qui affiche la « priorité 5 » affiche le *haut* de l'échelle, et non la cinquième place. La note de 1 à 5 ne contient aucune information au-delà du curseur ; le curseur lui-même (et la lecture en direct de la *Position X de N*) est toujours la source de vérité.

**Vos pourcentages évoluent d'eux-mêmes, et c'est exact.**

Parce qu'un pourcentage signifie « jusqu'ici dans la collection *en ce moment* », il change à mesure que la collection qui l'entoure change. Importez 500 nouveaux articles et attribuez une note élevée à la moitié d'entre eux, et un ancien document intact affichera un pourcentage inférieur à celui de la semaine dernière - non pas parce que vous l'avez rétrogradé, mais parce que davantage de matériel se trouve désormais au-dessus. Sa place réelle dans votre ordre de lecture reste inchangée par rapport à tout ce qui s'y trouvait déjà.

Un nombre fixe vous mentirait ici : « 70 » dans une collection de 100 articles et « 70 » dans une collection de 10 000 articles prétendraient signifier la même chose tout en décrivant des positions complètement différentes. Le pourcentage vous dit la vérité sur votre collection telle qu’elle existe aujourd’hui.

**Position X de N.**

Ouvrez la fenêtre contextuelle de priorité sur n'importe quel élément et elle affiche son classement en direct sous le curseur — *Position 1* est l'élément le plus important de votre collection, *Position N* le moins. Rouvrez-le après une grosse importation et vous verrez la position bouger. Cette lecture est recherchée à chaque fois que vous l'ouvrez.

**Il n'y a pas deux éléments qui partagent une place.**

Définir plusieurs éléments sur le même pourcentage ne les empile pas en un seul point : chacun est placé juste après le dernier, de sorte que la file d'attente reste dans un ordre strict. Le réglage groupé de 200 documents à 60 % organise les 200 aux alentours de 60 %, dans l'ordre, plutôt que de créer une égalité à 200 que la file d'attente doit rompre arbitrairement plus tard.

**Planification prioritaire :**
Les éléments plus prioritaires sont affichés plus fréquemment dans les avis mitigés. La priorité régit l'*importance* — ce à quoi vous arrivez en premier lorsqu'il y a plus de matériel que de temps. Il est distinct de la planification FSRS, qui régit le *timing* — la prochaine échéance d'un élément donné. Une carte de faible priorité qui est en retard peut toujours apparaître avant une carte de haute priorité qui a été examinée hier.

**Les extraits héritent de leur document.** Un nouvel extrait démarre avec la priorité de son document source, et la modification de la priorité du document s'applique aux extraits toujours à l'ancienne valeur. Une fois que vous avez défini manuellement la priorité d'un extrait, il cesse d'hériter et conserve sa propre place.

### Comportement de classement et de réorganisation des files d'attente

Comprendre comment la file d'attente classe les éléments et pourquoi les positions changent vous aide à optimiser votre flux d'étude :

1. **Planification FSRS et notation dynamique des priorités** :
   - La position de chaque élément est calculée à l'aide de ses paramètres de mémoire FSRS (date d'échéance, intervalle, stabilité, stabilité rapide, décroissance de la récupérabilité) combinés avec votre stratégie de file d'attente intelligente sélectionnée ou votre préréglage de classement adaptatif (*Maximiser la rétention*, *Rattrapage agressif*, *Minimiser le temps*, *Exploratoire*, *Sprint de travail en profondeur*, *Fatigué/Trajet mobile*, *Triage impitoyable* ou *Découverte équilibrée*). Pour les documents, ces paramètres proviennent du planificateur *Engaging* FSRS-7 décrit sous [Document Reading Schedule](#document-reading-schedule-incremental-reading) — donc oui, les valeurs de mémoire FSRS s'appliquent aux documents ainsi qu'aux cartes. La seule différence est que les révisions FSRS d'un document sont suivies séparément et n'entraînent pas le planificateur de cartes mémoire. Voir [Files d'attente intelligentes et classement adaptatif (DAQE)](#smart-queues--adaptive-ranking-daqe) ci-dessous pour plus de détails.
   - Au fur et à mesure que vous effectuez des révisions, reportez des éléments ou prenez des notes, les paramètres de mémoire sont mis à jour et les éléments sont naturellement reclassés lors de leur retour dans la file d'attente.

2. ** Randomisation de sélection pondérée ** :
   - Le moteur d'évaluation applique un algorithme subtil de décroissance pondérée (« caractère aléatoire = 0,3 » par défaut) lors de l'extraction d'éléments du backend. Cela maintient les éléments ayant des priorités similaires en haut tout en introduisant une légère variété pour éviter la fatigue de la file d'attente.

3. **Synchronisation de l'état** :
   - L'exécution d'actions de modification de la file d'attente (telles que l'archivage d'un document, la priorité d'édition en masse ou la modification de balises) déclenche une actualisation en arrière-plan lors du retour à la vue de la file d'attente pour que votre liste reste alignée sur l'état de la base de données principale.
   - Les changements de vue passifs ou les commutateurs d'onglets maintiennent un ordre local stable sans déclencher de remaniements inattendus.


### Examen neuronal (« Devenez neuronal »)

L'examen neuronal est un mode exploratoire facultatif inspiré du concept *Learn : Go neural*. Au lieu de parcourir votre file d'attente prioritaire dans l'ordre, il crée une nouvelle séquence de révision en **diffusant l'activation** à partir d'un seul point de départ - l'élément que vous lisez actuellement - et en faisant apparaître tout ce qui y est connecté. C'est le mode à privilégier lorsque vous souhaitez suivre un fil de discussion dans votre collection plutôt que de parcourir ce qui est dû.

**Comment l'utiliser.** Pendant la lecture en mode défilement, cliquez sur **Devenir neuronal** dans la barre supérieure. La session passe à une file d'attente d'activation de diffusion amorcée au niveau du document, de la carte ou de l'extrait actuel ; la pilule de position devient violette et indique « Examen neuronal · N restant ». Cliquez sur **Quitter** pour revenir exactement là où vous en étiez dans votre lecture : l'examen neuronal ne modifie jamais votre file d'attente prioritaire ou votre planification. Lorsque la file d'attente est faible, elle se remplit automatiquement à partir de l'élément que vous venez de terminer.

**Les flashcards et les extraits nécessitent toujours une note pour avancer**, tout comme en mode défilement normal, donc une session neuronale contribue toujours à la planification. Les documents avancent librement.

**Comment il décide de ce qui est « lié ».** L'activation se propage vers l'extérieur à partir de la graine via cinq types de connexions, dans cet ordre :

1. **Groupes de concepts (balises).** Les éléments partageant une balise avec la graine sont traités comme des pairs conceptuels. Le marquage est donc doublement utile : il regroupe les éléments à rechercher *et* alimente l'examen neuronal. Un élément non balisé n’a aucun concept homologue.
2. **Références inter-éléments.** Liens de références croisées explicites, le cas échéant.
3. **Descendants.** Les enfants de la graine dans l'arbre des connaissances — les extraits et les cartes dans un document, les cartes dans un extrait.
4. **Similarité sémantique.** Lorsque vous avez indexé votre collection pour RAG (Paramètres → Intégrations et RAG → Collection d'index), l'examen neuronal fait également apparaître les documents dont le contenu est similaire à celui de la graine. D'autres documents similaires apparaissent plus tôt. Si vous n’avez pas indexé, cette source reste simplement silencieuse – les quatre autres fonctionnent toujours.
5. **Parent et frères et sœurs.** Le parent de la graine (le document dans lequel réside un extrait) et ses frères et sœurs (autres extraits dans le même document, autres cartes dans le même extrait, plus les documents proches).

Des connexions plus étroites – un enfant direct, un document presque identique, une balise partagée – apparaissent plus tôt dans la file d'attente. Lorsque la première vague produit moins de vingt éléments, l'activation s'étend vers les voisins des éléments nouvellement atteints jusqu'à ce que la file d'attente soit pleine ou que plus rien ne soit accessible.

**Conseils :**
- Marquez les éléments que vous souhaitez explorer ensemble - la balise devient un examen neuronal de groupe conceptuel qui suivra.
- Indexez votre collection pour débloquer la découverte sémantique ; sans cela, l'examen neuronal repose uniquement sur la structure arborescente et les balises.
- L'examen neuronal est en lecture seule par rapport à votre file d'attente normale. Utilisez-le librement ; rien concernant votre commande prioritaire ou les dates d'échéance ne change.


### Files d'attente intelligentes et classement adaptatif (DAQE)

Les files d'attente intelligentes dans Plethora combinent deux systèmes complémentaires : les **files d'attente enregistrées** (qui filtrent *quels* éléments appartiennent à une session d'étude) et le **Classement adaptatif** (alimenté par le moteur de file d'attente dynamique adaptatif, ou **DAQE**, qui calcule l'*ordre* optimal dans lequel les éléments candidats apparaissent).

#### Files d'attente enregistrées (filtrage et portée)

Créez des files d'attente personnalisées en filtrant votre collection par catégorie, type d'élément, note ou plage de priorités :

**Exemples de files d'attente :**
- "Aujourd'hui": cartes dues de la catégorie principale
- "Quick Review" : Cartes faciles, priorité < 50
- "Deep Dive" : Cartes rigides de la catégorie recherche
- "Exam Prep" : Toutes les cartes de la catégorie "Biologie"

**Création d'une file d'attente enregistrée :**
1. Dans la vue **File d'attente**, cliquez sur le menu déroulant **Files d'attente enregistrées** dans l'en-tête (ou cliquez sur **Files d'attente enregistrées** dans la barre d'outils).
2. Cliquez sur **Nouvelle file d'attente...** (ou cliquez sur **Personnaliser la session** et sélectionnez **Enregistrer en tant que nouvelle file d'attente**).
3. Définissez les filtres souhaités (catégories, balises, types d'éléments, seuils de priorité, durée de session).
4. Entrez un nom et enregistrez la file d'attente.

**Changement et gestion des files d'attente enregistrées :**
- Basculez instantanément entre les files d'attente enregistrées à l'aide du sélecteur déroulant **Files d'attente enregistrées** dans l'en-tête de la file d'attente, du bouton de la barre d'outils **Files d'attente enregistrées** ou de la palette de commandes (`Ctrl/Cmd+K` → recherchez votre file d'attente).
- Cliquez sur **Gérer les files d'attente...** dans la liste déroulante pour renommer les files d'attente, supprimer des files d'attente ou définir votre file d'attente par défaut.

---

Choisissez **Manuel strict** dans **Paramètres → Files d'attente intelligentes → Mode de commande des files d'attente** pour trier les éléments éligibles selon leur priorité enregistrée de 0 à 100. Des priorités égales sont classées par instant, puis par type et ID d'élément. Les filtres de file d'attente enregistrée et la composition optimale de la session contrôlent toujours les éléments qui peuvent apparaître. La priorité explicite zéro est la valeur la plus basse. Lorsque la récupération automatique est activée, Strict Manual conserve jusqu'à 50 éléments actifs en attente et protège les priorités de 70 et plus, même si cela dépasse la capacité.

#### Classement adaptatif (moteur de file d'attente adaptatif dynamique)

Tandis que les filtres décident de l'*adhésion* (ce qui entre dans la session), le classement adaptatif décide de l'*ordre* (ce que vous devriez lire maintenant).

Au lieu de classer les éléments uniquement en fonction de leur statut de retard ou d'un numéro de priorité statique, le classement adaptatif évalue les éléments candidats en temps réel en fonction de l'urgence de la mémoire, de l'alignement avec votre objectif d'apprentissage actuel, de l'adéquation de l'énergie cognitive, de l'entrelacement des sujets et des frictions de lecture passées.

> [!IMPORTANT]
> **Le classement adaptatif régit uniquement l'ordre, jamais la planification.**
> Les boutons et les préréglages ne modifient jamais la stabilité, la difficulté, l'intervalle, la récupérabilité ou les dates d'échéance du FSRS. Les planificateurs déterminent toujours *quand* un article doit être retourné ; Le classement adaptatif décide simplement *quel élément dû apparaît en premier* dans votre séance actuelle.

##### La formule de notation composite à 5 termes

À chaque nouveau tri de la file d'attente, DAQE calcule un score composite déterministe $S(i)$ pour chaque élément candidat :

$$S(i) = w_{\text{srs}} \cdot R_{\text{srs}}(i) + w_{\text{goal}} \cdot M_{\text{relevance}}(i) + w_{\text{fit}} \cdot M_{\text{energy\_fit}}(i, K_{\text{energy}}) - w_{\text{interleave}} \cdot P_{\text{interleave}}(i, H_{\text{recent}}) - w_{\text{friction}} \cdot P_{\text{friction}}(i)$$

Chaque terme est normalisé à l'intervalle unitaire $[0, 1]$ avant que son poids ne soit appliqué, empêchant un seul facteur de dominer silencieusement :

1. **L'urgence mémoire ($R_{\text{srs}}$)** est de $0,8T + 0,2P$, où $T$ est l'urgence temporelle et $P$ est le signal de priorité adaptative. Desktop DAQE utilise la priorité de l'élément dans la bibliothèque lorsqu'il est disponible et peut revenir à son curseur enregistré ou à son classement hérité. Le manuel strict utilise la valeur enregistrée de 0 à 100 pour la présentation.
   - La **rotation de lecture** (documents et extraits) utilise la date d'échéance. Les nouveaux articles démarrent avec une urgence neutre. Les éléments futurs n’ont aucune urgence temporelle.
   - **Recall** (flashcards) prend également en compte la récupérabilité estimée du planificateur. Pour une carte due, l’urgence temporelle est plus élevée entre le risque de rappel et l’état de préparation en retard.
   - L'état de préparation en retard augmente progressivement avec les jours écoulés. Quatorze jours est la constante de temps de la courbe. Il n’y a pas de limite au jour 14.
2. **Pertinence de l'objectif ($M_{\text{relevance}}$)** :
   Mesure l'alignement thématique avec votre **objectif de session** actif (par exemple *"Fondements de l'informatique quantique et preuves d'intrication"*). Évalué en trois niveaux :
   - *Niveau 1 (mesuré)* : score continu de 0 à 1 à partir d'un modèle de décision d'IA connecté (`evaluateScore`).
   - *Niveau 2 (Estimé / Par défaut)* : Correspondance de mots-clés lexicaux locaux entre l'objectif et le texte de l'élément lorsqu'aucun modèle de décision n'est actif.
   - *Tier 3 (Tag Affinity)* : mélange de pertinence basé sur des balises lorsqu'aucun objectif n'est spécifié.
   - Absorbe également les *boosts de promotion de cluster* gagnés lorsque vous vous engagez activement avec du matériel connexe dans le même cluster de connaissances. S'il n'existe aucun objectif ou signal, le terme indique clairement *Non mesuré* (0,0).
3. **Energy Fit ($M_{\text{energy\_fit}}$)** :
   Mesure la proximité entre la complexité cognitive d'un élément et votre niveau d'énergie cible $K_{\text{energy}}$ ($1\text{--}5$) :
   $$M_{\text{energy\_fit}} = 1 - \frac{|\text{ItemComplexity}(i) - K_{\text{energy}}|}{4}$$
   La complexité des éléments est classée par le modèle de décision (*Surface Skim* = 1, *Medium Analysis* = 3, *Deep Foundational* = 5) ou par défaut de manière déterministe par type d'élément (Document = 4, Extract = 3, Flashcard = 2).
   *Réduction de la fatigue* : si votre vitesse de lecture au cours des 30 derniers jours tombe en dessous de 40 % de la ligne de base (sur des sessions de 5 $\ge), DAQE déplace automatiquement l'objectif d'énergie efficace vers le bas vers un matériau plus léger pour éviter l'épuisement cognitif.
4. **Pénalité de variété de sujet ($P_{\text{interleave}}$)** :
   Calcule la similarité thématique et sémantique par rapport à la fenêtre de l'historique des révisions récentes ($H_{\text{recent}}$). Une « interleavingDiversity » plus élevée pénalise les éléments partageant des balises ou des concepts avec les éléments que vous venez de consulter, encourageant ainsi la pratique entrelacée. Les éléments sans chevauchement de sujet n’entraînent aucune pénalité.
5. **Pénalité de résistance ($P_{\text{friction}}$)** :
   Accumule des points de résistance grâce aux interactions enregistrées :
   - Reports répétés (+0,10 chacun, plafonnés à 4)
   - Sauts rapides (+0,10 chacun, plafonnés à 4)
   - Avis abandonnés (+0,15 chacun, plafonné à 3)
   - Domination au ralenti (temps d'inactivité dépassant 50 % du temps total sans interaction, contribuant jusqu'à +0,35)
   Les éléments que vous évitez à plusieurs reprises sont doucement rétrogradés, faisant apparaître des opportunités de conservation ou de division. Les articles non mesurés n’entraînent aucune pénalité.

---

##### Les six boutons de classement

Vous pouvez affiner chaque dimension de la formule de classement dans **Paramètres → Files d'attente intelligentes** ou via le modal **Personnaliser la session** :

| Bouton | Gamme | Par défaut | Objectif |
|---|---|---|---|
| **Urgence mémoire** (`srsDecayWeight`) | `0,00`–`1,00` | '0,40' | Dans quelle mesure les éléments en retard et à risque sont-ils tirés vers le haut. |
| **Pertinence de l'objectif** (`goalRelevance`) | `0,00`–`1,00` | '0,30' | Dans quelle mesure les éléments correspondant à votre objectif de session active sont avancés. |
| **Objectif énergétique** (`energyTarget`) | `1`–`5` (entier) | '3' | Votre profondeur cognitive cible (1 = effleurements légers, 5 = sources primaires denses). |
| **Variété du sujet** (`interleavingDiversity`) | `0,00`–`1,00` | '0,20' | Dans quelle mesure les sujets répétitifs sont-ils poussés vers le bas pour promouvoir la variété. |
| **Élagage** (`pruningAgressivité`) | `0,00`–`1,00` | '0,10' | La manière dont les éléments sautés et reportés sont pénalisés de manière agressive. |
| **Délai d'expiration d'absence** (`afkIdleTimeoutMs`) | « 15 » à « 120 » | '45' | Le seuil d'inactivité avant que le suivi en temps réel ne soit mis en pause et marque le temps comme inactif. |

Chaque ajustement du curseur prend effet immédiatement sans nécessiter de bouton « Appliquer ».

---

##### Préréglages organisés

Les préréglages sont des vecteurs préconfigurés des six boutons. Vous pouvez changer de préréglage à partir de la liste déroulante de la barre d'outils File d'attente ou dans Paramètres :

- **Deep Work Sprint** : objectif énergétique « 4 », pertinence de l'objectif « 0,50 », variété du sujet « 0,10 ». Conçu pour une étude ciblée de sources primaires denses avec un changement de sujet minimal.
- **Fatigué / Déplacement mobile** : objectif énergétique « 2 », urgence mémoire « 0,20 », variété de sujet « 0,40 ». Surfaces courtes, à faible friction et sujets variés pour la lecture en déplacement ou les séances à faible consommation d'énergie.
- **Triage impitoyable** : élagage « 0,60 », urgence mémoire « 0,40 ». Place les éléments évités et reportés au premier plan, forçant une décision claire : conserver, diviser en extraits plus petits ou supprimer.
- **Découverte équilibrée** : urgence de la mémoire « 0,35 », pertinence de l'objectif « 0,25 », variété du sujet « 0,25 », élagage « 0,15 », cible énergétique « 3 ». Un équilibre par défaut équitable entre la rétention, les objectifs et la variété.

*Honnêteté de l'attribution* : L'interface utilisateur affiche le nom du préréglage uniquement lorsque vos boutons correspondent exactement à sa définition. Si vous déplacez un curseur, le badge évolue en douceur pour indiquer les paramètres personnalisés.

---

##### Modèles de décision et confidentialité d'abord locale

Adaptive Ranking peut éventuellement se connecter à un modèle de décision d'IA implémentant le protocole d'évaluation léger **System One** (`evaluateScore`, `evaluateChoice`, `evaluateNoul`) :

- **Aucun (Repli local déterministe)** : valeur par défaut. Aucune demande de réseau, aucun coût de jeton, 100 % hors ligne. Utilise la correspondance de mots clés locaux pour les objectifs et les heuristiques de complexité des types d'éléments.
- **Spine** : achemine les évaluations via votre fournisseur d'IA principal configuré dans Paramètres → IA.
- **Laya (Local / On-Device)** : petit modèle Apache 2.0 à poids ouvert (~0,4 B de paramètres par Convai). Fonctionne entièrement sur votre machine via des poids téléchargés ou un serveur local (`http://127.0.0.1:8000`). Les données ne quittent jamais votre appareil.
- **Jev (hébergé)** : modèle de décision spécialisé par TypeSafe AI (jetons d'entrée de 0,042 $/M, jetons de sortie gratuits ; nécessite une clé API).
- **Clef (Cloudflare Workers AI)** : modèle ouvert Apache 2.0 hébergé sur Workers AI (`clef-flash` 9B, `clef` 27B ; nécessite un jeton API Cloudflare et un ID de compte).
- **OpenRouter Decisions** : accès à des modèles de décision tels que `inception/mercury-decide:free` (utilisation gratuite), `liquid/d1` et `upstage/solar-decide`.
- **OpenAI Decisions** : modèles de décision en temps réel OpenAI via l'API Decisions.

> [!ASTUCE]
> **Privacy Gate** : le contenu de l'élément ne quitte jamais votre appareil sans inscription explicite. Même lorsque les modèles distants sont activés, Plethora transmet uniquement les contours structurels non identifiants (squelette de titre, type d'élément, longueur des caractères) - jamais le corps du texte, les surlignages ou les notes de l'utilisateur. Tous les jugements de modèle sont mis en cache localement dans SQLite par hachage de contenu.

---

##### Télémétrie Dwell et boucle d'apprentissage adaptatif

Plethora suit le **temps d'attente actif** plutôt que le temps d'écran passif :
- L'inactivité au-delà du délai d'attente configuré (par exemple 45 secondes) fait passer le suivi à « inactif » et bloque rétroactivement le bloc inactif, empêchant ainsi les feuilles accidentelles de fenêtre de gonfler vos mesures de lecture.
- Accumule des preuves d'interaction telles que les extraits créés, la profondeur de parcours de défilement et les actions de sortie (*extrait-créé*, *élément suivant*, *reporter*, *rejeter*, *re-prioriser*).

La boucle d'apprentissage en arrière-plan utilise cette télémétrie pour s'adapter sans ajustement du modèle :
- **Promotion du cluster** : passer un temps actif soutenu ($\ge 1$ min) à créer des extraits ou des faits saillants favorise la collection de l'élément et le cluster de sujets sémantiques, faisant apparaître plus tôt les connaissances associées.
- **Recommandations de résistance** : un élément ignoré $\ge 3$ fois reçoit une suggestion **Split Candidate** (vous invitant à le décomposer). Un élément avec $>50\%$ de temps d'inactivité et aucune interaction reçoit une recommandation de **Rétrogradation automatique**. Les deux sont des suggestions destinées aux utilisateurs ; ni l’un ni l’autre ne modifie automatiquement vos articles.

---

##### Répartition explicable des scores

Aucun score dans Plethora n’est une boîte noire. Dans la liste de file d'attente ou dans le lecteur :
- Cliquez sur les détails du classement ou sur le badge de position sur n'importe quel élément (ou appuyez sur le menu des lignes sur mobile) pour voir **Pourquoi cette position**.
- Affiche le score composite $S(i)$ à côté de chacun des 5 termes et de leurs poids signés.
- Chaque terme affiche un badge de statut honnête :
  - **MESURÉ** : directement calculé à partir de la télémétrie en direct ou de l'évaluation du modèle de décision.
  - **ESTIMÉ** : Dérivé d'heuristiques déterministes (telles que la complexité du type d'élément).
  - **NON MESURÉ** : Signal d'entrée indisponible ; proprement contribué 0 sans déformer la file d'attente.
- Si une rétrogradation par fatigue s'est produite, l'affichage affiche explicitement votre objectif d'énergie efficace à côté de l'objectif que vous avez initialement défini.

---

##### Gestion des objectifs de session

Pour définir un objectif d'apprentissage temporaire pour un bloc d'étude :
1. Ouvrez la **File d'attente** et cliquez sur **Personnaliser la session** (ou sur l'icône des curseurs).
2. Saisissez votre objectif dans la zone **Objectif de la session** (jusqu'à 200 caractères, par exemple *"Physiologie et hémodynamique cardiovasculaire"*).
3. Vous pouvez également cliquer sur l'un de vos jetons **Objectifs récents** pour réappliquer un objectif précédent.
4. La file d'attente se réorganise instantanément pour faire avancer les documents, extraits et flashcards pertinents.

### Planification basée sur les balises (TAS)

Tag-Aware Scheduling ajoute une intelligence sémantique à la file d'attente de révision.
Lorsqu'il est activé dans Paramètres, TAS applique deux passes de post-traitement
vos éléments dus sans modifier les intervalles SM-20/FSRS sous-jacents :

- **Prerequisite Gating** : bloque les éléments dont les prérequis de balise ne sont pas remplis.
  atteint le seuil d'échéance configuré.  Le matériel de base est
  stabilisé avant l'apparition des sujets avancés.
- **Interference Jitter** : sépare les éléments partageant des balises à haute cohérence
  par une fenêtre de temps minimale, réduisant ainsi les interférences sémantiques lors de la révision.

TAS est **opt-in** et **non destructif** : désactivez-le à tout moment
pour revenir à l'ordre de file d'attente par défaut.  Les articles bloqués ou retardés sont conservés
leurs dates d'échéance et intervalles d'origine.

#### Activation de TAS

1. Ouvrez **Paramètres → Planification basée sur les balises**.
2. Activez **Activer TAS**.
3. Activez/désactivez éventuellement les **Interférences** et les **Prérequis**.
   sous-systèmes indépendamment.
4. Ajustez chaque curseur selon vos préférences.

| Paramètre | Gamme | Par défaut | Descriptif |
|---|---|---|---|
| Séparation minimale | 0–24 heures | 4 heures | Heures entre les éléments partageant une balise à haute cohérence |
| Seuil de cohérence | 0,50-1,00 | 0,75 | Seules les balises avec une cohérence ≥ ceci sont séparées |
| Taux de maturité | 0,50 à 1,00 | 0,70 | Fraction d'éléments dans une balise préalable qui doit être mature |

#### Configuration des prérequis

Les prérequis des balises vous permettent de contrôler l’ordre dans lequel les sujets apparaissent :

1. Ouvrez **Tag Management** (à partir du panneau multimédia ou de la barre d'outils de la bibliothèque).
2. Cliquez sur le bouton **Prérequis** en haut.
3. Cliquez sur un nom de balise pour le sélectionner à modifier.
4. Dans le panneau de l'éditeur, vérifiez les balises qui doivent être apprises **avant**
   les éléments de cette balise peuvent apparaître dans la file d'attente.
5. Cliquez sur **Enregistrer les conditions préalables**.

Le **graphique de dépendance** à droite visualise les relations — flèches
pointer de la condition préalable à la balise dépendante.  Les dépendances circulaires sont
détecté et rejeté au moment de la sauvegarde.

> **Remarque** : Les balises sont automatiquement synchronisées à partir de vos éléments existants.
> Si une balise n'apparaît pas, marquez d'abord certains éléments, puis rouvrez la balise.
> Gestion — TAS les détectera et les enregistrera.

#### Lecture de la file d'attente

Lorsque TAS est actif, l'en-tête de file d'attente affiche un badge **TAS Active**
avec le nombre d'éléments prêts et bloqués.

| Insigne | Moyens |
|---|---|
| 🟡 "En attente de maturité `tag` (45%)" | Bloqué : une balise préalable n'est mature qu'à 45 % |
| 🔵 "Retardé pour éviter les interférences avec `tag`" | Retardé : un élément partageant une balise à haute cohérence a été récemment planifié |

#### Forcer les éléments

Vous pouvez remplacer TAS pour des éléments individuels :

- Cliquez sur le lien **Forcer l'affichage** à côté de tout élément bloqué ou retardé.
  pour l'ajouter immédiatement à la session de révision en cours.
- Le remplacement s'applique uniquement à la session : l'élément est réévalué par rapport au TAS.
  règles lors de la prochaine session.

#### Comment la cohérence est calculée

La cohérence mesure à quel point les éléments d'une balise sont sémantiquement serrés :

1. Utilisez **Compute Semantic Graph** à partir de la vue de file d'attente.  Cela nécessite
   un fournisseur d'intégration configuré (OpenAI, Ollama, Cohere, OpenRouter).
2. Le titre, le contenu et les balises de chaque élément sont envoyés au LLM de votre choix
   fournisseur et un vecteur d'intégration est stocké.
3. Après l'intégration, TAS calcule automatiquement le **centroïde** de chaque balise.
   (vecteur moyen de tous les éléments avec cette balise) et **cohérence** (moyenne
   similarité cosinus par paire de ces éléments).
4. Les valeurs de cohérence apparaissent dans Tag Management à côté de chaque balise.

Les balises sans intégration pour le moment sont traitées comme cohérence = 0 — non
une gigue d’interférence est appliquée à ces balises.

#### Maturité des balises

Une balise est **mature** pour un élément lorsque la stabilité SM-20/FSRS de cet élément
atteint ou dépasse le « maturityThreshold » de la balise (par défaut 0,8).  Le
le ratio de maturité global est « matureCount / itemCount ».

- Les barres de progression dans l'éditeur de prérequis affichent le niveau actuel de chaque balise.
  taux de maturité.
- Le contrôle des prérequis utilise le « maturityRatio » configuré pour décider
  si une balise de prérequis est suffisamment « satisfaite » pour déverrouiller la dépendance
  balises pour examen.

#### Conseils

- **Commencez avec les prérequis uniquement**. Maintenez la gigue d'interférence désactivée jusqu'à ce que
  vous avez exécuté le pipeline d'intégration et avez des valeurs de cohérence.
- **Utilisez des balises granulaires**. `calculus.limits` → `calculus.derivatives` est
  plus efficace qu'une large balise « calcul ».
- **Regardez le taux de blocage**. Si de nombreux articles restent bloqués, réduisez la maturité
  ratio ou simplifier le graphique des prérequis.
- **Force-show est votre soupape de sécurité**. Si le TAS est trop agressif pour un
  élément particulier, forcez-le à l’afficher – aucune donnée de planification sous-jacente n’est endommagée.

---

## Apprentissage des langues

Utilisez Plethora pour apprendre une langue pendant que vous lisez, regardez et révisez. Les fonctionnalités linguistiques fonctionnent sur les documents, les vidéos, la file d'attente et les plans d'étude : vous créez un **profil linguistique**, examinez les mots au fur et à mesure que vous les rencontrez, demandez de l'aide à un **tuteur IA**, entraînez-vous avec **l'observation, la dictée, la prononciation et l'écriture**, et laissez les **témoins de l'apprenant** vous suggérer sur quoi travailler ensuite.

### Activer l'apprentissage des langues

1. Ouvrez **Paramètres → Apprentissage des langues** et activez **Apprentissage des langues**.
2. Ouvrez l'onglet **Apprentissage des langues** et créez un **profil linguistique** : choisissez votre langue cible, votre langue de base et une maîtrise estimée.
3. Configurez un fournisseur d'IA dans Paramètres (cloud ou local) : les modes tuteur, traduction et écriture en ont besoin. Les modes vocaux (observation, dictée, prononciation) nécessitent en outre un fournisseur de reconnaissance vocale (par exemple Groq) et l'autorisation du microphone.

Les profils pilotent tout ci-dessous : le tuteur IA s'adapte à votre vocabulaire et un aperçu du dictionnaire suit votre état de connaissances par mot.

### Aperçu du dictionnaire

Sélectionnez n’importe quel mot ou expression dans un document, une transcription ou une vidéo :

- Le popover **Language Peek** affiche la définition, la traduction, la prononciation et (le cas échéant) un exemple de phrase.
- **Memorize** envoie le mot à **Flashcard Studio** sous forme de brouillon linguistique.
- **Extract** l'enregistre comme extrait d'étude ; **Replay** relit l'audio original lorsqu'un enregistrement aligné existe.

### Tuteur IA

Le tuteur est un assistant conversationnel qui comprend votre niveau et le texte que vous étudiez.

**Démarrage d'une session de tuteur :**
- Dans un document : sélectionnez une phrase, puis choisissez **Tuteur** (ou **Expliquer**) dans le menu de sélection.
- Depuis l'aperçu du dictionnaire : appuyez sur **Expliquer** sur le mot.
- Dans une vidéo : utilisez le bouton **Tuteur** sur la phrase en cours.
- Dans la file d'attente : les extraits vidéo affichent une puce **Ask tutor**.

**Modes :** Expliquer, Jeu de rôle, Réécriture, Grammaire, Prononciation, Collocation, Traduire, Paire minimale, Conversation, Correction et Pratique. Chaque réponse indique comment elle a été produite – **fondée** (à partir de votre matériel source), **générée** ou **générale** – et quel chemin de confidentialité elle a utilisé (local ou cloud ; l'analyse cloud nécessite votre consentement).

**Historique de session :** les réponses terminées du tuteur sont enregistrées dans un panneau local **Historique du tuteur** (les 50 plus récents). À partir de là, vous pouvez **supprimer** une session individuelle, **tout effacer** ou **exporter** l'historique sous forme de fichier JSON. La suppression ou l'exportation n'affecte que votre historique local : les données du fournisseur ne sont jamais modifiées.

**Annulation et nouvelle tentative :** arrêtez une réponse en cours avec **Annuler** ; réexécutez la même requête avec **Réessayer**.

### Modes d'entraînement

L'espace **Pratique** (onglet Apprentissage des langues) propose :

- **Shadowing** — répéter après l'audio natif. La session utilise le clip audio original du texte ou de la vidéo que vous étudiiez lorsqu'il y en a un disponible, et revient à la synthèse vocale dans le cas contraire.
- **Dictée** : écoutez et tapez ce que vous entendez, en utilisant la même plage audio originale.
- **Prononciation** — comparez votre enregistrement avec la prononciation cible.
- **Écriture** : rédigez des réponses et obtenez des corrections.
- **Conversation vocale** — discutez à voix haute avec le tuteur.

Les tentatives apparaissent sous **Tentatives récentes** dans le centre d'entraînement.

### Alignement vidéo et média

Dans une vidéo, chaque phrase possède sa propre ligne de contrôle : **Replay**, **Loop**, **Auto-Pause**, **Translate**, **Mine**, **Tutor** et **Practice**. La relecture préfère l'**audio original** à la position exacte de la phrase ; si l'enregistrement est manquant, obsolète, ambigu ou peu fiable, il revient à la synthèse vocale. **Mine** crée un brouillon de carte mémoire qui conserve la **plage multimédia** du clip, afin que la carte se souvienne exactement d'où elle provient dans la vidéo. Les lancements d'entraînement réutilisent la même plage, de sorte que l'observation et la dictée lisent le bon clip.

### Flashcard Studio

Les brouillons linguistiques arrivent dans Flashcard Studio à partir de **Memorize** (aperçu du dictionnaire), **Mine** (vidéo) et de pratique linguistique. Les brouillons conservent leur **provenance** (le document ou la vidéo source, la plage exacte du média et le profil linguistique) afin que vous puissiez toujours retracer une carte jusqu'à l'endroit où vous l'avez rencontrée.

### Plans d'études

Les plans d’études vont de pair avec l’apprentissage des langues :

1. Lors de la création ou de la modification d'un plan, associez un **profil linguistique** (et définissez éventuellement une compétence cible et une orientation linguistique).
2. Ouvrez le plan et recherchez le panneau **Preuves de l'apprenant**. Il compare les objectifs du plan à vos données d'apprentissage réelles et recommande les prochaines étapes :
   - **Couverture du vocabulaire** — lorsque les termes d'un objectif chevauchent à peine votre vocabulaire connu.
   - **Actualisation des entraînements** — lorsque vous avez accepté peu de tentatives d'entraînement au cours des deux dernières semaines.
   - **Flashcard mining** — lorsque votre collection de flashcards liées à une langue est encore petite.
3. Chaque recommandation comporte un bouton **Ouvrir l'apprentissage des langues** qui permet d'accéder directement à l'onglet Apprentissage des langues.

---

## Plans d'étude et parcours de lecture guidés

Transformez vos livres, articles et relevés de notes en un programme structuré et axé sur les objectifs grâce aux **Plans d'études** et aux **Sentiers de lecture guidée**.

### Vues de file d'attente d'étude, de liste et de graphique

Dans l'onglet **Plan du programme** de n'importe quel plan d'études, basculez entre trois vues complémentaires :

- **File d'attente** : Votre **File d'attente d'étude** étape par étape, mettant en évidence le prochain devoir de lecture recommandé (« Continuer l'apprentissage »), le temps de lecture estimé, les devoirs à venir, les prérequis bloqués et les éléments terminés.
- **Liste** : parcourez et modifiez les nœuds du programme, les objectifs d'apprentissage et les passages de lecture liés.
- **Graphique** : visualisez les dépendances des prérequis entre les sujets dans un graphique de programme interactif.

### Générer et personnaliser un parcours d'étude

1. Ouvrez un plan d'études et sélectionnez la vue **File d'attente** sous **Plan du programme**.
2. Cliquez sur **Générer un parcours d'étude** (ou **Reconstruire un parcours d'étude** après avoir modifié les sources ou les objectifs).
3. Plethora analyse la structure de vos documents sources sélectionnés – en filtrant automatiquement les tables des matières, les bibliographies et les mentions fortuites – et associe chaque objectif d'apprentissage à des segments de lecture cohérents et ordonnés par prérequis.
4. Cliquez sur **Aperçu et modifier le parcours** pour inspecter la provenance du segment, échanger des passages alternatifs, ajuster l'ordre manuel, différer les éléments ou signaler les correspondances non pertinentes.

### Mode de lecture guidée

En cliquant sur **Démarrer la lecture guidée**, vous ouvrez le passage attribué directement dans la visionneuse de documents avec une barre latérale dédiée **Mode de lecture guidée** :

- ** Limites et contexte attribués ** : affiche les marqueurs de début/fin de section, la durée estimée et la raison pour laquelle ce segment a été sélectionné pour l'objectif d'apprentissage.
- **Suivi des progrès** : suit votre progression de lecture dans la plage assignée (vous pouvez continuer à lire au-delà des limites à tout moment).
- **Navigation dans la file d'attente (`Précédent` / `Suivant`)** : passez directement d'un devoir de lecture à l'autre dans votre plan d'étude à l'aide des commandes **Préc** / **Suivant** (ou **Suivant : \<Sujet\>**) sans revenir à l'onglet Plans d'étude.
- **Notes, extraits et tuteur socratique** : capturez des notes/extraits ou ouvrez le panneau **Assistant** persistant (dont les conversations sont enregistrées par document et vidéo) pendant la lecture.

### Contrôles de compréhension à choix multiples

Après avoir terminé un devoir de lecture, cliquez sur **Terminer la lecture → Vérifier la compréhension** pour ouvrir un **Contrôle de compréhension (formatif)** à faibles enjeux :

- **Choix multiple par défaut** : présente une question à choix multiples à 4 options (`A`–`D`) fondée sur le passage que vous venez de lire (générée par l'IA lorsqu'un fournisseur est configuré, avec une solution de repli déterministe hors ligne/sécurité de la confidentialité).
- **Angles de questions flexibles** : basculez entre *Expliquez dans vos propres mots*, *Appliquez à un nouvel exemple*, *Distinguez les idées associées*, *Retracez l'argument*, *Repérez une idée fausse* et *Synthèse fondée sur la source*, ou cliquez sur **Nouvelle question**.
- **Mode écrit facultatif** : cliquez sur **Écrire ma propre réponse** à tout moment si vous préférez saisir une explication libre.
- **Commentaires immédiats et devoir suivant** : la vérification de votre réponse met en évidence l'option correcte, explique le raisonnement et fournit un bouton **Suivant : \<Sujet\>** pour passer directement au devoir de lecture suivant. Les contrôles formatifs ne modifient jamais vos notes d'examen formel ou les intervalles de vos cartes mémoire FSRS.

### Admissibilité aux mesures correctives et aux évaluations ciblées

- **Remédiation ciblée** : les lacunes d'apprentissage non comblées apparaissent automatiquement sous forme d'éléments de remédiation dans votre file d'attente d'étude, renvoyant aux concepts préalables ou au passage pertinent.
- **Éligibilité à l'évaluation** : suivez l'état de préparation aux évaluations formelles du plan d'étude dans le cadre des politiques **Guidée**, **Ouvert** ou **Test-Out**.

---

## Analyses et suivi des progrès

### Présentation du tableau de bord

Le tableau de bord Analytics fournit des informations complètes :

** Pont Horizon et plans d'études d'aujourd'hui : **
- **Jalons descendants** : affiche les plans d'études actifs, les sujets du programme à venir et les évaluations en attente avec un lanceur **Reprendre les jalons** en 1 clic.
- **Découverte organique ascendante** : affiche les révisions FSRS dues et les extraits hautement prioritaires avec un lanceur **Launch Queue Session** en 1 clic.
- **Injecter les concepts faibles dans la file d'attente** : sur n'importe quelle carte d'écart de connaissances, cliquez sur **Injecter les concepts faibles dans la file d'attente** pour générer un extrait de haute urgence ('Priorité 8') et une carte mémoire liée à partir du passage source sous-jacent.

**Mesures clés :**
- **Cartes dues aujourd'hui** : numéro en attente d'examen
- **Total des cartes** : Toutes les cartes du système
- **Taux de rétention** : pourcentage mémorisé
- **Study Streak** : Jours d'activité consécutifs
- **Cartes apprises** : nombre total de cartes créées

### Graphiques d'activité

**Activité de 30 jours :**
- Graphique à barres affichant les avis par jour
- Code couleur par note (Encore/Difficile/Bon/Facile)
- Identifiez les modèles dans vos habitudes d'étude

**Courbe d'apprentissage :**
- Graphique linéaire montrant le nombre total de cartes au fil du temps
- Suivez la croissance de votre base de connaissances

### Statistiques

**Statistiques de révision :**
- Total des examens terminés
- Répartition moyenne des notes
- Avis par jour/semaine/mois

**Statistiques de la carte :**
- Total des cartes par catégorie
- Cartes par type (Flashcard, Cloze, etc.)
- Cartes nouvelles ou matures

**Mesures d'algorithme (FSRS/SM-18) :**
- Stabilité moyenne
- Difficulté moyenne
- Rétention prévue
- Performances de la mémoire

### Répartition des catégories

Afficher les performances par domaine :

- Cartes par catégorie
- Taux de rétention par catégorie
- Niveau d'activité par catégorie
- Identifier les points forts/faibles

### Buts et séquences

**Fixation d'objectifs :**
1. Cliquez sur **Analytics** → **Objectifs**.
2. Fixez des objectifs quotidiens/hebdomadaires :
   - Cartes à revoir
   - Cartes à créer
   - Temps d'étude
3. Suivez les indicateurs visuels de progrès

**Séries d'études :**
- Journées consécutives avec activité
- Série actuelle affichée sur le tableau de bord
- Entretenir des séquences de motivation

### Statistiques d'exportation

Exportez vos données pour analyse :

1. Cliquez sur **Analytics** → **Exporter**.
2. Choisissez le format :
   - **CSV** : compatible avec les feuilles de calcul
   - **JSON** : pour une analyse personnalisée
   - **PDF** : Rapport imprimable
3. Sélectionnez une plage de dates
4. Incluez des métriques (avis, cartes, rétention)

---

## Suivi du sommeil et informations sur l'apprentissage

Connectez votre historique de sommeil, vos rythmes circadiens et votre télémétrie physiologique directement à vos performances d'apprentissage dans l'onglet **Learning Insights** (accessible via l'icône HeartPulse dans la barre d'outils du bureau ou la navigation mobile).

Inspiré du classique SleepChart du Dr Piotr Woźniak dans SuperMemo, Plethora modernise le suivi du sommeil et du rythme circadien en associant des observations objectives du sommeil à la rétention de mémoire à répétition espacée (FSRS-7), aux séances de lecture et à la maîtrise du plan d'étude.

### Tableau de bord et graphique interactif du sommeil

Le **Sleep Chart** visualise votre historique de sommeil et d'études sur une chronologie interactive unifiée sur plusieurs mois :

- **Ancrage de la date de réveil biologique** : les épisodes de sommeil sont ancrés à la date de réveil biologique (fuseau horaire et compatible avec l'heure d'été), garantissant que le sommeil nocturne et les siestes diurnes sont attribués au bon jour cognitif.
- **Étapes du sommeil et siestes** : affiche les étapes détaillées du sommeil (profond, paradoxal, léger et éveillé) ainsi que les siestes diurnes et les interruptions du sommeil.
- **Superpositions de sessions d'étude** : superpose les sessions de révision de cartes mémoire, les sessions de lecture et les tentatives d'évaluation directement sur la chronologie, indiquant exactement le moment où vous avez étudié par rapport à vos blocs de sommeil et à votre phase circadienne.
- **Inspection de la date et résolution des conflits** : cliquez sur n'importe quel jour pour inspecter les mesures détaillées, la répartition des phases de sommeil, la provenance de la source et tout écart multi-appareils.

### Intelligence circadienne et sommeil

Plethora analyse la qualité et le timing du sommeil sans nécessiter d'équipement clinique :

- **Indice de régularité du sommeil (SRI)** : mesure la cohérence quotidienne de votre horaire de sommeil (calculant la probabilité que vous soyez dans le même état : endormi ou éveillé à 24 heures d'intervalle). Une régularité plus élevée est fortement corrélée à des performances cognitives stables.
- **Modèle Borbély à deux processus** : affiche une simulation exploratoire et non clinique de vigilance combinant la pression homéostatique du sommeil (Processus S) et la vigilance circadienne (Processus C) pour mettre en évidence vos périodes naturelles d'apprentissage maximales et vos creux circadiens.
- **Durée du sommeil et dette** : suit les totaux de sommeil glissants par rapport à votre référence pour surveiller la privation aiguë de sommeil et la récupération.
- **Récupération physiologique** : visualise la variabilité de la fréquence cardiaque pendant la nuit (VRC avec suivi RMSSD et SDNN séparés) et la fréquence cardiaque au repos (RHR) pour refléter la récupération et la préparation autonomes.

### Corrélation entre les performances d'apprentissage et la mémoire

Plutôt que de supposer que la corrélation est égale à la causalité, Plethora applique des méthodes statistiques conservatrices pour évaluer l'impact de votre sommeil sur la rétention de la mémoire :

- **Résidus de rappel FSRS-7** : pour chaque examen de carte mémoire, Plethora calcule « observed_recall – predicted_retrievability » chronologiquement avant la notation. Cela isole l’effet physiologique du sommeil de l’âge de la carte et des difficultés inhérentes.
- **Latence de réponse** : analyse la latence du journal winsorisé pour mesurer la vitesse de rappel et l'effort de récupération dans différents états de sommeil.
- **Analyse ajustée en fonction des facteurs de confusion** : contrôles des rythmes circadiens de l'heure de la journée (`sin`/`cos`), de la difficulté de la carte et de la charge de travail d'étude antérieure de 24 heures à l'aide d'une régression multiple intra-personne.
- **Inspecteur de preuves** : cliquez sur **Inspecter les preuves** sur n'importe quel modèle personnel pour inspecter la taille des échantillons, les intervalles de confiance d'amorçage de blocs groupés par jour et le contrôle du taux de fausses découvertes (FDR) de Benjamini-Hochberg. Plethora marque explicitement les associations pour lesquelles les données sont insuffisantes plutôt que de présenter des conclusions prématurées.
- **Carte d'informations sur la santé du plan d'étude** : des résumés de santé intégrés apparaissent dans les vues Progression du plan d'étude et Accueil, montrant comment la régularité et la durée de votre sommeil s'alignent sur les étapes du programme d'études et les performances des examens.

### Sources de données et connexions portables

Plethora prend en charge une gamme complète d'options de collecte de données, du suivi manuel sans appareil portable aux écosystèmes portables multi-appareils :

- **Zéro portable requis (enregistrement manuel)** : cliquez sur **Enregistrer le sommeil** pour enregistrer le sommeil manuellement (heure du coucher, heure de réveil, évaluation de la qualité et étapes facultatives).
- **Échantillons de données interactifs** : cliquez sur **Échantillons de données** pour explorer l'ensemble complet des fonctionnalités à l'aide d'un ensemble de données synthétiques temporaires chargé dans un coffre-fort en mémoire sans modifier vos enregistrements réels.
- **Importation et exportation de fichiers** : importez des dossiers de sommeil et de santé à partir de feuilles de calcul Apple Health (`export.xml`), Plethora Health JSON ou CSV. Exportez vos données au format JSON/CSV standard ou sous forme d'ensemble chiffré protégé par phrase secrète (`.plethora-health.enc` à l'aide de PBKDF2 et AES-256-GCM).
- **Native Mobile Bridges** : sur iOS, connectez **Apple HealthKit** ; sur Android, connectez **Android Health Connect** pour une synchronisation en arrière-plan automatisée et incrémentielle.
- **Cloud Wearable Providers** : connecteurs directs OAuth 2.0 PKCE pour **Oura Ring** (Cloud API v2), **WHOOP** (Developer API v2) et **Google Health** (v4, couvrant Pixel Watch et Fitbit).
- **Priorité source** : lorsque plusieurs appareils enregistrent la même fenêtre de veille (par exemple, Apple Watch et Oura Ring), Plethora déduplique les enregistrements en fonction de la priorité de votre fournisseur préféré configurée dans les paramètres.

### Architecture de confidentialité axée sur le local

Les données de santé sont sensibles et soumises à un strict isolement local :

- **Coffre-fort de santé dédié** : stocké dans une base de données SQLite distincte sur l'appareil (`<app_data_dir>/health/health.db`), physiquement isolée de la base de données de la bibliothèque principale (`plethora.db`).
- **Zero Cloud & AI Egress** : les dossiers de santé ne sont jamais inclus dans les sauvegardes Plethora Cloud, la synchronisation des appareils E2EE, l'indexation de blocs sémantiques ou les contextes d'invite AI/LLM.
- **Suppression sécurisée du coffre-fort** : supprimez des entrées individuelles ou effectuez un effacement complet du coffre-fort avec compactage de la base de données sous **Paramètres → Intégrations → Santé et appareils portables**.

---

## Paramètres et personnalisation

### Paramètres d'apparence

#### Thèmes
- **147 thèmes intégrés** : 26 thèmes modernes et 121 thèmes hérités (sombre et clair)
- **Aperçu en direct** : consultez instantanément les changements de thème
- **Thèmes personnalisés** : créez vos propres combinaisons de couleurs

**Options de thème :**
- Modern Dark (sombre par défaut)
- Matériel vous (Conception matérielle 3)
- Lumière aurore
- Bleu glacier
- Nocturne Dark, Snow, Cartographer, Focus, et bien d'autres...

#### Création de thèmes personnalisés

1. Paramètres → Apparence → Personnaliser le thème
2. Ajustez les couleurs :
   - Couleur primaire
   - Couleur de fond
   - Couleur du texte
   - Couleurs accentuées
3. Enregistrer comme thème personnalisé
4. Exporter/importer des thèmes à partager

#### Options d'affichage
- **Mode dense** : affichez plus de contenu par écran
- **Famille de polices** : choisissez parmi 65 polices intégrées réparties en 5 catégories :
  - Sans empattement (25) : Inter, Poppins, Montserrat, Space Grotesk, et plus
  - Serif (5) : Merriweather, Playfair Display, Lora, Crimson Text, Bitter
  - Monospace (31) : JetBrains Mono, Fira Code, Source Code Pro, et plus
  Affichage (2) : Comic Neue, Major Mono Display
  - Système (4) : interface utilisateur système, système Serif, système Sans, système Mono
- **Taille de police** : Ajustez la taille du texte
- **Animation de carte** : activer/désactiver les animations
- **Afficher les intervalles d'aperçu** : afficher les prochaines dates de révision

### Paramètres d'apprentissage

#### Sélection d'algorithme

Plethora planifie les révisions de cartes mémoire avec **FSRS-7**, l'algorithme de répétition espacée de production. Les paramètres d'apprentissage affichent FSRS-7 comme seul planificateur ; les algorithmes existants (SM-18, SM-20, Plethora Classic) restent compilés pour la recherche et la migration mais sont cachés au sélecteur.

**FSRS-7 (Production) :**
- Modèle de mémoire à double trace (traces de stabilité lentes + rapides)
- Planification fractionnée du temps écoulé pour les révisions le jour même
- Modèle à 34 paramètres avec optimisation personnelle en option
- Notes à quatre boutons avec intervalles de prévisualisation

#### Paramètres

**Rétention souhaitée :** 0,70 - 0,95
- **90 %** (par défaut) : équilibre la rétention et la charge de révision
- **85 %** : moins d'avis, un peu moins de rétention
- **95 %** : Rétention maximale, plus d'avis

**Apprendre par jour :** 10 à 100
- **20** (par défaut) : Gérable pour la plupart des utilisateurs
- **50** : Pour les périodes d'études intensives
- **10** : charge de révision légère

**Révision par jour :** 50 - 500
- **200** (par défaut) : limite quotidienne raisonnable
- **500** : pour éliminer le retard
- **50** : Jours de révision légers

#### Paramètres d'intervalle

**Nouveaux intervalles de carte :**
- Intervalle d'obtention du diplôme (bonne note) : 1 à 10 jours
- Intervalle facile : 3-21 jours
- Intervalle minimum : 1 jour

**Intervalle maximum :**
- Limiter les intervalles les plus longs (365 jours par défaut)
- Empêche les cartes d'être programmées trop loin

**Capuchon de sécurité long (Vidéos/Articles) :**
- Pour les vidéos/articles longs, les notes positives (« Bon »/« Facile ») tiennent compte de la couverture.
- Si vous passez moins de **25 %** de la durée estimée du contenu, l'intervalle suivant est limité à **1 jour**.
- Si vous dépensez moins de **50 %**, l'intervalle suivant est limité à **2 jours**.
- Si vous dépensez moins de **75 %**, l'intervalle suivant est limité à **4 jours**.
- Cela évite que le contenu long soit programmé trop loin après une progression partielle.
- Une fois appliqué, le motif du planificateur inclut une note **Plafond tenant compte de la durée** pour plus de transparence.

### Paramètres de révision

#### Limites de session

**Délai :**
- Durée maximale de la session (minutes)
- Intervalles de pause
- Fin automatique après la limite

**Limites des cartes :**
- Nombre maximum de cartes par session
- Limite séparée pour les nouvelles cartes
- Encore une fois la limite de carte

#### Options de notation

**Raccourcis d'évaluation :**
- Personnaliser les raccourcis clavier
- Définir la note par défaut (touche Espace)
- Activer/désactiver les raccourcis de notation

**Avance automatique :**
- Passage automatique à la carte suivante après la notation
- Délai avant avance automatique (secondes)

### Paramètres généraux

#### Sauvegarde automatique
- Enregistrer l'intervalle (secondes)
- Économisez sur la notation de la carte
- Enregistrer sur le commutateur d'onglet

#### Documents récents
- Max articles récents (5-50)
- Effacer les documents récents

#### Catégorie par défaut
- Définir la catégorie pour les nouveaux éléments
- Peut être remplacé par article

#### Statistiques
- Suivre le temps d'examen
- Suivre le nombre de cartes
- Intervalle de mise à jour (en temps réel ou périodique)

### Paramètres de synchronisation

Plethora synchronise vos données de lecture sur vos appareils via une **salle de synchronisation partagée**. Il n'y a pas de compte, pas de connexion au serveur et pas de clé API : chaque appareil connaissant le même code de synchronisation rejoint la même pièce et partage les mêmes données. C'est le seul système de synchronisation de l'application.

#### Comment ça marche

- Chaque appareil génère un **code de synchronisation** (une chaîne aléatoire) la première fois que vous ouvrez les paramètres de synchronisation.
- Partagez ce code avec vos autres appareils : copiez-le ou scannez le code QR affiché dans les paramètres de synchronisation.
- Lorsque deux appareils partagent un code, leurs données de lecture (documents, extraits, éléments d'apprentissage, historique des révisions, paramètres) se synchronisent automatiquement lorsqu'ils sont en ligne en même temps. Les fichiers joints à vos documents sont synchronisés dans la même pièce.
- Le code de synchronisation est la seule chose qui donne accès à une pièce. Gardez-le privé : toute personne disposant de celui-ci peut lire vos données synchronisées.

#### Connecter vos appareils

1. Ouvrez **Paramètres → Sync** sur votre premier appareil (par exemple un ordinateur de bureau). Notez le code de synchronisation qui y est affiché ou affichez son code QR.
2. Ouvrez **Paramètres → Sync** sur votre deuxième appareil (par exemple votre téléphone).
3. Soit :
   - Appuyez sur **Scan** et pointez l'appareil photo vers le code QR du premier appareil, ou
   - Collez le code de synchronisation dans le champ "Rejoindre un autre code" et appuyez sur **Rejoindre**.
4. Le deuxième appareil rejoint la salle et commence la synchronisation immédiatement – ​​aucun rechargement ni redémarrage n'est nécessaire.
5. Répétez l'opération pour chaque appareil que vous souhaitez synchroniser.

> **Conseil :** Le bouton "Nouveau" génère un nouveau code de synchronisation. Utilisez-le uniquement si vous souhaitez recommencer : les appareils sur l'ancien code cesseront de se synchroniser avec les appareils sur le nouveau.

#### Qu'est-ce qui synchronise

- Les documents et leurs métadonnées
- Extraits (faits saillants et notes)
- Éléments d'apprentissage (flashcards, suppressions de cloze, questions et réponses)
- Examiner l'historique et l'état de planification
- Paramètres de l'application
- Fichiers joints aux documents (PDF, EPUB, etc.)

#### Téléchargement automatique du fichier

Sous **File Sync**, choisissez le degré d'agressivité avec lequel les nouveaux fichiers sont extraits sur chaque appareil :

- **Toujours** : téléchargez automatiquement chaque fichier dès qu'il apparaît dans la pièce.
- **WiFi uniquement** — téléchargement automatique uniquement sur WiFi (utile sur les forfaits de données mobiles).
- **Manuel** — jamais de téléchargement automatique ; chaque fichier affiche un bouton de téléchargement sur lequel vous appuyez quand vous le souhaitez.

#### Chiffrement de bout en bout (facultatif)

La synchronisation s'exécute par défaut en mode « TLS uniquement » : vos données voyagent cryptées sur le réseau et le code de synchronisation agit comme un secret partagé. Si vous souhaitez une protection plus renforcée, vous pouvez activer le **chiffrement de bout en bout**, qui crypte vos données sur votre appareil avant qu'elles ne disparaissent, afin que le serveur de synchronisation ne voie que le texte chiffré.

Lorsque le cryptage est activé, le code QR intègre le secret de votre chambre : partagez-le uniquement avec des appareils de confiance.

#### Confidentialité

Toutes vos données de lecture sont d'abord stockées localement sur vos appareils. La synchronisation est une commodité facultative qui reflète ces données sur vos appareils dans votre salle partagée. Rien n'est envoyé à aucun serveur, à l'exception des fournisseurs d'IA que vous avez personnellement configurés.

#### Sauvegarde et restauration

Plethora fournit un système complet de sauvegarde et de restauration pour protéger vos données d'apprentissage et migrer entre les appareils.

#### Sauvegarde complète de l'application

**Ce qui est sauvegardé :**
- **Paramètres** : Toutes les préférences, thèmes, paramètres d'apprentissage
- **Documents** : tous les documents importés avec métadonnées
- **Extraits** : tous les faits saillants et le contenu extrait
- **Éléments d'apprentissage** : toutes les flashcards, suppressions de cloze, cartes questions-réponses
- **Données de planification** : états de la mémoire de l'algorithme (stabilité, difficulté, intervalles), dates d'échéance
- **Collections** : toutes les collections et affectations de documents
- **État de l'interface utilisateur** : état de la barre latérale, préférences de thème
- **Facultatif** : fichiers de documents réels (PDF, EPUB, etc.)

**Création d'une sauvegarde :**

1. Accédez à **Paramètres → Importer/Exporter → Sauvegarde complète de l'application**
2. Cliquez sur **Ouvrir la sauvegarde et la restauration**
3. Sélectionnez **Exporter la sauvegarde**
4. Ajoutez une étiquette facultative (par exemple, "Avant de reformater le PC")
5. Choisissez si vous souhaitez inclure les fichiers de documents :
   - **Métadonnées uniquement** : fichier plus petit (~ Ko-Mo), réimportez les fichiers séparément
   - **Inclure les fichiers** : fichier plus volumineux (~ Mo-Go), sauvegarde autonome complète
6. Cliquez sur **Exporter la sauvegarde** et enregistrez le fichier `.incrementum`

**Format de fichier :**
- Extension : `.incrementum`
- Format : JSON avec commentaire d'en-tête
- Dénomination : `incrementum-backup-[label]-[date]-[time].incrementum`

**Restauration à partir d'une sauvegarde :**

1. Accédez à **Paramètres → Importer/Exporter → Sauvegarde complète de l'application**
2. Cliquez sur **Ouvrir la sauvegarde et la restauration**
3. Sélectionnez **Importer la sauvegarde**
4. Choisissez votre fichier `.incrementum`
5. Prévisualisez le contenu de la sauvegarde :
   - Nombre de documents
   - Compte d'extraits
   - Nombre d'éléments d'apprentissage
   - Nombre de collectes
   - Si les fichiers sont inclus
6. Configurez les options d'importation (facultatif) :
   - **Ce qu'il faut importer** : choisissez des types de données spécifiques
   - **Gestion des doublons** : ignorer, remplacer ou fusionner
   - **Importer des fichiers** : s'il faut restaurer les fichiers de documents
7. Cliquez sur **Importer la sauvegarde**
8. Attendez la fin de l'importation (progression affichée)

**Stratégies de gestion des doublons :**
- **Ignorer** : ignorer les éléments qui existent déjà (recommandé dans la plupart des cas)
- **Remplacer** : écraser les éléments existants avec des versions de sauvegarde
- **Fusion** : créez de nouvelles copies de tous les éléments (peut créer des doublons)

**Cas d'utilisation :**

| Scénario | Approche recommandée |
|----------|-----------|
| **Migrer vers un nouvel ordinateur** | Exporter avec des fichiers, importer sur une nouvelle machine |
| **Sauvegarde avant les changements majeurs** | Sauvegarde rapide des métadonnées uniquement |
| **Synchronisation entre appareils** | Flux de travail d'exportation/importation |
| **Partager des collections** | Exporter des collections spécifiques |
| **Archiver les anciennes données** | Exporter et stocker à long terme |
| **Restaurer après reformatage** | Importer une sauvegarde complète avec des fichiers |

**Remarques importantes :**
- **Préservation de la planification** : toutes les données de planification (stabilité, difficulté, dates d'échéance) pour tous les types d'algorithmes sont conservées exactement
- **Chemins de fichiers** : lors de l'importation sans fichiers, vous devrez réimporter les documents originaux. Plethora les fera correspondre par hachage de contenu et restaurera les métadonnées
- **Compatibilité des versions** : les sauvegardes sont rétrocompatibles mais peuvent ne pas fonctionner avec les anciennes versions de l'application
- **Stockage** : protégez les sauvegardes : elles contiennent vos données d'apprentissage personnelles

#### Options de sauvegarde héritées

**Sauvegardes automatiques :**
- Fréquence de sauvegarde (quotidienne, hebdomadaire)
- Sauvegardes maximales à conserver (5-50)
- Emplacement de sauvegarde

**Sauvegarde manuelle :**
- Paramètres → Sauvegarde → Créer une sauvegarde
- Choisissez l'emplacement
- Comprend toutes les données et paramètres

**Restaurer :**
- Paramètres → Sauvegarde → Restaurer
- Sélectionnez le fichier de sauvegarde
- Confirmer la restauration (remplace les données actuelles)

### Raccourcis clavier

#### Raccourcis globaux

| Raccourci | Actions |
|--------------|--------|
| `Ctrl+K` | Ouvrir la palette de commandes |
| `Ctrl+P` | Ouvrir la palette de commandes (alternative) |
| `Ctrl+,` | Ouvrir les paramètres |
| `Ctrl+D` | Aller au tableau de bord |
| `Ctrl+Q` | Aller à la file d'attente |
| `Ctrl+R` | Lancer l'évaluation |
| `Ctrl+O` | Ouvrir le document |
| `Ctrl+N` | Document d'importation (alternative) |

#### Personnalisation

1. Paramètres → Raccourcis clavier
2. Sélectionnez l'action à remapper
3. Appuyez sur une nouvelle combinaison de touches
4. Enregistrez les modifications

**Réinitialiser les paramètres par défaut :** Cliquez sur le bouton « Réinitialiser tout »

### Paramètres d'intégration

#### Intégration Anki

**Configuration :**
1. Paramètres → Intégrations → Anki
2. Configurez l'URL AnkiConnect (par défaut : `http://localhost:8765`)
3. Tester la connexion
4. Activer la synchronisation bidirectionnelle

**Options de synchronisation :**
- Synchronisation avec Anki lors de la création de cartes
- Intervalles de synchronisation d'Anki
- Cartographie du deck (catégorie Plethora → deck Anki)
- Synchronisation des balises

#### Intégration d'obsidienne

**Configuration :**
1. Paramètres → Intégrations → Obsidienne
2. Définir le chemin du coffre-fort
3. Configurer le modèle
4. Activer la synchronisation

**Fonctionnalités de synchronisation :**
- Exporter des cartes vers des notes Obsidian
- Importer des notes sous forme de cartes
- Intégration des notes quotidiennes
- Synchronisation des balises bidirectionnelles

#### Intégration NotebookLM

Utilisez NotebookLM dans Plethora pour rechercher, générer des artefacts d'étude et enregistrer des extraits révisables.

**Configuration :**
1. Paramètres → Fonctionnalités → activer **NotebookLM**
2. Paramètres → Intégrations → **NotebookLM**
3. Cliquez sur **Connect** et choisissez le fournisseur (`mock` pour les tests, `cli` pour Live NotebookLM)
4. Sélectionnez ou créez un bloc-notes actif

**Création de cahiers :**
- Cliquez sur **Nouveau bloc-notes** (barre latérale ou état vide) et saisissez un titre dans la boîte de dialogue de l'application.
- Le titre est envoyé à NotebookLM dès le premier clic — aucune deuxième tentative n'est nécessaire
- Pendant la création d'un bloc-notes, le bouton affiche une double flèche et est désactivé ; les échecs font surface comme un toast au lieu de ne rien faire en silence
- La création à partir de l'état vide sélectionne automatiquement le nouveau bloc-notes, de sorte que votre prochaine action s'exécute sur celui-ci.

**Ce que vous pouvez faire :**
- Posez des questions dans le chat NotebookLM directement depuis Plethora
- Exécuter des invites de recherche (recherche de cahiers assistée par Web)
- Générer des artefacts :
  - Cartes mémoire
  - Quiz
  - Rapport (document d'information)
  - Guide d'étude
  - Carte mentale
  - Tableau de données
  - Slide Deck (format : détaillé/présentateur, longueur : par défaut/court)
  - Infographie (options d'orientation, de niveau de détail et de style)
  - Aperçu audio
  - Aperçu vidéo
- Aperçu des artefacts dans l'application :
  - Le texte/les artefacts structurés (rapport, guide d'étude, carte mentale, tableau de données) s'affichent dans des visionneuses dédiées
  - Les aperçus audio et vidéo sont lus en ligne via les lecteurs multimédias de l'application
  - Affichage des infographies sous forme d'images
  - Les présentations de diapositives s'affichent au format PDF
- Synchronisez les flashcards/éléments de quiz générés dans la file d'attente de révision Plethora

**Actions d'artefacts (dans la visionneuse) :**
- **Copier** — copie le contenu de l'artefact dans votre presse-papiers
- **Copier en tant que Markdown** : copie l'exportation Markdown (texte et artefacts structurés)
- **Enregistrer dans la bibliothèque** — importe l'artefact dans la collection actuelle en tant que document ; les artefacts déjà enregistrés signalent qu'au lieu de dupliquer
- **Exporter** — enregistre l'artefact en tant que fichier Markdown via la boîte de dialogue d'enregistrement native (l'exportation JSON/HTML est disponible dans les détails de la tâche Studio)

**Importation d'artefacts dans la bibliothèque :**
- Importation de rapports et de guides d'étude sous forme de documents Markdown, prêts pour la file d'attente et l'extraction
- Les cartes mentales et les tableaux de données sont importés sous forme de documents structurés qui conservent leurs visualiseurs interactifs
- Importation des aperçus audio sous forme d'éléments de style podcast ; Aperçus vidéo sous forme d'éléments vidéo
- Importation de diapositives sous forme de documents PDF ; Les infographies sont importées en tant que documents image et sont également ajoutées au **Registre d'images** (dédupliquées par le contenu, afin que la réenregistrement ne crée pas de doublons).
- Les artefacts importés atterrissent à la racine de la bibliothèque de collection et deviennent éligibles pour la file d'attente aux mêmes conditions que les autres éléments de la bibliothèque.

**Ajout de sources :**
- Ajoutez une **URL**, un lien **YouTube**, un **texte** collé, un **fichier** local ou choisissez un document dans votre **Bibliothèque**.
- Les documents de la bibliothèque sont attachés via le même pipeline d'ingestion et affichent l'état en attente jusqu'à ce que NotebookLM ait fini de les traiter.
- Les documents déjà joints sont détectés afin que vous n'ajoutiez pas de doublons

**Enregistrer les réponses au chat sous forme d'extraits :**
1. Ouvrez le chat de l'espace de travail NotebookLM
2. Sur n'importe quelle réponse de l'assistant, cliquez sur **Enregistrer en tant qu'extrait**.
3. Facultatif : mettez d'abord en surbrillance une partie de la réponse pour enregistrer uniquement le texte sélectionné.
4. Plethora crée un extrait lié à NotebookLM avec des métadonnées thread/source
5. Les réponses enregistrées affichent un indicateur **déjà enregistré** pour éviter les doublons

**Questions et réponses sur les documents + flux de travail NotebookLM :**
1. Ouvrez un document dans Plethora
2. Utilisez **Document Q&A** avec le mode de recherche NotebookLM
3. Modifier/affiner le texte de réponse généré en ligne
4. Créez des extraits de la réponse affinée
5. Générez des flashcards/cloze/éléments de questions-réponses à partir de ces extraits

**Dépannage :**
- Si l'aperçu de l'artefact indique que le média n'est pas disponible, attendez la fin de la génération NotebookLM et rouvrez l'artefact.
- Si une vidéo, un audio, une infographie ou un diaporama ne s'affiche pas, rouvrez l'artefact : la vidéo/l'audio et l'infographie réessayent automatiquement via un autre chemin multimédia ; les diaporamas offrent une option « Ouvrir avec un autre visualiseur » lorsqu'ils ne se chargent pas.
- Si vous utilisez le fournisseur `cli`, assurez-vous que le side-car/CLI NotebookLM est disponible dans votre build.
- Si vous avez changé de fournisseur ou si l'authentification a expiré, reconnectez-vous dans Intégrations → NotebookLM.

#### Mentions de section (`#`)

Tapez « # » dans l'Assistant (ou dans Flashcard Studio) pour mentionner une partie d'un document dans votre question ou invite.

- Les documents avec des titres ou un plan PDF/EPUB répertorient leurs sections, comme auparavant.
- Un article simple importé sans titre obtient un **index de section dérivé** : les paragraphes sont regroupés en segments étiquetés, de sorte que la fenêtre contextuelle n'est jamais vide pour un document contenant du texte lisible.
- Si vous avez du texte **sélectionné** dans le document, votre sélection apparaît comme première entrée — en la choisissant, vous attachez exactement le texte sélectionné comme contexte (tronqué au budget contextuel si nécessaire, avec un avis).
- Si le document ne contient pas de texte extractible, la popup le dit explicitement au lieu d'afficher une liste vide.

#### Intégration de la santé et des wearables

Gérez les connexions portables, la priorité des sources de données et le stockage dans le coffre-fort local :

1. Accédez à **Paramètres → Intégrations → Santé et appareils portables**.
2. **Local Health Vault** : vérifiez la taille de stockage de la base de données, le nombre d'enregistrements et la date de la dernière optimisation.
3. **Connecter les fournisseurs** : connectez les plates-formes natives prises en charge (Apple HealthKit sur iOS, Health Connect sur Android) ou les fournisseurs de cloud (Oura, WHOOP, Google Health).
4. **Priorité de la source** : organisez l'ordre de priorité de vos sources connectées pour contrôler quel fournisseur a la priorité lorsque des données de sommeil qui se chevauchent sont enregistrées.
5. **Transfert de données** : importez des fichiers de santé locaux ou exportez des sauvegardes `.plethora-health.enc` cryptées par phrase secrète.
6. **Wipe Vault** : effacez complètement tous les enregistrements locaux de santé et de sommeil grâce au compactage SQLite automatisé.

#### Serveurs MCP

**Serveurs MCP (Model Context Protocol) :**

Connectez jusqu'à 3 serveurs MCP pour des fonctionnalités basées sur l'IA :

1. Paramètres → AI → Serveurs MCP
2. Ajouter l'URL du serveur
3. Configurer l'authentification
4. Activez les fonctionnalités :
   - Génération de carte à puce
   - Résumé du contenu
   - Aide aux questions et réponses
   - Marquage automatique

### Paramètres IA

#### Fournisseurs d'assurance qualité

Configurez les fournisseurs d'IA pour la génération de cartes :

**Fournisseurs pris en charge :**
-OpenAI (GPT-4, GPT-3.5)
- Anthropique (Claude)
- Ollama (modèles locaux comme Llama, Mistral, Qwen)
- OpenRouter (accès à de nombreux modèles, y compris les niveaux gratuits)
- llama.cpp / vLLM (n'importe quel modèle GGUF via API compatible OpenAI)
- Points de terminaison d'API personnalisés

**Paramètres par fournisseur :**
- Clé API
- Nom du modèle
- Température (créativité)
- Nombre maximum de jetons
- Invite système

#### Apple Intelligence sur l'appareil (Mac et iPhone)

Sur les appareils Apple pris en charge, Plethora peut exécuter de nombreuses fonctionnalités d'IA à l'aide des **Apple Foundation Models** — le modèle de langage intégré à l'appareil d'Apple. Ceci est distinct des fournisseurs de cloud (OpenAI, Ollama, etc.) et **ne nécessite pas de clé API**.

**De quoi s'agit-il :** Génération de texte sur l'appareil pour des tâches telles que le marquage intelligent, la synthèse, la génération de cartes mémoire et les réponses Ask Library.

**Ce que ce n'est pas :** Apple Foundation Models ne transcrit **pas** de vidéos ou d'audio, **ne** lit pas le texte à haute voix (TTS) et **n'analyse pas** les photos. Utilisez les paramètres **Transcription audio** et **TTS** de Plethora pour ces tâches.

**Exigences :**
- **Mac :** macOS 26 ou version ultérieure, Apple Silicon, Apple Intelligence activés dans les paramètres système
- **iPhone / iPad :** iOS 26 ou version ultérieure, compatible Apple Intelligence, appareil compatible

**Comment l'activer :**
1. Ouvrez **Paramètres → Paramètres du fournisseur d'IA**
2. Faites défiler jusqu'à **IA sur l'appareil**
3. Activez ** Préférer l'IA sur l'appareil **
4. Vérifiez que **Foundation Models** (ou **Apple Intelligence**) affiche **Prêt**.

Lorsqu'il est prêt, Plethora utilise automatiquement l'IA Apple sur l'appareil pour les tâches prises en charge. Vous n'ajoutez pas Apple à la liste des fournisseurs de cloud.

**Ce que vous pouvez faire avec l'IA Apple intégrée à l'appareil :**

| Fonctionnalité | Fonctionne sur l'appareil ? |
|---------|------------------|
| Marquage intelligent | Oui |
| Résumer/expliquer un passage | Oui |
| Demandez à la bibliothèque (réponses de votre bibliothèque) | Oui |
| Générer des flashcards à partir de texte | Oui |
| Extraire les points clés, étudier les questions | Oui |
| Conseils pour l'évaluation du studio | Oui |
| Transcrire des vidéos ou des livres audio | Non : utilisez **Paramètres → Transcription audio** |
| Lire le texte à haute voix (TTS) | Non : utilisez **Paramètres → Synthèse vocale** |
| Décrire les images / OCR | Non : utilisez les fonctionnalités OCR ou de vision |

**Confidentialité :**
- Le traitement reste **sur votre appareil** par défaut
- **Autoriser le repli sur le cloud** est désactivé par défaut : si l'IA sur l'appareil ne peut pas terminer une tâche, Plethora n'enverra **pas** silencieusement votre contenu à un fournisseur de cloud payant.
- Vous pouvez activer le repli sur le cloud si vous souhaitez que Plethora réessaye avec votre fournisseur de cloud configuré lorsque l'IA sur l'appareil n'est pas disponible

**Si l'état n'est pas Prêt :**

| Statut | Qu'est-ce que cela signifie | Quoi essayer |
|--------|---------------|-------------|
| Prêt | L'IA sur l'appareil est disponible | Commencez à utiliser les fonctionnalités de l'IA normalement |
| Téléchargement… | Le modèle système est toujours en cours d'installation | Attendez, puis appuyez sur **Actualiser** dans IA sur appareil |
| Désactivé | Apple Intelligence est éteint | Activer Apple Intelligence dans les paramètres système |
| Non éligible | L'appareil ou la région ne le prend pas en charge | Utilisez plutôt un fournisseur cloud ou local |
| Système d'exploitation non pris en charge | macOS/iOS inférieur à la version 26 | Mettez à jour votre système ou utilisez un autre fournisseur |

**Conseil :** Les documents longs sont traités automatiquement : Plethora les divise en morceaux qui correspondent à la fenêtre contextuelle de l'appareil, puis combine les résultats. Vous n'avez pas besoin de configurer cela.

#### IA Windows sur l'appareil (Windows 11)

Sur le bureau Windows, Plethora peut exécuter des tâches d'IA **sur votre PC** sans envoyer le contenu de votre bibliothèque à OpenAI, Anthropic ou à d'autres API cloud que vous configurez séparément. Windows propose deux chemins complémentaires sur l'appareil :

1. **System On-Device AI** — API Windows AI intégrées pour les tâches de texte et l'OCR lorsque votre PC et la version de Windows les prennent en charge
2. **Foundry Local** — un serveur local compatible OpenAI en option que vous installez vous-même (fonctionne sur de nombreux GPU, y compris le matériel sans NPU Copilot+)

Ces chemins sont distincts de ceux des fournisseurs de cloud et **n'utilisez pas votre clé API OpenAI**, sauf si vous activez la solution de secours vers le cloud.

**De quoi s'agit-il :** Génération de texte sur l'appareil pour le balisage intelligent, la synthèse de passages, les idées de cartes mémoire, les réponses à la bibliothèque et les raccourcis de flux de travail, ainsi que **l'OCR du système Windows** pour les PDF et les images numérisés lorsqu'il est activé sous **Paramètres → Documents → OCR**.

**Ce qu'il n'est pas :** L'IA du système sur l'appareil ne transcrit **pas** l'audio ou la vidéo (utilisez **Paramètres → Transcription audio**), ne lit **pas** le texte à haute voix (utilisez **Paramètres → Synthèse vocale**) et ne **pas** s'exécute sur tous les PC Windows. Les fonctionnalités Copilot+ NPU (Phi Silica text AI et Windows System OCR) nécessitent du matériel et les versions Windows de nombreux PC de jeu ne sont pas satisfaites – **Foundry Local**, **Tesseract** ou un fournisseur de cloud restent les options pratiques.

**Exigences :**
- **Windows 11 version 24H2 ou ultérieure** (build 26100+) pour les vérifications de l'état de l'IA du système sur l'appareil
- **Identité du package** enregistrée lors de l'installation (le programme d'installation Windows de Plethora enregistre automatiquement une identité MSIX clairsemée ; si l'enregistrement échoue, l'IA du système sur l'appareil reste inactive)
- **Matériel de classe Copilot+/NPU** pour le modèle de langage Phi Silica de Microsoft — de nombreux GPU discrets (par exemple les anciennes cartes GeForce) ne peuvent pas utiliser l'IA textuelle de niveau 1 même lorsque Foundry Local fonctionne bien
- **Foundry Local :** tout PC Windows sur lequel vous installez et activez le runtime Foundry Local

**Comment l'activer :**
1. Ouvrez **Paramètres → Paramètres du fournisseur d'IA**
2. Faites défiler jusqu'à **IA sur l'appareil**
3. Activez ** Préférer l'IA sur l'appareil **
4. Examinez les lignes d'état **System On-Device AI** et **Foundry Local**.

Lorsque ** Préférer l'IA sur l'appareil ** est activé, Plethora essaie d'abord l'IA système sur l'appareil sous Windows, puis Foundry Local si activé, avant votre fournisseur de cloud configuré - à moins que ** Autoriser le repli sur le cloud ** soit désactivé, auquel cas les échecs restent sur l'appareil.

**Ce que vous pouvez faire :**

| Fonctionnalité | IA du système sur l'appareil | Fonderie locale |
|---------|-----------|---------------|
| Marquage intelligent | Quand prêt | Lorsque l'exécution + le modèle sont prêts |
| Résumer/expliquer un passage | Quand prêt | Quand prêt |
| Demandez à la bibliothèque | Quand prêt | Quand prêt |
| Générer des flashcards à partir de texte | Quand prêt | Quand prêt |
| OCR à l'importation / PDF (OCR système Windows) | Quand l'OCR est prêt | Non : utilisez Tesseract ou cloud OCR |
| Transcrire de l'audio ou de la vidéo | Non | Non |
| Lire le texte à haute voix (TTS) | Non | Non |

**Documents → OCR :** Lorsque **Windows System OCR** ​​apparaît dans **Paramètres → Documents → OCR**, sélectionnez-le directement ou activez **Préférer l'OCR du système Windows** pour l'utiliser automatiquement pour l'importation et l'OCR PDF lorsqu'il est disponible. Il utilise la même pile Windows AI que ci-dessus et revient à Tesseract ou au fournisseur OCR de votre choix en cas d'indisponibilité.

**Confidentialité :**
- **Préférer l'IA sur l'appareil** achemine d'abord les tâches prises en charge vers les backends sur l'appareil
- **Autoriser le repli sur le cloud** est désactivé par défaut — Plethora n'enverra **pas** silencieusement le contenu de votre bibliothèque aux API cloud payantes en cas d'échec de l'IA sur l'appareil.
- Foundry Local conserve l'inférence sur votre machine ; seul votre point de terminaison local configuré est contacté

**Si l'état n'est pas Prêt :**

| Statut | Qu'est-ce que cela signifie | Quoi essayer |
|--------|---------------|-------------|
| Disponible / Prêt | La fonctionnalité est prête | Utiliser les fonctionnalités de l'IA normalement ; ouvrez **Diagnostics** si quelque chose échoue toujours |
| Téléchargeable / Téléchargement | Le modèle Windows AI n'est pas encore installé | Attendez la mise à jour Windows ou l'installation du modèle, puis appuyez sur **Actualiser** |
| Identité du package manquante | MSIX clairsemé non enregistré | Réinstaller ou réparer Plethora ; vérifier les chemins MSIX clairsemés dans **Diagnostics** |
| Accès limité refusé | Phi Silica a besoin d'un déverrouillage Microsoft LAF | Configuration avancée uniquement ; non requis pour Foundry Local |
| Matériel non pris en charge | Le PC ne dispose pas du NPU requis pour cette fonctionnalité Windows AI | Activez **Foundry Local**, utilisez un fournisseur de cloud ou utilisez Tesseract pour OCR |
| Système d'exploitation non pris en charge | Windows construit en dessous de 24H2 | Mettez à jour Windows ou utilisez Foundry Local/cloud |

Ouvrez **Paramètres → IA sur l'appareil → Diagnostics** sous Windows pour connaître l'identité du package, la disponibilité du pont, l'état de préparation OCR et l'état du point de terminaison Foundry Local.

**Conseil :** Sur un PC de jeu doté d'un GPU puissant mais pas de NPU Copilot+, **Foundry Local** est généralement la voie réaliste de l'IA sur l'appareil. L’état de l’IA du système sur l’appareil est toujours utile pour comprendre pourquoi Phi Silica ou l’OCR du système Windows ne sont pas disponibles sur votre matériel.

#### Génération automatique

**Génération de carte :**
- Activer la génération automatique à partir d'extraits
- Nombre de cartes par extrait
- Seuil de qualité
- Exiger une approbation manuelle

**Résumé :**
- Résumer automatiquement de longs extraits
- Longueur du résumé (court, moyen, long)
- Inclure dans le contenu de la carte

#### Fenêtre contextuelle

**Limites des jetons :**
- Max jetons par demande (longueur de réponse)
- Contexte des cartes associées
- Longueur de l'extrait de document

**Modèles locaux (Ollama) :**
- **La fenêtre contextuelle** est la taille du cache KV d'exécution envoyée sous la forme `num_ctx` (combien d'invite + de réponse peuvent contenir). Commencez à 8K-16K ; des valeurs plus élevées utilisent plus de GPU/RAM.
- **Le nombre maximum de jetons de réponse** est un plafond distinct sur la longueur générée (`num_predict`). Ce n'est pas la fenêtre contextuelle.
- Résolution automatique à une valeur pratique comprise entre 4K et 16K – jamais le maximum théorique du modèle.
- Les fournisseurs de cloud utilisent toujours uniquement le paramètre de réponse maximale pour la longueur de sortie.

---

## Fonctionnalités avancées

### Graphique de connaissances

Visualisez les liens entre vos connaissances :

**Vue graphique 2D :**
- Nœuds : Documents, extraits, fiches
- Bords : Relations (même catégorie, tags, références)
- Disposition dirigée par la force
- Navigation interactive

**Sphère de connaissances 3D :**
- Visualisation 3D immersive
- Rotation, zoom, panoramique
- Code couleur par catégorie
- Cliquez sur les nœuds pour afficher le contenu

**Caractéristiques :**
- Rechercher et filtrer
- Mettre en surbrillance les éléments associés
- Exporter sous forme d'image
- Identifier les lacunes dans les connaissances
- **Modes Heatmap** : basculez entre **Par défaut**, **Récupération / Sangsue** (cramoisi pour les sangsues avec « 4+ » intervalles, ambre pour une faible récupérabilité, émeraude pour un rappel sain) et **Densité d'extrait** (coloré par le nombre d'extraits non traités).
- **`Shift+Drag` Lasso-to-Queue** : maintenez `Shift` et faites glisser une zone de sélection sur les nœuds du canevas 2D pour les sélectionner et **Lancer Cram** ou **Créer une évaluation ciblée** à partir de la barre d'action flottante.

### Lecteur RSS

Apprenez de vos flux préférés :

#### Répertoire des newsletters

Découvrez et abonnez-vous aux newsletters populaires directement dans Plethora :

**Accédez au répertoire des newsletters :**
1. Cliquez sur l'onglet **RSS**
2. Cliquez sur l'**icône Newsletter** (📬) dans l'en-tête.
3. Parcourez les newsletters organisées par catégorie

**Catégories de newsletter :**
- **Technologie** : Actualités technologiques, programmation, IA
- **Science** : Recherche, découvertes, connaissances scientifiques
- **Finance** : Investissements, marchés, finances personnelles
- **Business** : Entrepreneuriat, stratégie, création d'entreprise
- **Santé** : Bien-être, médecine, mode de vie sain
- **Lifestyle** : Culture, voyages, gastronomie, développement personnel
- **Politique** : Politique, gouvernance, actualité
- **Arts et littérature** : livres, art, musique, écriture créative
- **Éducation** : apprentissage, enseignement, connaissances académiques
- **Crypto & Web3** : Blockchain, DeFi, actualités cryptomonnaies

**Abonnement aux newsletters :**
1. Parcourez l'annuaire ou recherchez une newsletter
2. Cliquez sur **S'abonner** sur n'importe quelle newsletter
3. Le flux est automatiquement ajouté à vos abonnements RSS
4. De nouveaux numéros apparaîtront dans votre lecteur RSS

**Découverte du flux de newsletter :**

Plethora peut découvrir automatiquement les flux RSS des plateformes de newsletter populaires :

- **Substack** : ajoutez `/feed` à n'importe quelle URL de sous-pile
  - Exemple : `https://author.substack.com` → `https://author.substack.com/feed`
- **Beehiiv** : découvre automatiquement le point de terminaison `/feed`
- **Blogs fantômes** : découverte automatique du point de terminaison `/rss/`
- **Buttondown** : Ajoutez `/feed` à l'URL de la newsletter
- **Générique** : découvre automatiquement les flux RSS à partir des balises HTML `<link>`

**Abonnez-vous rapidement à partir de l'URL :**
1. Copiez n'importe quelle URL de newsletter
2. Cliquez sur **Ajouter un flux** dans l'onglet RSS
3. Collez l'URL
4. Plethora découvre automatiquement le flux RSS
5. Cliquez sur **Ajouter un flux** pour vous abonner

**Recherche des flux RSS de la newsletter :**

La plupart des plateformes de newsletter publient des flux RSS :

| Plateforme | Modèle de flux RSS | Exemple |
|--------------|--------|---------|
| Sous-pile | `https://[auteur].substack.com/feed` | `https://stratechery.substack.com/feed` |
| Beehiiv | `https://[newsletter].beehiiv.com/feed` | `https://banklesshq.beehiiv.com/feed` |
| Fantôme | `https://[blog].ghost.io/rss/` | `https://blog.ghost.io/rss/` |
| Boutonnée | `https://buttondown.email/[nom]/feed` | `https://buttondown.email/newsletter/feed` |

**Plateformes prises en charge :**
- Sous-pile (la plupart des newsletters)
- Beehiiv
- Blogs fantômes
- Boutonné
- ConvertKit
-Revue
- Publications moyennes
- Sites WordPress (génériques)

**Abonnements à la newsletter d'importation/exportation :**
- **OPML Import** : Importer depuis d'autres lecteurs RSS
- **Export OPML** : sauvegardez vos abonnements à la newsletter
- Partager des abonnements entre appareils

#### Gestion des flux

1. Cliquez sur l'onglet **RSS**
2. Cliquez sur **Ajouter un flux**
3. Saisissez l'URL du flux
4. Définir l'intervalle de mise à jour
5. Activer l'importation automatique dans la file d'attente

**Fonctionnalités du flux :**
- Sondage automatique pour les nouveaux articles
- Importer des articles sous forme de documents
- Extraire automatiquement les points clés
- Créer des cartes à partir de flux

**Flux recommandés :**
- Sites d'information (BBC, CNN, etc.)
- Blogs dans votre domaine
- Revues de recherche
- Actualité technologique (Hacker News, Ars Technica)

### Intégration YouTube

**Importation vidéo :**
1. Copiez l'URL de YouTube
2. Importer en tant que document
3. Plethora récupère :
   - Métadonnées vidéo
   - Transcription (si disponible)
   - Informations sur le chapitre
   - Commentaires (facultatif)

**Caractéristiques de la transcription :**
- Transcription complète consultable
- Créer des extraits de transcription
- Synchroniser la transcription avec la vidéo
- Créer des cartes avec des horodatages

**Panneau de fonctionnalités vidéo :**
- Ouvrez le bouton **Panneaux** dans la visionneuse vidéo
- Onglets pour les signets, les chapitres, la transcription
- Les signets enregistrent les horodatages pour des sauts rapides
- Les chapitres peuvent être récupérés sur YouTube

**Extraits vidéo :**
1. Ouvrez les **Panneaux** → **Extraits vidéo**.
2. Cliquez sur **Nouveau**
3. Définissez le début/la fin, un titre et un texte de transcription facultatif
4. Choisissez **Ajouter à la file d'attente de révision** pour rendre le clip immédiatement éligible, ou choisissez
   **Commencez à réviser** à une date ultérieure pour le garder hors de la file d'attente d'ici là.
5. Enregistrez pour créer un clip réutilisable

Un extrait enregistré apparaît immédiatement dans le panneau Extraits de la vidéo source et dans
l'onglet **Extraits** de la barre d'outils. Son statut indique **Nouveau**, **Vu · Non évalué**,
ou **Révisé**, et indique s'il est dans la file d'attente. L'ouverture d'un élément de file d'attente cherche à
le segment et le marque Vu uniquement après confirmation de la lecture ; évaluer le
l'extrait modifie uniquement le calendrier de cet extrait. **Supprimer de la file d'attente** conserve le
le clip enregistré et son historique de révision, et **Review now** effectue une planification ultérieure
clip éligible immédiatement.

**Intégration SponsorBlock :**
- Saute automatiquement les segments sponsorisés dans les vidéos YouTube, les vidéos locales et les livres audio,
  en utilisant les données soumises par la communauté depuis sponsor.ajay.app
- Activé par défaut ; un segment ignoré affiche une notification nommant sa catégorie,
  avec un **Undo** qui revient au début du segment

**Configuration de SponsorBlock :** [Paramètres] → [Intégrations] → **SponsorBlock**
- **Activer SponsorBlock** — lorsqu'il est désactivé, aucune donnée de segment n'est demandée et
  la lecture n'est jamais déplacée d'elle-même
- **Passer automatiquement** — lorsqu'il est désactivé, les segments sont toujours chargés et affichés, mais
  la lecture n'est pas déplacée
- **Afficher les notifications de saut**
- **Mode de confidentialité** — n'envoie pas de données de visualisation au service
- **Catégories à ignorer** — seules les catégories cochées entraînent un saut
- **Réutiliser les données de segment pendant (heures)** : durée pendant laquelle une liste de segments récupérée est réutilisée
  pour la même vidéo ; réglez-le sur 0 pour récupérer à chaque lecture

Ces paramètres s'appliquent à la lecture. Les pré-coupes téléchargées utilisent toujours SponsorBlock
ensemble complet de catégories par défaut.

**Suivi des progrès :**
- Reprendre de la dernière position
- Marquer les sections regardées
- Regarder l'historique

### Transcription vidéo locale (application de bureau)

Générez des transcriptions pour les fichiers vidéo locaux dans l'application de bureau Tauri.

1. Ouvrez une vidéo locale
2. Ouvrez les **Panels** → **Transcription**.
3. Choisissez un modèle et une langue
4. Cliquez sur **Générer une transcription**

**Extraction de tranche vidéo en premier lieu :**
- Mettez en surbrillance n'importe quelle étendue sur un ou plusieurs segments de transcription dans YouTube ou des transcriptions vidéo locales pour révéler **Capture Video Slice `[mm:ss - mm:ss]`**, créant ainsi un extrait vidéo horodaté directement dans votre file d'attente.

**Lecture instantanée de médias locaux et streaming HLS :**
- Les fichiers audio/vidéo locaux et les flux HLS commencent à être lus immédiatement via des demandes de plage de streaming sans attendre la mise en mémoire tampon complète du fichier.

### TTS PiP persistant et voix de rôle (`MiniAudioPlayer`)

- **PiP pliable en bas à droite** : réduisez la barre audio en une pilule flottante compacte pendant la lecture ou la révision.
- **Waveform Scrub & Speed ​​(`1.0x–2.5x`)** : cliquez n'importe où sur la barre de forme d'onde pour rechercher et faire défiler la vitesse de lecture entre `1.0x`, `1.25x`, `1.5x`, `2.0x` et `2.5x`.
- **Voix de rôle et carillon de transition** : distingue la narration **Extrait** des invites **Q&A/Résumé** avec un carillon de transition subtil et des identifiants vocaux séparés.
- **`[B]` Bookmark Last 30s** : appuyez sur `B` (en dehors des saisies de texte) ou cliquez sur **[B] 30s** pour capturer les 30 dernières secondes de la transcription orale sous forme d'extrait de signet audio.

Remarques :
- La transcription s'exécute localement sur votre machine
- Nécessite un chemin de fichier local (non disponible pour les vidéos Web uniquement)

### Transcription de livres audio (application de bureau)

Créez des transcriptions pour les livres audio afin de permettre la sélection et la synchronisation du texte.

1. Importez un livre audio
2. Ouvrez la visionneuse de livres audio
3. Cliquez sur **Démarrer la transcription locale**
4. Surveillez les progrès et ouvrez le panneau de transcription

Remarques :
- La transcription s'exécute localement sur votre machine
- Les modèles sont gérés dans **Paramètres → Transcription audio**

### OCR (reconnaissance optique de caractères)

Extraire le texte des images :

**Fournisseurs pris en charge :**
- Mirage Vision Engine (Local) — indexation visuelle pour l'ingestion de documents, l'occlusion d'images, la recherche FTS5 et les clips du navigateur
- GLM-OCR (Local) — OCR multimodal via llama.cpp ou vLLM
- Tesseract (local)
- Google Cloud Vision
- Texte AWS
- Vision par ordinateur Azure
- Marqueur (local) — PDF vers Markdown
- Nougat (Local) — documents scientifiques avec mathématiques

**Cas d'utilisation :**
- Capture d'écran
- Documents numérisés
- Images avec texte
- Notes manuscrites

**Configuration (fournisseurs cloud) :**
1. Paramètres → ROC
2. Choisissez le fournisseur (Google, AWS ou Azure)
3. Configurez la clé API et les informations d'identification
4. Sélectionnez la ou les langues
5. Testez avec un exemple d’image

**Configuration (GLM-OCR avec lama.cpp) :**

llama.cpp fournit un serveur LLM local léger pour GLM-OCR sans nécessiter de GPU. Il utilise l'API compatible OpenAI sur le port 8080.

1. **Construisez llama.cpp** (s'il n'est pas déjà construit) :
   ```bash
   clone git https://github.com/ggml-org/llama.cpp.git
   cd lama.cpp
   cmake -B construire
   cmake --build build --config Release -j$(nproc)
   ```

2. **Télécharger un modèle multimodal** (format GGUF) :
   ```bash
   # Qwen2.5-VL (recommandé pour l'OCR)
   huggingface-cli télécharger bartowski/Qwen2.5-VL-7B-Instruct-GGUF \
     Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf --local-dir models/
   ```

3. **Démarrez le serveur** :
   ```bash
   ./build/bin/llama-server \
     -m modèles/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf \
     --port 8080 --host 0.0.0.0 -c 16384 -t $(nproc)
   ```

4. **Configurer dans Plethora** :
   - Paramètres → OCR → Fournisseur : **GLM-OCR (Local)**
   - Backend : **vLLM (GPU)** (c'est le mode llama.cpp/vLLM — fonctionne pour les deux)
   - Point de terminaison : `http://localhost:8080/v1`
   - Modèle : votre nom de fichier de modèle (par exemple, `Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf`)

**Conseils de performances :**
- Utilisez `-c 16384` ou supérieur pour les documents longs (4096 par défaut est trop petit pour la plupart des tâches OCR)
- Use `-t $(nproc)` to use all CPU threads
- La quantification Q4_K_M offre le meilleur compromis qualité/vitesse pour l'inférence CPU
- Pour l'accélération GPU, créez llama.cpp avec le support CUDA, Metal ou Vulkan

**Setup (GLM-OCR with vLLM):**

vLLM fournit une inférence accélérée par GPU pour les modèles plus grands. Nécessite un GPU NVIDIA avec suffisamment de VRAM.

```bash
pip install -U vllm
vllm serve zai-org/GLM-OCR --allowed-local-media-path / --port 8080
```

Configurez ensuite Plethora de la même manière (point de terminaison `http://localhost:8080/v1`).

**Setup (GLM-OCR with Ollama):**

L'option la plus simple pour démarrer : Ollama gère automatiquement les téléchargements et l'exécution des modèles.

1. Paramètres → OCR → Fournisseur : **GLM-OCR (Local)**
2. Backend: **Ollama (CPU)**
3. Click **Download Ollama** (if not installed)
4. Click **Start Runtime**
5. Set model (e.g., `llava:7b` or `qwen2-vl:7b`)
6. Cliquez sur **Tirer le modèle**

**OCR mathématique :**
- Specialized handling for equations
- Sortie LaTeX
- Reconnaissance des symboles
- Best for: Scientific papers, textbooks

### Palette de commandes

Quick access to all commands:

**Open:** `Ctrl+K` (or `Cmd+K` on Mac)

**Caractéristiques :**
- Recherche floue
- Navigation au clavier
- Commandes récemment utilisées
- Search by name or shortcut
- Les résultats de la recherche accèdent à l'emplacement correspondant dans les documents et mettent en surbrillance la requête (PDF, EPUB, Web Imports)
- Les correspondances de transcription YouTube recherchent l'horodatage et démarrent la lecture
- Survolez le résultat d'un document pour voir des correspondances supplémentaires du même document

**Commandes communes :**
- "Importer un document"
- "Démarrer la révision"
- "Créer une carte"
- "Ouvrir les paramètres"
- "Exporter des données"
- "Basculer le mode densité Zen / Architecte" (`Ctrl/Cmd + \`)
- "Queue Ordering: Adaptive / Strict Manual"
- "Ouvrir Docked Q&A Creator" (`Ctrl/Cmd + Shift + Q`)
- "Cloze enchaîné de la sélection"
- "Thème du cycle"

### Mode Vimium

Navigation au clavier de style Vim pour les utilisateurs expérimentés :

**Activer :** Paramètres → Raccourcis clavier → Activer Vimium

**Navigation :**
- `j` / `k` : Défiler vers le bas/vers le haut
- `h` / `l` : Défilement vers la gauche/droite
- `gg` : Aller en haut
- `G` : Aller en bas
- `/` : Recherche
- `n` / `N` : résultat de recherche suivant/précédent

**Actions :**
- `f`: Link hints (clickable elements)
- `i` : entrez en mode de saisie
- `Escape` : Quitter le mode de saisie

**Personnalisation :**
- Remapper les clés
- Créer des commandes personnalisées
- Partager les configurations de raccourcis clavier

### Recherche et filtrage

Recherche avancée sur tout le contenu :

**Recherche en texte intégral :**
- Rechercher le contenu de la carte, les extraits, les documents
- Opérateurs booléens (ET, OU, NON)
- Recherche d'expression ("expression exacte")
- Caractères génériques (carte*)

**Filtres de recherche :**
- `category:programming` : Recherche dans la catégorie
- `tag:urgent` : Recherche par tag
- `type:cloze` : Recherche par type de carte
- `due:today` : recherche des cartes dues
- `rating:again` : recherche par note

**Recherches enregistrées :**
1. Effectuer une recherche
2. Cliquez sur « Enregistrer la recherche »
3. Nommez et enregistrez
4. Accès depuis le menu déroulant de recherche

### Extension du navigateur

Connectez Plethora à la navigation Web :

**Caractéristiques :**
- Mettre en surbrillance des pages Web
- Créer des extraits d'articles
- Synchronisation avec l'application de bureau
- Ajout rapide à la file d'attente
- Avis basés sur un navigateur

**Configuration :**
1. Installer l'extension (Chrome/Firefox)
2. Associez-le à l'application de bureau
3. Accorder des autorisations
4. Commencez à utiliser !

**Utilisation :**
- Sélectionnez le texte sur la page Web
- Cliquez sur l'icône d'extension
- Choisissez "Ajouter à Pléthore"
- Se synchronise automatiquement

---

## Conseils et bonnes pratiques

### Création de cartes

**FAIRE :**
- Rendre les cartes spécifiques (un fait par carte)
- Utiliser un langage simple et clair
- Inclure le contexte dans les réponses
- Ajouter des exemples pertinents
- Utilisez Cloze pour les relations
- Gardez les questions concises

**À NE PAS FAIRE :**
- Mettez plusieurs faits sur une seule carte
- Utiliser des termes vagues
- Posez des questions trop faciles ou trop difficiles
- Copier de gros blocs de texte
- Utiliser des abréviations sans définition

**Exemple – Mauvaise carte :**
```
Q : Quelle est la fonction des mitochondries et comment
est-ce lié à la production d'ATP dans la respiration cellulaire ?
R : [Explication du paragraphe]
```

**Exemple – Bonnes cartes :**
```
Carte 1 :
Q : Quelle est la fonction principale des mitochondries ?
A : Produire de l'ATP par la respiration cellulaire

Carte 2 :
Q : Quel processus les mitochondries utilisent-elles pour produire de l’ATP ?
A : Respiration cellulaire (aérobie)

Carte 3 :
Q : Quelle est la monnaie énergétique produite par les mitochondries ?
A : ATP (adénosine triphosphate)
```

### Programme d'étude

**Horaire quotidien (20-30 min) :**
1. **Matin** : Révision des cartes dues (15 min)
2. **Tout au long de la journée** : créez des extraits de lecture
3. **Soirée** : Créez des cartes à partir d'extraits (10-15 min)

**Horaire hebdomadaire :**
- **Lun-Ven** : révisions régulières et création de cartes
- **Samedi** : séances d'étude plus longues (1-2 heures)
- **Dimanche** : examinez les analyses, ajustez les objectifs, organisez

**Gestion de gros volumes :**
- Définir une limite de révision quotidienne (par exemple, 50 cartes)
- Prioriser par catégorie (se concentrer sur un sujet)
- Utilisez des files d'attente intelligentes pour répartir les tâches
- Faites des pauses toutes les 20-30 minutes

### Optimisation de la rétention

**Améliorer le taux de rétention :**
- Évaluez honnêtement (ne gonflez pas les notes)
- Révisez de manière cohérente (quotidiennement, c'est mieux)
- Dormez suffisamment (la mémoire se consolide pendant le sommeil)
- Rappel actif (ne regardez pas, réfléchissez d'abord)
- Revues espacées (ne pas bourrer)

**Faire face à l'oubli :**
- Normal d'oublier 10-20 % (en fonction de la rétention cible)
- Les cartes "Encore" sont des opportunités d'apprentissage
- En cas d'oubli fréquent (>30 %), pensez à :
  - Diminution de la rétention souhaitée (85-90%)
  - Création de cartes plus simples
  - Ajout de plus de contexte
  - Réviser plus fréquemment

### Organisation de la catégorie

**Meilleures pratiques :**
- Commencez large, puis subdivisez
- Exemple : `Programmation` → `Programmation/Python` → `Programmation/Python/Async`
- Utiliser une dénomination cohérente
- N'en créez pas trop (5-10 est gérable)
- Fusionner les catégories inutilisées

**Exemple de structure de catégorie :**
```
├── Programmation
│ ├── Python
│ ├── Rouille
│ └── Algorithmes
├── Langues
Espagnol
│ └── Japonais
├── Sciences
│ ├── Physique
│ └── Biologie
└── Professionnel
    ├── Gestion de projet
    └── Conception du système
```

### Gestion des priorités

**Directives prioritaires :**
- **100 (Critique)** : Préparation aux examens, projets de travail urgents
- **80-90 (Élevé)** : Cours actuels, apprentissage actif
- **60-70 (Moyen)** : Intérêts continus, connaissances générales
- **40-50 (Bas)** : Agréable à savoir, supplémentaire
- **0-20 (Archive)** : référence uniquement, rarement examiné

**Planification prioritaire :**
- Concentrez-vous sur la priorité 80+ pour les examens quotidiens
- Révisez 60-70 tous les quelques jours
- Révision 40-50 par semaine
- Révision 0-20 mensuellement ou à la demande

### Utilisation des intervalles d'aperçu

La fonction **Intervalle de prévisualisation** vous indique exactement quand chaque carte apparaîtra ensuite pour les quatre évaluations.

**Comment utiliser :**
1. Lisez la carte
2. Vérifiez les intervalles d'aperçu sous les boutons d'évaluation
3. Choisissez la note en fonction de :
   - Votre rappel actuel
   - Dans combien de temps tu veux le revoir
   - Votre emploi du temps (par exemple, examen à venir)

**Exemple de stratégie :**
- Examen dans 2 semaines : Notez « Facile » sur les cartes importantes pour les revoir prochainement
- Journée chargée : notez "Bon" ou "Facile" pour espacer les avis
- Vous voulez maîtriser : notez "Difficile" pour réviser plus fréquemment

### Gérer le dépassement de soi

**Trop de cartes dues ?**
1. Définir la limite de révision (Paramètres → Révision → Max par jour)
2. Concentrez-vous sur les éléments hautement prioritaires
3. Suspendre temporairement les catégories peu prioritaires
4. Envisagez de réduire légèrement la rétention souhaitée

**Trop de contenu à traiter ?**
1. Importez les documents progressivement
2. Extrayez uniquement les points clés (pas tout)
3. Créez des cartes de manière sélective
4. Utilisez des catégories pour organiser

**Burn-out ?**
1. Faites une pause (c'est bon !)
2. Réduisez les limites quotidiennes
3. Suspendre les catégories non critiques
4. Concentrez-vous sur une catégorie à la fois

---

## Dépannage

### Problèmes courants

#### Les cartes n'apparaissent pas dans la révision

**Causes possibles :**
- Toutes les cartes examinées pour aujourd'hui
- Cartes suspendues
- Filtrer les cartes masquées actives

**Solutions :**
1. Vérifiez le nombre de « échéances » dans l'onglet Révision.
2. Vérifier la file d'attente → Assurez-vous que les cartes ne sont pas suspendues
3. Effacer les filtres
4. Vérifiez la date de révision (peut-être les cartes prévues pour le futur)

#### Mauvais taux de rétention

**Symptômes :** Oubli de nombreuses cartes, évaluations fréquentes « Encore »

**Solutions :**
1. **Évaluer la qualité des cartes** : Les cartes sont-elles claires ? Un fait par carte ?
2. **Rétention souhaitée inférieure** : essayez 85 % au lieu de 90 %
3. **Révisez plus fréquemment** : critiques quotidiennes, pas de bourrage
4. **Ajouter un contexte** : plus d'informations dans les réponses
5. **Simplifier les cartes** : divisez les cartes complexes en cartes plus simples

#### Conflits de synchronisation

**Symptômes :** Cartes en double, incohérences de données après la synchronisation

**Solutions :**
1. Choisissez la stratégie de résolution des conflits (Paramètres → Sync)
   - **Gains locaux** : conservez vos modifications
   - **Gagnements à distance** : Acceptez les modifications du serveur
   - **Demander** : résoudre manuellement chaque conflit
2. Synchronisez régulièrement pour minimiser les conflits
3. Utilisez un appareil principal

#### Échecs de l'importation

**Symptômes :** L'importation de documents échoue ou contient des erreurs

**Solutions :**
1. **Vérifiez le format du fichier** : assurez-vous que le format est pris en charge (PDF, EPUB, etc.)
2. **Vérifier la taille du fichier** : les fichiers très volumineux peuvent expirer
3. **Vérifiez l'URL** : certains sites bloquent l'accès automatisé
4. **Vérifiez Internet** : l'importation d'URL nécessite une connexion
5. **Essayez une alternative** : utilisez le copier-coller pour le contenu Web

#### Problèmes de performances

**Symptômes :** Chargement lent, décalage, blocage

**Solutions :**
1. **Grande base de données** : Archivez les anciennes cartes (Paramètres → Données → Archiver)
2. **Beaucoup d'images** : les images ralentissent le chargement
3. **Ressources système** : fermez les autres applications
4. **Reconstruire la base de données** : Paramètres → Données → Reconstruire (dernier recours)

#### L'OCR ne fonctionne pas

**Symptômes :** L'OCR échoue ou produit des résultats médiocres

**Solutions :**
1. **Vérifiez la clé API** : valide et dispose de crédits (fournisseurs de cloud)
2. **Vérifiez la qualité de l'image** : les images claires et haute résolution fonctionnent mieux
3. **Vérifier la langue** : Corriger la langue sélectionnée
4. **Essayez un fournisseur alternatif** : certains fonctionnent mieux pour certains contenus
5. **OCR local** : utilisez Tesseract en cas de problèmes Internet

#### lama.cpp ne répond pas

**Symptômes :** "Erreur d'appel de LLM" ou connexion refusée à localhost :8080

**Solutions :**
1. **Vérifiez si le serveur est en cours d'exécution** : `curl http://localhost:8080/v1/models`
2. **Démarrez le serveur** : voir [Configuration OCR](#ocr-optical-character-recognition) ci-dessus
3. **Taille du contexte trop petite** : redémarrez avec `-c 16384` ou supérieur
4. **Port utilisé** : un autre processus utilise peut-être le port 8080 ; vérifiez avec `lsof -i :8080`
5. **Mémoire insuffisante** : utilisez une quantification plus petite (Q3_K_M au lieu de Q4_K_M) ou un modèle plus petit

#### Ollama ne démarre pas

**Symptômes :** L'exécution de GLM-OCR Ollama ne démarre pas

**Solutions :**
1. **Installez Ollama** : utilisez le bouton Télécharger dans Paramètres → OCR, ou installez depuis ollama.com
2. **Vérifiez le chemin binaire** : définissez le chemin binaire Ollama s'il n'est pas à l'emplacement par défaut
3. **Autorisations Linux** : vous aurez peut-être besoin de « sudo » pour installer ou exécuter le service Ollama

#### Windows : "L'application n'a pas pu démarrer car sa configuration côte à côte est incorrecte"

**Symptômes :** Sous Windows, `plethora-tauri.exe` (ou `pdf-reflow-diag.exe`) n'ouvre jamais de fenêtre. Au lieu de cela, vous obtenez une boîte de dialogue indiquant que la configuration côte à côte de l'application est incorrecte et suggère « sxstrace.exe ». Rien n'est écrit dans les propres journaux de Plethora, car le processus est arrêté **avant l'exécution de tout code d'application**.

**Confirmation :** Ouvrez l'Observateur d'événements → Journaux Windows → Application et recherchez « SideBySide », ID d'événement 62, avec un message tel que :

```
La génération du contexte d'activation a échoué pour "...\plethora-tauri.exe".
Erreur dans le fichier manifeste ou de stratégie "...\plethora-tauri.exe" sur la ligne 1.
L'attribut obligatoire « packageName » est absent de l'élément « msix ».
```

```powershell
Get-WinEvent -LogName Application -MaxEvents 300 |
  Où-Object { $_.ProviderName -eq 'SideBySide' } |
  Select-Object -First 3 TimeCreated, Id, Message | Liste de formats
```

**Cause :** Le **manifeste d'application intégré** de l'exécutable n'est pas conforme au schéma du manifeste, donc le générateur de contexte d'activation côte à côte de Windows rejette l'intégralité du manifeste à la ligne 1 et abandonne la création du processus. Il s'agit d'un défaut d'emballage dans la version que vous avez installée, et non d'un problème avec votre PC. Il est corrigé à partir de Plethora 3.3.1 pour le programme d'installation de Windows.

**Solutions :**
1. **Installez la version actuelle de Plethora pour Windows** : téléchargez le dernier programme d'installation et installez-le par-dessus la copie existante. Sur une installation 3.3.0 cassée, l'application ne peut pas démarrer du tout, elle ne peut donc pas se mettre à jour — l'étape de téléchargement et de réinstallation est requise, et votre bibliothèque et vos paramètres sont conservés.
2. **Confirmez ce que vous avez installé** (facultatif, nécessite les outils de ligne de commande du SDK Windows) : extrayez le manifeste et examinez l'élément `<msix>` :
   ```
   mt.exe -inputresource:"C:\Path\To\plethora-tauri.exe";#1 -out:%TEMP%\plethora.manifest
   ```
   Un manifeste sain contient un seul élément `<msix ... />` vide avec les attributs `packageName`, `publisher` et `applicationId`.
3. **Ne pas** réinstaller le redistribuable Microsoft Visual C++, exécuter `sfc /scannow` ou réenregistrer les DLL. L'échec se produit avant le chargement d'une DLL et la seule dépendance du manifeste est l'assembly Microsoft Common Controls qui fait partie de Windows. Ces étapes ne peuvent pas modifier le résultat et le texte d’erreur ne les indique pas.

**Remarques :**
- L'identité du package (fonctionnalités Windows AI) n'est disponible que lorsque le package d'identité fourni avec le programme d'installation peut être enregistré, ce qui nécessite qu'il soit signé par un certificat auquel votre machine fait déjà confiance. S'il ne peut pas être enregistré, Plethora fonctionne normalement et seules les fonctionnalités Windows AI dépendant des identités restent désactivées - Paramètres → L'IA sur l'appareil montre pourquoi.
- Sous Windows 10 2004 et versions ultérieures, c'est le même élément manifeste qui accorde cette identité ; sur les systèmes plus anciens, l'application s'exécute sans lui.

### Obtenir de l'aide

**Ressources :**
- **Documentation** : consultez le dossier `docs/` pour des guides détaillés
- **Problèmes GitHub** : signaler les bugs et les demandes de fonctionnalités
- **Communauté** : rejoignez les discussions, posez des questions
- **Raccourcis clavier** : appuyez sur « ? » dans l'application pour une référence rapide

**Mode débogage :**
Activez la journalisation du débogage (Paramètres → Avancé → Mode débogage) pour résoudre les problèmes.

**Exportation de données :**
Exportez vos données avant les changements majeurs (Paramètres → Sauvegarde → Exporter)

### Récupération

**Suppression accidentelle :**
1. Vérifiez les sauvegardes (Paramètres → Sauvegarde)
2. Restaurer à partir d'une sauvegarde récente
3. Contactez le support si aucune sauvegarde n'est disponible

**Base de données corrompue :**
1. Exportez les données immédiatement
2. Reconstruire la base de données (Paramètres → Données → Reconstruire)
3. Importer les données exportées
4. Vérifiez toutes les données présentes

**Progrès perdu :**
1. Vérifiez Analytics → Exporter pour les données historiques
2. Restaurer à partir d'une sauvegarde si nécessaire
3. Synchronisez avec le fournisseur de cloud si activé

---

## Glossaire

**Extrait** : élément de contenu extrait d'un document, matériel de carte potentiel

**Élément d'apprentissage** : tout élément à apprendre (flashcard, cloze, questions-réponses, etc.)

**File d'attente** : tous les éléments dont l'examen est programmé, organisés par priorité

**Séance de révision** : une période de rappel actif et de cartes d'évaluation

**FSRS** : Planificateur de répétitions espacées libres ; FSRS-7 est la version de production actuelle avec un modèle de mémoire à double trace (traces de stabilité lentes et rapides)

**Stabilité (rapide)** : la trace rapide dans le modèle à double trace de FSRS-7 ; associé à la stabilité pour la récupérabilité

**Intervalle** : délai entre les examens (par exemple, 7 jours)

**Stabilité** : durée d'une mémoire (métrique FSRS)

**Difficulté** : la difficulté d'un élément pour vous, sur une échelle de 1 à 10 (métrique FSRS)

**Récupérabilité** : probabilité actuelle de rappel, 0 à 100 % (métrique FSRS)

**Rétention souhaitée** : taux de rétention cible (généralement 90 %)

**Intervalle de prévisualisation** : fonctionnalité affichant la prochaine date de révision pour chaque option de notation

**Cloze** : type de carte à remplir

**Suspendre** : masquer temporairement l'article des avis

**Catégorie** : Domaine de l'organisation

**Tag** : étiquette personnalisée pour une organisation intercatégorielle

**Priorité** : importance définie par l'utilisateur (0 - 100)

---

## Référence des raccourcis clavier

### Raccourcis globaux

| Raccourci | Actions |
|--------------|--------|
| `Ctrl/Cmd + K` | Ouvrir la palette de commandes |
| `Ctrl/Cmd + P` | Ouvrir la palette de commandes (alternative) |
| `Ctrl/Cmd + ,` | Ouvrir les paramètres |
| `Ctrl/Cmd + D` | Aller au tableau de bord |
| `Ctrl/Cmd + Q` | Aller à la file d'attente |
| `Ctrl/Cmd + R` | Lancer l'évaluation |
| `Ctrl/Cmd + O` | Ouvrir le document |
| `Ctrl/Cmd + N` | Document d'importation (alternative) |
| `Ctrl/Cmd + +` | Augmenter le zoom de l'interface (bureau, 70 à 150 %) |
| `Ctrl/Cmd + -` | Diminuer le zoom de l'interface (bureau, 70 à 150 %) |
| `Ctrl/Cmd + 0` | Réinitialiser le zoom de l'interface à 100 % (bureau) |
| `Ctrl/Cmd + \` | Basculer le mode de densité de l'interface utilisateur Zen / Architect |
| `Ctrl/Cmd + /` | Afficher les raccourcis clavier |
| `?` | Afficher les raccourcis clavier (pas de modificateur) |

### Raccourcis du mode Révision

| Raccourci | Actions |
|--------------|--------|
| `Espace` | Afficher la réponse |
| '1' | Notez "Encore" |
| '2' | Noter "Difficile" |
| '3' | Noter « Bon » |
| '4' | Noter "Facile" |
| `Ctrl/Cmd + Entrée` | Afficher la réponse (alternative) |
| `Ctrl/Cmd + 1/2/3/4` | Évaluer sans afficher la réponse |
| `Échap` | Fin de séance |
| `Ctrl/Cmd + E` | Modifier la carte actuelle (pas encore implémentée) |
| `Ctrl/Cmd + D` | Supprimer la carte actuelle (également utilisée globalement pour « Aller au tableau de bord ») |
| `Ctrl/Cmd + S` | Suspendre la carte |
| `Ctrl/Cmd + H` | Historique de la carte |

### Raccourcis de file d'attente

| Raccourci | Actions |
|--------------|--------|
| `Ctrl/Cmd + F` | Recherche ciblée |
| `Ctrl/Cmd + A` | Tout sélectionner |
| `Supprimer` | Supprimer la sélection |
| `Ctrl/Cmd + Clic` | Sélection multiple |
| `Maj + Clic` | Sélection de plage |

### Raccourcis de la visionneuse de documents

| Raccourci | Actions |
|--------------|--------|
| `Ctrl/Cmd + F` | Rechercher dans le document |
| `Ctrl/Cmd + C` | Copier le texte sélectionné |
| `Ctrl/Cmd + E` | Créer un extrait de la sélection |
| `Ctrl/Cmd + H` | Sélection des surbrillance |
| `Ctrl/Cmd + Maj + Q` | Activer/désactiver le créateur de questions-réponses fractionnées ancré |
| `Ctrl/Cmd + J` | Basculer le fil de discussion sur la marge socratique ancré dans la sélection |
| `C` | Créer un Cloze enchaîné à 1 touche à partir de la sélection |
| 'B' | Marquer et extraire les 30 dernières secondes de TTS/audio actif (entrées extérieures) |
| `Alt` (maintenir) | Aperçu du contexte fantôme à l'intérieur de la revue de l'extrait |
| `Maj + Molette` | Priorité Nudge ±5 % sur la puce de priorité SelectionActionBar |
| `Maj + Glisser` | Nœuds de sélection au lasso sur 2D Knowledge Graph |
| `Ctrl/Cmd + Défilement` | Zoomer sur le document (contrôles de la barre d'outils également disponibles) |
| 'F11' | Plein écran |

---

## FAQ

**Q : Comment ajouter des newsletters à Plethora ?**
R : Vous pouvez ajouter des newsletters de deux manières :
1. **Répertoire des newsletters** : cliquez sur RSS → Icône de newsletter (📬) → Parcourez et abonnez-vous aux newsletters organisées
2. **URL directe** : copiez n'importe quelle URL de newsletter (Substack, Beehiiv, etc.) → RSS → Ajouter un flux → Coller l'URL. Plethora découvrira automatiquement le flux RSS.

**Q : Pourquoi ma vidéo, mon audio, mon infographie ou mon diaporama NotebookLM ne s'affichent-ils pas ?**
R : Les artefacts multimédias nécessitent que leur fichier soit généré et prêt avant de pouvoir être prévisualisés. Attendez la fin de la génération, puis rouvrez l'artefact : les vidéos/audio et les infographies réessayent automatiquement via un autre chemin multimédia, et les diaporamas proposent une option "Ouvrir avec un autre visualiseur" lorsqu'ils ne se chargent pas. Si l'échec persiste, reconnectez NotebookLM dans Paramètres → Intégrations et régénérez l'artefact.

**Q : Quelles plateformes de newsletter sont prises en charge ?**
R : Plethora prend en charge les flux RSS des sites Substack, Beehiiv, Ghost blogs, Buttondown, ConvertKit, Revue, Medium et WordPress. La plupart des newsletters publient des flux RSS – consultez le site Web de la newsletter pour un lien RSS ou essayez d'ajouter « /feed » à l'URL.

**Q : Combien de cartes dois-je examiner par jour ?**
R : Commencez avec 20 à 50 par jour. Ajustez en fonction de votre emploi du temps et de vos objectifs. La cohérence est plus importante que le volume.

**Q : Combien de cartes puis-je créer par jour ?**
R : Autant que vous le souhaitez, mais concentrez-vous sur la qualité plutôt que sur la quantité. 10 à 20 cartes bien faites valent mieux que 50 mauvaises.

**Q : Quel taux de rétention dois-je cibler ?**
R : 90 % est la valeur par défaut recommandée. Ajustez à 85 % si vous avez trop d'avis, ou à 95 % pour le matériel critique.

**Q : Puis-je utiliser Plethora pour les langues ?**
R : Absolument ! Consultez la section [Apprentissage des langues] (#apprentissage des langues) pour le flux de travail complet : profils, aperçu du dictionnaire, tuteur IA, pratique d'observation/dictée/prononciation/écriture, relecture alignée sur les médias et recommandations sur les lacunes du plan d'étude. C'est également excellent pour les cartes de vocabulaire, de grammaire et de phrases - utilisez les cartes Cloze pour les modèles de grammaire.

**Q : Comment gérer les équations mathématiques ?**
R : Utilisez la syntaxe LaTeX dans les cartes. Pour l'OCR, utilisez le fournisseur Mathpix pour obtenir de meilleurs résultats avec le contenu mathématique.

**Q : Puis-je synchroniser avec Anki ?**
R : Oui ! Configurez AnkiConnect dans Paramètres → Intégrations → Anki pour la synchronisation bidirectionnelle.

**Q : Quelle est la différence entre la suspension et la suppression ?**
R : La suspension masque temporairement les cartes (peut être rétablie). La suppression supprime définitivement (peut être restaurée à partir d'une sauvegarde).

**Q : À quelle fréquence dois-je réviser ?**
R : L’idéal est de le faire quotidiennement. Si vous manquez des jours, les cartes s'accumuleront mais ne seront pas « perdues » - rattrapez-les quand vous le pouvez.

**Q : Puis-je utiliser Plethora sur plusieurs appareils ?**
R : Pas encore directement, mais vous pouvez synchroniser les données via Dropbox/Google Drive ou utiliser l'extension du navigateur.

**Q : Mes données sont-elles privées ?**
R : Oui ! Toutes les données stockées localement. La synchronisation cloud est cryptée. Aucune donnée envoyée aux serveurs, à l'exception des fournisseurs d'IA configurés.

**Q : Comment exporter mes cartes ?**
R : Paramètres → Sauvegarde → Exporter, ou utilisez la synchronisation Anki pour exporter au format .apkg.

---

## Journal des modifications

Voir [CHANGELOG.md](https://github.com/melpomenex/Plethora/blob/main/CHANGELOG.md) pour l'historique des versions et les mises à jour.

---

**Bon apprentissage ! 🚀**

Construit avec ❤️ en utilisant Tauri + React + Rust
