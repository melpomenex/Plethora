# Manuel de l'utilisateur Plethora

**Votre guide complet pour maîtriser la lecture incrémentielle et la répétition espacée**

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
   - **Algorithme** : FSRS-6 (recommandé), Plethora Adaptive ou Plethora Classic
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
| Anciennes applis d'apprentissage | Exportations ZIP | Migrer depuis des applis d'apprentissage incrémental compatibles |
| **JSON (.json)** | Fichiers de jeu de cartes mémoire | Importer des decks avec des données de planification |
| **URL** | Tout lien Web | Articles en ligne, blogs |
| **Arxiv** | Articles académiques | Littérature de recherche |
| **Capture d'écran** | Capture d'écran | Captures rapides depuis n'importe quelle application |

### Importation de documents

#### Méthode 1 : fichiers locaux

1. Cliquez sur **Documents** → **Importer**
2. Sélectionnez **Fichier local**
3. Accédez à votre fichier et sélectionnez-le
4. Plethora :
   - Extraire le contenu du texte
   - Calculer le temps de lecture et le nombre de mots
   - Extraire les métadonnées (titre, auteur, etc.)
   - Si l'auto-segmentation est activée (Paramètres → Documents → Traitement automatique à l'importation), divisez automatiquement le document en extraits

#### Méthode 2 : importation d'URL

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

#### Méthode 3 : Documents Arxiv

