# Master Wiki 🧭

Un jeu de course Wikipédia dans l'esprit de WikiMaster : on part d'un article et on doit atteindre un
article cible **en ne cliquant que sur les liens internes**, le plus vite et avec le moins de clics possible.

## Lancer le jeu

Aucune installation : ouvre `index.html` dans un navigateur (connexion internet requise, les articles
sont chargés en direct depuis Wikipédia). Le site peut aussi être hébergé tel quel sur GitHub Pages.

## Modes de jeu

| Mode | Règle |
| --- | --- |
| **Classique** | Score calculé à partir du temps et du nombre de clics |
| **Chrono** | 3 minutes pour atteindre la cible |
| **Économe** | 8 clics maximum |
| **Défi du jour** | La même paire d'articles pour tout le monde, chaque jour |

Trois difficultés : *Facile* (articles connus), *Moyen* (départ aléatoire), *Difficile* (départ et
cible aléatoires, cible choisie parmi les articles assez reliés pour rester faisable). On peut aussi
choisir soi-même les articles, avec autocomplétion.

## Fluidité

- **Préchargement au survol** : l'article est téléchargé dès que la souris passe sur un lien, donc
  souvent prêt avant le clic.
- **Cache** des articles déjà vus : les retours arrière sont instantanés.
- **Chronomètre en pause pendant les chargements** : une connexion lente ne pénalise pas.
- Transitions animées entre articles, sans rechargement de page.

## Autres nouveautés

- 🎯 Fiche de la cible toujours visible (image, résumé).
- 💡 **Indices** : surligne les liens de la page qui mènent à la cible ou qui en sont proches (+20 s).
- 🔎 **Recherche de liens** (`/` ou `Ctrl+K`) : filtre et suit un lien au clavier.
- 🧵 Fil d'Ariane du chemin parcouru, liens déjà visités colorés.
- ↩ Retour arrière (compte comme un clic), désactivable pour plus de difficulté.
- 📊 Statistiques et historique des parties, record personnel par trajet.
- 📋 Partage du résultat façon Wordle.
- 🌓 Thème clair/sombre, Wikipédia français ou anglais, interface adaptée au mobile.

## Raccourcis

| Touche | Action |
| --- | --- |
| `/` ou `Ctrl+K` | Chercher un lien sur la page |
| `H` | Indice |
| `Alt` + `←` | Article précédent |
| `Échap` | Fermer la recherche / abandonner |

## Structure

- `index.html` — écrans (menu, jeu, fin, statistiques)
- `css/style.css` — styles, thèmes, responsive
- `js/data.js` — listes d'articles connus (FR/EN)
- `js/wiki.js` — accès à l'API Wikipédia avec cache
- `js/app.js` — logique du jeu
