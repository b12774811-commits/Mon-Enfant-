# App Enfant – Suivi de position

Application Expo/React Native qui tourne sur le téléphone de l'enfant et envoie
sa position au backend, même quand l'application est fermée.

## Fonctionnement

1. L'enfant ouvre l'app et entre un **code d'appairage** (généré par le parent
   depuis l'app parent — à construire dans le prochain projet).
2. L'app demande la permission de localisation **"Toujours autoriser"**
   (obligatoire pour suivre en arrière-plan).
3. Une fois activé, le switch "Partager ma position" démarre une tâche de fond
   qui envoie la position toutes les 30 secondes (ou tous les 25 mètres) vers
   votre backend, via une requête HTTP POST.

## Avant de lancer le projet

1. Installer les dépendances :
   ```
   npm install
   ```
2. Remplacer `API_URL` en haut de `App.js` par l'URL réelle de votre backend
   (endpoint qui recevra `{ childId, latitude, longitude, accuracy, timestamp }`).
3. Lancer en développement avec Expo :
   ```
   npx expo start
   ```
   Testez sur un vrai téléphone via l'app **Expo Go**, ou construisez un build
   natif avec `eas build` (le suivi en arrière-plan est limité dans Expo Go —
   un build natif est recommandé pour la version finale).

## Protection par code PIN parent

Lors de l'appairage, un **code PIN à 4 chiffres** est défini (à garder pour le
parent uniquement). Ce PIN est ensuite demandé avant :
- de désactiver le partage de position,
- de dissocier l'appareil.

L'enfant peut *activer* le partage librement (pour le réactiver facilement en
cas de souci), mais ne peut pas le couper ou supprimer l'appairage sans ce
code.

⚠️ Dans cette version, le PIN est stocké localement sur le téléphone pour
rester simple. Pour une version robuste, faites valider le PIN par le
**backend** (qui connaît le PIN associé au `childId`) plutôt que de le garder
sur l'appareil, afin qu'un enfant ne puisse pas le retrouver en fouillant le
stockage de l'app.

## Empêcher la désinstallation de l'app (hors-code)

Aucune application « normale » ne peut bloquer sa propre désinstallation —
c'est une protection du système contre les logiciels espions. Pour un vrai
verrouillage, utilisez les outils parentaux **natifs** du téléphone :

- **iOS** : Réglages → Temps d'écran → activer un code, puis dans
  "Restrictions de contenu et de confidentialité" → "Suppression d'app" →
  Ne pas autoriser.
- **Android** : installer **Google Family Link**, qui permet de verrouiller
  quelles apps l'enfant peut désinstaller, et d'empêcher la désactivation des
  permissions de localisation depuis les réglages système.

Ces réglages se font une fois, directement sur le téléphone de l'enfant, en
complément du PIN dans l'app.

## Points d'attention importants

- **iOS** : Apple est strict sur la justification de la localisation "Always".
  Lors de la soumission sur l'App Store, il faudra expliquer clairement l'usage
  (sécurité des enfants) dans le formulaire de review.
- **Android** : depuis Android 10+, la permission "Toujours autoriser" doit être
  demandée séparément, dans un second écran système — géré automatiquement par
  `expo-location`, mais l'enfant doit valider ce popup.
- **Batterie** : un intervalle de 30 secondes est un bon compromis. Le réduire
  augmentera la précision du suivi mais videra la batterie plus vite.
- **Vie privée** : pensez à chiffrer les communications (HTTPS obligatoire) et
  à limiter l'accès aux données de localisation au strict nécessaire côté
  backend.