1. Recherchez un article Arxiv (par exemple, « https://arxiv.org/abs/2301.07041 »)
2. Copiez l'URL ou l'ID papier (`2301.07041`)
3. Cliquez sur **Documents** → **Importer** → **Arxiv**
4. Collez l'URL ou l'ID
5. Téléchargements incrémentaux :
   - PDF complet
   - Résumé
   - Auteurs
   -Date de parution
   - Références

#### Méthode 4 : importation de deck JSON

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
- Les cartes marquées «known_pile: true» sont importées comme suspendues.

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

### Comprendre FSRS-6

**FSRS-6** (Free Spaced Repetition Scheduler) est un algorithme moderne qui :

1. **Suive l'état de la mémoire** : modélise la force de votre mémoire pour chaque carte
2. **Prédit l'oubli** : estime le moment où vous oublierez chaque élément
3. **Optimise la planification** : planifie les révisions à des moments optimaux
4. **S'adapte à vous** : apprend de vos modèles de performance

**Mesures clés :**
- **Stabilité** : combien de temps dure une mémoire (plus élevée = plus stable)
- **Difficulté** : la difficulté de l'objet pour vous (échelle de 1 à 10)
- **Récupérabilité** : probabilité actuelle de rappel (0-100 %)

### Comprendre le Plethora Adaptive

**Plethora Adaptive** est le planificateur de la génération précédente de la famille. Il représente une évolution significative par rapport à Plethora Classic, introduisant une modélisation de la stabilité de la mémoire et une approche basée sur les données pour le calcul des intervalles.

Plethora Adaptive :

1. **Modèles à oubli exponentiel** : utilise la formule « R = 0,9^(t/S) » pour calculer la récupérabilité — la probabilité que vous vous souveniez d'un élément au temps « t » compte tenu de sa stabilité « S »
2. **Suit la difficulté indépendamment** : maintient une valeur de difficulté « D ∈ [0, 1] » pour chaque élément, mise à jour à l'aide d'une formule de moyenne finale qui devient plus réactive à chaque répétition.
3. **Utilise une matrice SInc 3D** : recherche le facteur d'augmentation de la stabilité à partir d'une matrice 21×21×21 indexée par difficulté, stabilité et récupérabilité — c'est le cœur de l'intelligence du Plethora Adaptive.
4. **Gère les erreurs avec élégance** : en cas d'échec, réduit la stabilité d'un facteur de 0,87 (divisé en outre par les erreurs accumulées) et réinitialise le compteur de répétitions, mais préserve l'estimation de la difficulté.
5. **Calcule les intervalles à partir de la stabilité** : dérive l'intervalle d'examen suivant à partir de l'objectif de rétention souhaité : `intervalle = S × ln(1-FI) / ln(0.9)`

**Mesures clés :**
- **Stabilité (S)** : combien de temps un souvenir persiste avant de se décomposer (mesuré en jours)
- **Difficulté (D)** : une valeur de 0 (le plus facile) à 1 (le plus difficile), mise à jour via un mélange de moyenne finale après chaque révision
- **Récupérabilité (R)** : probabilité de rappel actuelle, calculée comme `0,9^(écoulé/S)`
- **SInc** : le facteur d'augmentation de la stabilité a été recherché à partir de la matrice de 9 261 entrées : le degré d'augmentation de la stabilité après chaque examen réussi
- **Lapses** : Nombre d'échecs, qui pénalisent la stabilité future sur les laps de temps ultérieurs

### Comprendre le Plethora Precision

L'option **Plethora Precision** de Plethora est **Algorithm Arena** — une réimplémentation fidèle du planificateur d'origine qui exécute **cinq** algorithmes à répétition espacée en parallèle sur chaque flashcard et mélange leurs prédictions en un seul calendrier. Les cinq concurrents, avec les poids de mélange par défaut auxquels ils commencent :

| Fente | Modèle | Poids par défaut | Apprend comment? |
|------|-------|---------------:|-------------|
| 1 | **Plethora Classic** | 6% | Fixe |
| 2 | **Plethora Classic 15** | 14% | En continu, à chaque révision |
| 3 | **Classic 19** | 45% | En continu, à chaque révision |
| 4 | **Plethora Precision** (le noyau à courbe d'oubli "M4" à 35 paramètres) | 25% | À la demande, via le bouton Optimiser |
| 5 | **FSRS** | 10% | À la demande, via le bouton Optimiser |

**Comment fonctionne le mélange.** Chaque modèle produit indépendamment une estimation de stabilité pour la carte ; l'arène prend une moyenne pondérée et en dérive l'intervalle suivant. Les poids ne sont pas fixes — ils **s'adaptent à vous**. Chaque fois que vous examinez une carte dont la précédente évaluation remonte à au moins un jour, l'Arena évalue la prédiction *précédente* de chaque modèle par rapport à ce qui s'est réellement passé (dont vous vous êtes souvenu ou oublié) et oriente les pondérations vers les modèles qui vous ont le mieux prédit. Aucun modèle n'est jamais complètement éliminé, donc un démarreur lent peut récupérer.

**Deux manières d'apprendre :**

1. **Automatiquement, à chaque révision** — l'optimiseur Plethora Classic 15 et les matrices Classic 19 se mettent à jour immédiatement et les poids de mélange changent. Cela commence dès votre tout premier avis. Vous pouvez le regarder dans Paramètres → Apprentissage : le panneau **Poids d'arène** affiche le pourcentage actuel de chaque modèle et, une fois que vous avez suffisamment d'avis notés, une **R-Metric** (à quel point la prédiction combinée est meilleure que celle du Classic 19 seul).
2. **À la demande, lorsque vous cliquez sur Optimiser** — deux des cinq concurrents (le noyau Plethora Precision et FSRS) peuvent être intégrés à votre historique d'évaluation personnel. Ces ajustements sont limités à une quantité minimale de données (environ plusieurs centaines d'avis espacés de jours) et à un contrôle de validation retenu : un ajustement n'est accepté que s'il dépasse réellement les valeurs par défaut expédiées pour les avis que l'ajustement n'a pas vu. Jusque-là, les boutons Optimiser signalent « Pas encore assez d'historique de révision » et ces deux modèles continuent d'utiliser leurs paramètres par défaut.

**Pourquoi il peut dire qu'il n'a pas commencé l'entraînement.** Seules les évaluations espacées d'au moins **un jour** véhiculent le signal — les premières évaluations et les réévaluations le jour même ne disent rien à l'arène (chaque modèle prédit correctement que vous vous en souviendrez), elles ne comptent donc pas dans le total des points. Si vous n'avez qu'une poignée de cartes, attendez-vous à ce que les poids d'arène restent proches de leurs valeurs par défaut et que la R-Metric reste cachée jusqu'à ce que ces cartes commencent à revenir à des intervalles d'un jour. C'est attendu, pas un bug.

**Mesures clés :**
- **Stabilité (S)** : estimation de chaque modèle de la durée de persistance de la mémoire (jours) ; l'Arène les mélange.
- **Difficulté (D)** : estimation de la difficulté de l'objet de chaque modèle.
- **Poids d'arène** : les pourcentages de mélange en direct par modèle, affichés dans les paramètres d'apprentissage.
- **R-Metric** : Amélioration relative du mélange par rapport au Classic 19 seul, calculée sur une fenêtre décroissante de vos avis.

**En quoi le Plethora Precision diffère du FSRS-6 :**
- FSRS-6 est un planificateur de production unique et mature et reste la valeur par défaut recommandée.
- Plethora Precision est un ensemble expérimental qui oppose cinq algorithmes et laisse vos propres données choisir le mélange. Il est plus complexe et nécessite davantage d’examens à personnaliser, mais peut surpasser n’importe quel modèle unique une fois qu’il dispose de suffisamment de votre historique pour en tirer des leçons.

#### Choisir un Horizon Mémoire après un examen du Plethora Precision

Sous **Paramètres → Apprentissage → Algorithm Arena → Après chaque évaluation**, choisissez le niveau de détails de planification souhaité :

- **Gardez le flux (recommandé)** valide immédiatement le choix pondéré d'Arena et passe à la carte suivante. C'est la valeur par défaut.
- **Afficher l'arène** s'arrête après une note éligible et ouvre **Memory Horizon**, avec votre réponse toujours visible pendant que les cinq modèles montrent où ils placeront la prochaine évaluation.

Le même choix compact apparaît sous les six commandes de notation Plethora Precision, de sorte que la notation suivante peut utiliser un mode différent sans quitter la revue. Les deux modes exécutent et entraînent les cinq mêmes modèles de collection ; ce paramètre change uniquement si vous faites le choix final de l'intervalle. L'étape de décision reste limitée aux examens normaux des cartes flash Plethora Precision ; la lecture de documents, le mode Cram, d'autres algorithmes et le **mode Pure Plethora Precision** conservent leur flux de planification directe existant.

- **Arena Pick** est sélectionné par défaut. Il s’agit de la recommandation pondérée et constitue généralement le meilleur choix lorsque vous souhaitez que l’arène prenne une décision.
- **Plethora Classic, Plethora Classic 15, Classic 19, Plethora Precision et FSRS** vous permettent de suivre délibérément la proposition exacte d'un modèle pour cette révision. En choisir un ne donne pas à ce modèle un poids de vote supplémentaire ; les pondérations futures continuent d’apprendre uniquement de la précision des prédictions.
- **Personnalisé** accepte un montant et une unité ou une position sur la lentille temporelle logarithmique. Les limites affichées protègent contre les planifications non valides et la date d'échéance exacte est mise à jour avant que vous ne confirmiez.
- **Pourquoi cet intervalle** élargit les propositions, les poids actuels et la gamme Arena. L'intervalle correspond à l'intervalle du plus ancien au plus récent proposé par les cinq modèles, et non à un intervalle d'incertitude ou de confiance.

Rien n'est validé tant que vous n'appuyez sur **Planifier pour …**. Si l'aperçu devient obsolète ou si une sauvegarde échoue, la carte reste en place avec votre note et votre sélection préservées afin que vous puissiez réessayer en toute sécurité. **Retour à la note** supprime la note en attente et vous permet de choisir à nouveau.

Commandes du clavier lorsque Memory Horizon est ouvert :

| Clé | Actions |
|-----|--------|
| `←` / `→` | Explorer les propositions par ordre chronologique |
| `1`–`5` | Sélectionnez Plethora Classic, Plethora Classic 15, Classic 19, Plethora Precision ou FSRS |
| `A` | Sélectionnez le choix de l'arène |
| 'M' | Sélectionnez Personnalisé |
| « Entrée » ou « Espace » | Confirmer le planning affiché |
| `Évasion` | Retour à la note |

Lors de la révision audio mains libres, Plethora confirme automatiquement Arena Pick afin que la lecture puisse continuer, même lorsque **Afficher l'arène** est sélectionné pour les révisions visuelles. La révision reste récupérable si cette validation automatique échoue.

### Calendrier de lecture des documents (lecture incrémentielle)

Les algorithmes ci-dessus (FSRS-6, Plethora Adaptive, Plethora Precision) sont des planificateurs de **flashcard** : ils s'entraînent sur les questions-réponses, les cloze et les cartes de base, dont l'objectif est le rappel à long terme. Les **Documents** (les articles, articles et passages que vous lisez via la lecture incrémentielle) sont programmés par un planificateur **séparé** avec un objectif différent : maintenir le contenu en rotation régulière plutôt que maximiser la rétention à long terme d'un seul fait.

**Deux planificateurs, pas un.** C'est la plus grande source de confusion :

- **Flashcards** → FSRS-6 / Plethora Adaptive / Plethora Precision (votre choix dans les paramètres d'apprentissage) → écrit dans l'historique des révisions qui entraîne ces algorithmes.
- **Documents** → le **Planificateur de lecture incrémentielle** (ou sa variante **Engaging**) → suivi séparément, et **n'alimente pas du tout les algorithmes des cartes mémoire.**

L'évaluation d'un document avec Encore / Difficile / Bon / Facile semble identique à l'évaluation d'une carte mémoire - les quatre mêmes boutons apparaissent - mais la note va à un endroit différent et produit des intervalles courts et prévisibles :

| Évaluation | Intervalle de document | Intervalle de carte mémoire (varie selon l'algorithme) |
|--------|---------|--------------------------------------------------------|
| **Encore** | ~4 heures | minutes |
| **Dur** | ~1 jour | 1 à 2 jours |
| **Bien** | ~3 jours | jours-semaines |
| **Facile** | ~7 jours | semaines |

Les intervalles entre les documents sont limités à environ **30 jours** afin que le matériel reste en rotation, et les notes consécutives Bon/Facile ajoutent un petit bonus tandis que les notes consécutives Encore/Difficile ajoutent une petite pénalité.

**Le planificateur engageant.** Lorsque vous lisez des documents à partir de la file d'attente, Plethora utilise la variante *Engaging*, qui superpose l'injection de nouveauté, l'équilibrage des variétés et le hasard au-dessus des intervalles de base afin que vos sessions de lecture restent variées et intéressantes. Ces fonctionnalités d'engagement affectent *quel* document apparaîtra ensuite, et non les calculs d'intervalle sous-jacents.

**Point pratique.** Faire beaucoup de lectures incrémentielles ne comptera **pas** pour la « formation » Plethora Precision ou FSRS – ces algorithmes ne voient que les critiques de cartes mémoire. Si vous souhaitez qu'ils soient personnalisés, vous avez besoin de cartes mémoire examinées à intervalles journaliers. (C'est pourquoi le panneau Plethora Precision dans les paramètres d'apprentissage peut afficher « 0 score » même si vous avez lu des documents toute la semaine.) Voir [Comprendre Plethora Precision](#understanding-sm-20) pour savoir ce qui compte et ce qui ne compte pas.

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
- L'évaluation d'un document planifie sa prochaine date de lecture via le **Planificateur de lecture incrémentiel** (intervalles courts et plafonnés) — distinct des algorithmes de la carte mémoire. Voir [Programmation de lecture de documents](#document-reading-schedule-incremental-reading).

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

### Stratégies d'examen

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

### Système de priorité

Chaque document, extrait et carte se trouve quelque part dans une **liste classée unique** : une file d'attente, tous les types d'éléments ensemble. La priorité est ce classement. Définir la priorité sur un élément revient à indiquer à Plethora *où il appartient dans votre collection*, sans lui attacher de score.

**La priorité est une position, pas une étiquette.**

Il s’agit du modèle de file de priorité, et c’est la raison pour laquelle les chiffres se comportent comme ils le font. Lorsque vous définissez un objet à 70 %, il se déplace jusqu'à 70 % de la hauteur de votre collection, soit au-dessus d'environ 70 % de tout ce que vous possédez, en dessous des 30 % supérieurs. Rien d'autre n'est renuméroté ; l'article s'insère simplement.

Définissez la priorité de 0 à 100 sur n'importe quel élément :

- **90-100** : par-dessus presque tout le reste – la poignée de choses que vous voulez en premier
- **70-80** : Partie supérieure de la collection
- **50-60** : Milieu du pack (valeur par défaut pour les nouveaux matériaux)
- **20-40** : Partie inférieure — lisez-la éventuellement
- **0-10** : bas de la file d'attente — référence, archive, un jour

**Vos pourcentages évoluent d'eux-mêmes, et c'est exact.**

Parce qu'un pourcentage signifie « jusqu'ici dans la collection *en ce moment* », il change à mesure que la collection qui l'entoure change. Importez 500 nouveaux articles et attribuez une note élevée à la moitié d'entre eux, et un ancien document intact affichera un pourcentage inférieur à celui de la semaine dernière - non pas parce que vous l'avez rétrogradé, mais parce que davantage de documents se trouvent désormais au-dessus. Sa place réelle dans votre ordre de lecture reste inchangée par rapport à tout ce qui s'y trouvait déjà.

Un nombre fixe vous mentirait ici : « 70 » dans une collection de 100 articles et « 70 » dans une collection de 10 000 articles prétendraient signifier la même chose tout en décrivant des positions complètement différentes. Le pourcentage vous dit la vérité sur votre collection telle qu’elle existe aujourd’hui.

**Position X de N.**

Ouvrez la fenêtre contextuelle de priorité sur n'importe quel élément et elle affiche son classement en direct sous le curseur — *Position 1* est l'élément le plus important de votre collection, *Position N* le moins. Rouvrez-le après une grosse importation et vous verrez la position bouger. Cette lecture est recherchée à chaque fois que vous l'ouvrez.

**Il n'y a pas deux éléments qui partagent une place.**

Définir plusieurs éléments sur le même pourcentage ne les empile pas en un seul point : chacun est placé juste après le dernier, de sorte que la file d'attente reste dans un ordre strict. La définition groupée de 200 documents à 60 % organise les 200 aux alentours de 60 %, dans l'ordre, plutôt que de créer une égalité à 200 que la file d'attente doit rompre arbitrairement plus tard.

**Planification prioritaire :**
Les éléments plus prioritaires sont affichés plus fréquemment dans les avis mitigés. La priorité régit l'*importance* — ce à quoi vous arrivez en premier lorsqu'il y a plus de matériel que de temps. Il est distinct de la planification FSRS, qui régit le *timing* — la prochaine échéance d'un élément donné. Une carte de faible priorité qui est en retard peut toujours apparaître avant une carte de haute priorité qui a été examinée hier.

**Les extraits héritent de leur document.** Un nouvel extrait démarre avec la priorité de son document source, et la modification de la priorité du document s'applique aux extraits toujours à l'ancienne valeur. Une fois que vous avez défini manuellement la priorité d'un extrait, il cesse d'hériter et conserve sa propre place.

### Comportement de classement et de réorganisation des files d'attente

Comprendre comment la file d'attente classe les éléments et pourquoi les positions changent vous aide à optimiser votre flux d'étude :

1. **Planification FSRS et notation dynamique des priorités** :
   - La position de chaque élément est calculée à l'aide de ses paramètres de mémoire FSRS (date d'échéance, intervalle, stabilité, dégradation de la récupérabilité) combinés avec le préréglage de votre stratégie Smart Queue sélectionnée (*Maximiser la rétention*, *Rattrapage agressif*, *Minimiser le temps* ou *Exploratoire*).
   - Au fur et à mesure que vous effectuez des révisions, reportez des éléments ou prenez des notes, les paramètres de mémoire sont mis à jour et les éléments sont naturellement reclassés lors de leur retour dans la file d'attente.

2. ** Randomisation de sélection pondérée ** :
   - Le moteur d'évaluation applique un algorithme subtil de décroissance pondérée (« caractère aléatoire = 0,3 » par défaut) lors de l'extraction d'éléments du backend. Cela maintient les éléments ayant des priorités similaires en haut tout en introduisant une légère variété pour éviter la fatigue de la file d'attente.

3. **Synchronisation de l'état** :
   - L'exécution d'actions de modification de la file d'attente (telles que l'archivage d'un document, la priorité d'édition en masse ou la modification de balises) déclenche une actualisation en arrière-plan lors du retour à la vue de la file d'attente pour que votre liste reste alignée sur l'état de la base de données principale.
   - Les changements de vue passifs ou les changements d'onglets maintiennent un ordre local stable sans déclencher de remaniements inattendus.


### Examen neuronal (« Devenez neuronal »)

L'examen neuronal est un mode exploratoire facultatif inspiré du concept *Learn : Go neural*. Au lieu de parcourir votre file d'attente prioritaire dans l'ordre, il crée une nouvelle séquence de révision en **diffusant l'activation** à partir d'un seul point de départ - l'élément que vous lisez actuellement - et en faisant apparaître tout ce qui y est connecté. C'est le mode à privilégier lorsque vous souhaitez suivre un fil de discussion dans votre collection plutôt que de parcourir ce qui est dû.

**Comment l'utiliser.** Pendant la lecture en mode défilement, cliquez sur **Devenir neuronal** dans la barre supérieure. La session passe à une file d'attente d'activation de diffusion amorcée au niveau du document, de la carte ou de l'extrait actuel ; la pilule de position devient violette et indique « Examen neuronal · N restant ». Cliquez sur **Quitter** pour revenir exactement là où vous en étiez dans votre lecture : l'examen neuronal ne modifie jamais votre file d'attente prioritaire ou votre planification. Lorsque la file d'attente est faible, elle se remplit automatiquement à partir de l'élément que vous venez de terminer.

**Les flashcards et les extraits nécessitent toujours une note pour avancer**, tout comme en mode défilement normal, donc une session neuronale contribue toujours à la planification. Les documents avancent librement.

**Comment il décide de ce qui est « lié ».** L'activation se propage vers l'extérieur à partir de la graine via cinq types de connexions, dans cet ordre :

1. **Groupes de concepts (balises).** Les éléments partageant une balise avec la graine sont traités comme des pairs conceptuels. Le marquage est donc doublement utile : il regroupe les éléments à rechercher *et* alimente l'examen neuronal. Un élément non balisé n’a aucun concept homologue.
2. **Références inter-éléments.** Liens de références croisées explicites, le cas échéant.
3. **Descendants.** Les enfants de la graine dans l'arbre des connaissances — les extraits et les cartes dans un document, les cartes dans un extrait.
4. **Similitude sémantique.** Lorsque vous avez indexé votre collection pour RAG (Paramètres → Intégrations et RAG → Collection d'index), l'examen neuronal fait également apparaître les documents dont le contenu est similaire à celui de la graine. D'autres documents similaires apparaissent plus tôt. Si vous n’avez pas indexé, cette source reste simplement silencieuse – les quatre autres fonctionnent toujours.
5. **Parent et frères et sœurs.** Le parent de la graine (le document dans lequel réside un extrait) et ses frères et sœurs (autres extraits dans le même document, autres cartes dans le même extrait, plus les documents proches).

Des connexions plus étroites – un enfant direct, un document presque identique, une balise partagée – apparaissent plus tôt dans la file d'attente. Lorsque la première vague produit moins de vingt éléments, l'activation s'étend vers les voisins des éléments nouvellement atteints jusqu'à ce que la file d'attente soit pleine ou que plus rien ne soit accessible.

**Conseils :**
- Marquez les éléments que vous souhaitez explorer ensemble - la balise devient un examen neuronal de groupe conceptuel qui suivra.
- Indexez votre collection pour débloquer la découverte sémantique ; sans cela, l'examen neuronal repose uniquement sur la structure arborescente et les balises.
- L'examen neuronal est en lecture seule par rapport à votre file d'attente normale. Utilisez-le librement ; rien concernant votre commande prioritaire ou les dates d'échéance ne change.


### Files d'attente intelligentes

Créez des files d'attente personnalisées avec des filtres :

**Exemples de files d'attente :**
- "Aujourd'hui": cartes dues de la catégorie principale
- "Quick Review" : Cartes faciles, priorité < 50
- "Deep Dive" : Cartes rigides de la catégorie recherche
- "Exam Prep" : Toutes les cartes de la catégorie "Biologie"

**Création d'une file d'attente intelligente :**
1. Cliquez sur **File d'attente** → **Files d'attente enregistrées**.
2. Cliquez sur **Nouvelle file d'attente**
3. Définir les filtres et l'ordre de tri
4. Nommez et enregistrez

### Planification basée sur les balises (TAS)

Tag-Aware Scheduling ajoute une intelligence sémantique à la file d'attente de révision.
Lorsqu'il est activé dans Paramètres, TAS applique deux passes de post-traitement
vos éléments dus sans modifier les intervalles Plethora Precision/FSRS sous-jacents :

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
| Taux de maturité | 0,50-1,00 | 0,70 | Fraction d'éléments dans une balise préalable qui doit être mature |

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

Une balise est **mature** pour un élément lorsque la stabilité Plethora Precision/FSRS de cet élément
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

## Analyses et suivi des progrès

### Présentation du tableau de bord

Le tableau de bord Analytics fournit des informations complètes :

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

**Mesures d'algorithme (FSRS/Plethora Adaptive) :**
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

Plethora prend en charge quatre algorithmes de planification. Choisissez celui qui correspond le mieux à votre style d'apprentissage :

**FSRS-6 (recommandé) :**
- Moderne, soutenu par la recherche
- S'adapte à la mémoire individuelle
- Prédit les temps d'oubli
- Meilleure rétention avec moins d'avis

**Plethora Precision (SuperMémo 20) :**
- Algorithme le plus avancé, rétro-ingénierie à partir de sm20.exe via Ghidra
- Utilise la formule d'intervalle V4 (Plethora Precision proprement dite); La planification Classic 19 est disponible via l'algorithme `sm2` séparé
- Le lissage bayésien apprend les intervalles optimaux à partir de vos données d'examen réelles
- Développe des connaissances au fil du temps via des matrices d'intervalle/compte persistantes de 21 × 21 × 21

**Plethora Adaptive (SuperMémo 18) :**
- Le planificateur le plus avancé de la famille, réimplémenté à partir de l'application d'origine
- Utilise une matrice de recherche 3D SInc (Stability Increase) en fonction de la difficulté, de la stabilité et de la récupérabilité
- Suivi explicite des difficultés avec mises à jour de la moyenne finale
- Modèle de courbe d'oubli exponentielle : `R = 0,9^(t/S)`
- Gestion sophistiquée des pannes avec réduction de la stabilité en fonction des déchéances

**Plethora Classic (Classique) :**
- L'algorithme classique traditionnel (documenté publiquement)
- Plus simple, prévisible
- Plus d'avis requis

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

#### Qu'est-ce qui synchronise

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
  - Slide Deck (format : détaillé/présentateur, durée : par défaut/court)
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

Sur les appareils Apple compatibles, Plethora peut exécuter de nombreuses fonctionnalités IA à l'aide des **Apple Foundation Models** — le modèle linguistique intégré d'Apple qui fonctionne directement sur l'appareil. Ceci est distinct des fournisseurs cloud (OpenAI, Ollama, etc.) et **ne nécessite pas de clé API**.

**Ce que c'est :** Génération de texte sur l'appareil pour des tâches comme le marquage intelligent, le résumé, la génération de flashcards et les réponses **Interroger la bibliothèque**.

**Ce que ce n'est pas :** Apple Foundation Models **ne transcrit pas** les vidéos ni l'audio, **ne lit pas** le texte à voix haute (TTS) et **ne analyse pas** les photos. Utilisez les paramètres **Transcription audio** et **Synthèse vocale** de Plethora pour ces tâches.

**Prérequis :**
- **Mac :** macOS 26 ou ultérieur, Apple Silicon, Apple Intelligence activé dans Réglages système
- **iPhone / iPad :** iOS 26 ou ultérieur, Apple Intelligence activé, appareil compatible

**Comment l'activer :**
1. Ouvrez **Paramètres → IA**
2. Faites défiler jusqu'à **IA sur l'appareil**
3. Activez **Préférer l'IA sur l'appareil**
4. Vérifiez que **Foundation Models** (ou **Apple Intelligence**) affiche **Prêt**

Lorsque le statut est Prêt, Plethora utilise automatiquement l'IA Apple sur l'appareil pour les tâches prises en charge. Vous n'avez pas à ajouter Apple à la liste des fournisseurs cloud.

**Ce que vous pouvez faire avec l'IA Apple sur l'appareil :**

| Fonctionnalité | Fonctionne sur l'appareil ? |
|---------|------------------|
| Marquage intelligent | Oui |
| Résumer / expliquer un passage | Oui |
| Interroger la bibliothèque (réponses à partir de votre bibliothèque) | Oui |
| Générer des flashcards à partir de texte | Oui |
| Extraire les points clés, questions d'étude | Oui |
| Indices de révision Studio | Oui |
| Transcrire des vidéos ou des livres audio | Non — utilisez **Paramètres → Transcription audio** |
| Lire le texte à voix haute (TTS) | Non — utilisez **Paramètres → Synthèse vocale** |
| Décrire des images / OCR | Non — utilisez l'OCR ou les fonctionnalités vision |

**Confidentialité :**
- Le traitement reste **sur votre appareil** par défaut
- **Autoriser le repli cloud** est désactivé par défaut — si l'IA sur l'appareil ne peut pas accomplir une tâche, Plethora **n'enverra pas** silencieusement votre contenu vers un fournisseur cloud payant
- Vous pouvez activer le repli cloud si vous souhaitez que Plethora réessaie avec votre fournisseur cloud configuré lorsque l'IA sur l'appareil n'est pas disponible

**Si le statut n'est pas Prêt :**

| Statut | Signification | Que faire |
|--------|---------------|-------------|
| Prêt | L'IA sur l'appareil est disponible | Utilisez les fonctionnalités IA normalement |
| Téléchargement… | Le modèle système est en cours d'installation | Attendez, puis appuyez sur **Actualiser** dans IA sur l'appareil |
| Désactivé | Apple Intelligence est désactivé | Activez Apple Intelligence dans Réglages système |
| Non admissible | L'appareil ou la région n'est pas pris en charge | Utilisez plutôt un fournisseur cloud ou local |
| OS non pris en charge | macOS/iOS inférieur à la version 26 | Mettez à jour votre système ou utilisez un autre fournisseur |

**Astuce :** Les documents longs sont gérés automatiquement — Plethora les divise en segments qui tiennent dans la fenêtre contextuelle sur l'appareil, puis combine les résultats. Vous n'avez pas à configurer cela.

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
- Max jetons par demande
- Contexte des cartes associées
- Longueur de l'extrait de document

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
3. Définir le début/la fin et le texte de transcription facultatif
4. Enregistrez pour créer un clip réutilisable

**Intégration SponsorBlock :**
- Sauter automatiquement les segments sponsorisés
- Filtrage par catégorie
- Contribuer à SponsorBlock

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
- Utilisez `-t $(nproc)` pour utiliser tous les threads du CPU
- La quantification Q4_K_M offre le meilleur compromis qualité/vitesse pour l'inférence CPU
- Pour l'accélération GPU, créez llama.cpp avec le support CUDA, Metal ou Vulkan

**Configuration (GLM-OCR avec vLLM) :**

vLLM fournit une inférence accélérée par GPU pour les modèles plus grands. Nécessite un GPU NVIDIA avec suffisamment de VRAM.

```bash
pip install -U vllm
vllm serve zai-org/GLM-OCR --allowed-local-media-path / --port 8080
```

Configurez ensuite Plethora de la même manière (point de terminaison `http://localhost:8080/v1`).

**Configuration (GLM-OCR avec Ollama) :**

L'option la plus simple pour démarrer : Ollama gère automatiquement les téléchargements et l'exécution des modèles.

1. Paramètres → OCR → Fournisseur : **GLM-OCR (Local)**
2. Backend : **Ollama (CPU)**
3. Cliquez sur **Télécharger Ollama** (s'il n'est pas installé)
4. Cliquez sur **Démarrer l'exécution**
5. Définir le modèle (par exemple, `llava:7b` ou `qwen2-vl:7b`)
6. Cliquez sur **Tirer le modèle**

**OCR mathématique :**
- Gestion spécialisée des équations
- Sortie LaTeX
- Reconnaissance des symboles
- Idéal pour : articles scientifiques, manuels scolaires

### Palette de commandes

Accès rapide à toutes les commandes :

**Ouvrir :** `Ctrl+K` (ou `Cmd+K` sur Mac)

**Caractéristiques :**
- Recherche floue
- Navigation au clavier
- Commandes récemment utilisées
- Recherche par nom ou raccourci
- Les résultats de la recherche accèdent à l'emplacement correspondant dans les documents et mettent en surbrillance la requête (PDF, EPUB, Web Imports)
- Les correspondances de transcription YouTube recherchent l'horodatage et démarrent la lecture
- Survolez le résultat d'un document pour voir des correspondances supplémentaires du même document

**Commandes communes :**
- "Importer un document"
- "Démarrer la révision"
- "Créer une carte"
- "Ouvrir les paramètres"
- "Exporter des données"

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
- `f` : astuces de lien (éléments cliquables)
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
- Choisissez "Ajouter à l'incrémentum"
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
- Examen dans 2 semaines : Notez « Facile » sur les cartes importantes pour les revoir bientôt
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

**FSRS** : Free Spaced Repetition Scheduler, algorithme moderne optimisant le timing de révision (FSRS-6 est la version actuelle)

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
| `Ctrl/Cmd + +` | Zoomer |
| `Ctrl/Cmd + -` | Zoom arrière |
| `Ctrl/Cmd + 0` | Réinitialiser le zoom |
| 'F11' | Plein écran |

---

##FAQ

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
R : Absolument ! C'est excellent pour les cartes de vocabulaire, de grammaire et de phrases. Utilisez des cartes Cloze pour les modèles de grammaire.

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

Voir [CHANGELOG.md](https://github.com/melpomenex/incrementum-tauri/blob/main/CHANGELOG.md) pour l'historique des versions et les mises à jour.

---

## Assistance et communauté

- **Documentation** : [docs/](./)
- **GitHub** : [incrementum-tauri](https://github.com/melpomenex/incrementum-tauri)
- **Problèmes** : [Signaler des bugs](https://github.com/melpomenex/incrementum-tauri/issues)
- **Discussions** : [Poser des questions](https://github.com/melpomenex/incrementum-tauri/discussions)

---

**Bon apprentissage ! 🚀**

Construit avec ❤️ en utilisant Tauri + React + Rust
