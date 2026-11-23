# HOME OS ULTIMATE — Deploy guide (phone only)

Everything is prepared in this repo. Two things need you, both doable from your phone's browser.

## 1. Supabase settings (2 minutes)

1. Open https://supabase.com/dashboard/project/aryqfkfgdeajdnoqgxxu and sign in.
2. Left menu: **Authentication** → **Sign In / Providers** → **Email**.
3. Turn **Confirm email** OFF → **Save**. (The app has no email-inbox step, so confirmation must be off or new family members can't sign in.)
4. After the site is live (step 3 below), go to **Authentication** → **URL Configuration**:
   - **Site URL**: your GitHub Pages address, e.g. `https://<username>.github.io/home-os-ultimate/`
   - **Add URL** under Redirect URLs: the same address.
   - **Save**.
5. If you haven't finished the database setup page yet, finish parts 1–10 first: https://files.instinct.com/242ff38mp3c9-home-os-ultimate-database-setup

## 2. GitHub: one access token (3 minutes)

The code is pushed for you; GitHub just needs proof it's you.

1. Open https://github.com/settings/tokens on your phone and sign in.
2. Tap **Generate new token** → **Generate new token (classic)**.
3. Name: `homeos-deploy`. Expiration: 7 days is enough.
4. Check the **repo** box (the top checkbox, covers everything needed).
5. Scroll down → **Generate token**.
6. Copy the token (starts with `ghp_`) and paste it into the secure link Instinct sends you. Never send it as a normal message.

With that token Instinct will: create the `home-os-ultimate` repository, push this code, enable GitHub Pages, and start the build.

## 3. What happens automatically (about 5 minutes)

The included GitHub Actions workflow (`.github/workflows/deploy.yml`) does two jobs on every push:

- **Web**: builds the app and publishes it to GitHub Pages at `https://<username>.github.io/home-os-ultimate/` — that is your live family app, installable to the home screen from Chrome ("Add to Home screen").
- **APK**: builds an installable Android APK in the cloud and attaches it to a release named **HOME OS ULTIMATE APK** (tag `apk-latest`). On your phone open the repo → **Releases** → download `app-debug.apk` → tap it → allow **install unknown apps** when Android asks.

The APK is a debug build signed with Android's standard debug key — fine for family use, not for Play Store upload.

## Notes

- The Supabase publishable key in `.env.production` is public-by-design; row level security protects every table.
- To update the app later: any push to `main` redeploys web + rebuilds the APK.
- Local dev: `npm ci`, then `npm run dev` (cloud) or `VITE_DEMO_MODE=1 npm run dev` (offline demo).
