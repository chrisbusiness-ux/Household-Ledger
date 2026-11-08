# Household Ledger — setup guide

This app tracks spending, monthly budgets and household supplies, and keeps them in sync across all your devices: phone, tablet and computer. It works offline and catches up when you're back online.

It runs on two free services:
- **Firebase** (by Google) stores your data and handles sign-in. The free "Spark" plan is plenty; no credit card needed.
- **GitHub Pages** hosts the app so it has a web address you can install from.

Setup takes about 30 minutes. Firebase's screens change from time to time, so a button name may differ slightly from what's written here.

## 1. Create the Firebase project
1. Go to https://console.firebase.google.com and sign in with a Google account.
2. Click **Create a project** (or **Add project**). Name it, e.g. `household-ledger`. You can turn off Google Analytics.

## 2. Turn on email sign-in
1. In the left menu: **Build → Authentication → Get started**.
2. Under **Sign-in method**, choose **Email/Password**, switch it on, and save.

## 3. Create the database and lock it to your household
1. **Build → Firestore Database → Create database**. Pick a location near you and start in **production mode**.
2. Open the **Rules** tab. Replace everything with the contents of `firestore.rules` from this folder.
3. Replace `you@example.com` with your own email address, in lowercase.
4. Click **Publish**.

Only that email can see or change your data, and only once you've confirmed it.

## 4. Get your app settings
1. Click the gear icon → **Project settings**.
2. Under **Your apps**, click the web icon `</>`. Name it `Household Ledger`. Don't tick Firebase Hosting. Click **Register app**.
3. You'll see a block of code containing `const firebaseConfig = { apiKey: ..., authDomain: ..., ... }`. Keep this page open; you'll copy those values in step 6.

## 5. Put the app on GitHub Pages
1. Sign in or create an account at https://github.com.
2. Click **+ → New repository**. Name it `household-ledger`, set it to **Public**, and create it.
3. Click **uploading an existing file**. Drag in **everything inside this folder**, including the `icons` folder. Click **Commit changes**.
4. Go to the repository's **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
5. After a minute or two, your app's address appears at the top of that page. It looks like `https://YOUR-USERNAME.github.io/household-ledger/`.

## 6. Connect the app to Firebase
1. In your GitHub repository, click `config.js`, then the pencil icon to edit it.
2. Replace each placeholder value with the matching value from step 4 (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`). Keep the quotes.
3. Click **Commit changes**.

These values are meant to be public. Your data is protected by the rules from step 3, not by hiding this key.

## 7. Allow your web address to sign in
1. In Firebase: **Authentication → Settings → Authorized domains → Add domain**.
2. Enter `YOUR-USERNAME.github.io` (no `https://`, no `/household-ledger`).

## 8. Sign in and install on each device
1. Open your app's address on your phone.
2. Tap **Create an account** and use the email from step 3. Open the confirmation email, tap the link, then return to the app and tap **Continue**.
3. On the first sign-in, tap **Add suggestions** to start with common categories and supplies, or build your own.
4. Install it:
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
   - **Android (Chrome):** tap **Install app** in the app's header, or ⋮ menu → **Install app** / **Add to Home screen**.
5. On every other device, open the same address and tap **Sign in** with the same email and password. Don't create a second account. Then install it the same way.

## Everyday use
- **Supplies:** tap − when you use one up and + when you add one. **Restock** adds what you bought and, if you enter a cost, logs it as an expense.
- **Forgot your password:** tap **Forgot password?** on the sign-in screen.
- **Updating the app:** upload changed files to GitHub the same way. Devices pick up the new version the next time the app is opened online, sometimes after a second open.

## Files
| File | What it does |
| --- | --- |
| `index.html` | The app's layout and styles |
| `app.js` | The app's logic: screens, sign-in and syncing |
| `config.js` | Your Firebase settings (you fill this in) |
| `firestore.rules` | Who may read and write your data (paste into Firebase) |
| `manifest.webmanifest`, `icons/` | Name and icon for installing |
| `sw.js` | Lets the app open without internet |
