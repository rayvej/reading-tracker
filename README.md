# 📖 Reading Tracker — Setup Guide

A private, mobile-optimized PWA for tracking your reading sessions. Runs on GitHub Pages and syncs across all your devices via Firebase Firestore.

---

## Step 1 — Create a Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **"Add project"**
3. Name it something like `reading-tracker` → click Continue
4. Disable Google Analytics (not needed) → click **Create project**

---

## Step 2 — Enable Firestore

1. In the Firebase Console, click **Firestore Database** in the left sidebar
2. Click **Create database**
3. Choose **Start in production mode** → Next
4. Pick a location (e.g. `us-central`) → **Enable**

---

## Step 3 — Set Firestore Security Rules

1. In Firestore, click the **Rules** tab
2. Replace the default rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

3. Click **Publish**

> This ensures only you (when signed in) can read or write your data.

---

## Step 4 — Enable Google Sign-In

1. In Firebase Console, click **Authentication** → **Sign-in method**
2. Click **Google** → toggle **Enable** → Save

---

## Step 5 — Get Your Firebase Config

1. Go to **Project Settings** (gear icon) → **Your apps**
2. Click the **`</>`** (Web) icon → Register an app (name it anything)
3. Copy the `firebaseConfig` object — it looks like this:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

4. Open `public/firebase-config.js` and paste your values in.

---

## Step 6 — Push to GitHub

1. Create a new **private** repository on [github.com](https://github.com/new)
   - Name: `reading-tracker`
   - Visibility: **Private**

2. In Terminal, from the `Reading Tracker` folder:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/reading-tracker.git
git push -u origin main
```

---

## Step 7 — Enable GitHub Pages

1. In your GitHub repo, go to **Settings** → **Pages**
2. Under **Source**, select:
   - Branch: `main`
   - Folder: `/public`
3. Click **Save**
4. Wait 1–2 minutes — your app will be live at:
   `https://YOUR_USERNAME.github.io/reading-tracker/`

---

## Step 8 — Add GitHub Pages to Firebase Authorized Domains

1. In Firebase Console → **Authentication** → **Settings** → **Authorized domains**
2. Click **Add domain**
3. Enter: `YOUR_USERNAME.github.io`
4. Click **Add**

---

## Step 9 — Install on iPhone

1. Open Safari on your iPhone
2. Go to: `https://YOUR_USERNAME.github.io/reading-tracker/`
3. Tap the **Share** button (square with arrow)
4. Tap **"Add to Home Screen"**
5. Tap **Add**

The app now appears on your home screen like a native app — full screen, no browser chrome.

---

## First Launch

1. Open the app → tap **Sign in with Google** → choose your Google account
2. Enter PIN: **`1234`** (you can change this later in the settings)
3. The app will import all 158 books, 412 reading logs, and 161 wishlist items from your Excel file
   - This takes about 30–60 seconds on first launch
4. Once complete, you'll see your full dashboard

---

## Changing Your PIN

The default PIN is `1234`. To change it, go to Firebase Console → Firestore Database → your user data → `settings/app` → update the `pin_hash` field.

> A PIN change screen inside the app is on the roadmap.

---

## Offline Support

The app works fully offline after the first visit. Any sessions you log while offline will sync automatically to Firestore when you're back online.

---

## File Structure

```
Reading Tracker/
  generate_seed.py         ← Run once to rebuild seed-data.json from Excel
  public/
    index.html             ← App shell
    app.js                 ← All app logic
    style.css              ← Design system
    firebase-config.js     ← YOUR Firebase credentials (fill in)
    manifest.json          ← PWA manifest
    sw.js                  ← Service Worker (offline support)
    seed-data.json         ← Pre-generated from your Excel file
    icon-192.png           ← App icon
    icon-512.png           ← App icon (large)
```
