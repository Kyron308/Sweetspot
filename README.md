# Sweet Spot v3 — Apple Web App

Sweet Spot is an iPhone-first, offline-capable personal balance companion. It is designed to feel like a small daily companion rather than a habit tracker.

## What changed in v3

- New **Today · Patterns · Life · More** navigation.
- One-tap states: **Flat, Good, Restless, Full** plus **Need people / Balanced / Need space**.
- Dynamic daily nudge that reacts to today's state and recent patterns.
- One-tap **Give me an idea** and **Make this my one thing** actions.
- Seven-day visual map.
- Pattern engine for repeated highs/lows, consecutive days, booster patterns and weekday tendencies.
- Dated adventures and a real **something to look forward to** countdown.
- Adventure suggestions for low-novelty days.
- Smarter meal picker using **Low energy / Normal / Keen to cook** and meal tags.
- IndexedDB storage with automatic migration from Sweet Spot v1/v2 localStorage data.
- JSON backup and restore.
- Improved GitHub Pages service-worker update flow with an in-app refresh banner.
- Offline support, dark mode, Apple Home Screen icon and iPhone safe-area support.

## Publish with GitHub Pages

1. Unzip this package.
2. Upload **all files and the `icons` folder** to the root of your GitHub repository.
3. In GitHub, open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Choose the **main** branch and **/ (root)**, then save.
6. Open the GitHub Pages URL in Safari on your iPhone.
7. Tap **Share → Add to Home Screen**.

## Updating an existing Sweet Spot repo

Replace the old `index.html`, `styles.css`, `app.js`, `manifest.json`, `sw.js`, `README.md`, and `icons` folder with the files in this package.

Sweet Spot v3 automatically imports data saved by the earlier Sweet Spot versions when it first starts on the same browser/device.

After a future GitHub update, Sweet Spot will show an **app updated** banner when the new service worker is ready. Tap **Refresh** to switch versions.

## Privacy / storage

Sweet Spot has no account, analytics or server database. Your app data is stored locally in the browser using IndexedDB. Export a JSON backup before changing phones, clearing Safari website data, or deleting the Home Screen web app if you want to preserve your history.
