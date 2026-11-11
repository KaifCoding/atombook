# Run AtomBook as an online app (with Google Drive sync)

AtomBook can be hosted as a normal website. Open it on your phone and computer, install it
from the browser menu ("Install app" / "Add to Home screen"), and turn on **Google Drive sync**
in Settings so both devices share the same data.

- No server and no database of your own: the site is only static files.
- Your data is stored in a hidden app folder of **your own Google Drive**. AtomBook uses the
  `drive.appdata` permission, which cannot see any of your other Drive files.
- It still works offline. Changes sync when you are back online.

There are two one-time steps: **A. get a Google Client ID** and **B. host the site**.

## A. Create a Google OAuth Client ID (about 5 minutes)

1. Open <https://console.cloud.google.com/> and create a project (any name, e.g. "AtomBook").
2. **APIs & Services → Library**: search for **Google Drive API** and click **Enable**.
3. **APIs & Services → OAuth consent screen** (shown as *Google Auth Platform* in newer consoles):
   - User type **External**, fill in app name and your email.
   - Under **Data access / Scopes** add `https://www.googleapis.com/auth/drive.appdata`.
   - **Publish the app** ("In production"). If you leave it in *Testing*, Google signs you out every
     7 days and only listed test users can log in. This scope is non-sensitive, so no Google review
     is normally needed. If Google shows an "unverified app" warning, choose Advanced → continue.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Web application**.
   - **Authorized JavaScript origins**: add your site address, e.g. `https://atombook.example.com`,
     and `http://localhost:3000` if you want to test locally. No redirect URI is needed.
5. Copy the **Client ID** (`…apps.googleusercontent.com`). It is public, not a secret.

## B. Host the site

Build command `npm run build`, output folder `out`. Add the environment variable
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` with your Client ID, then deploy.

| Host | Steps |
|---|---|
| **Netlify** | Import the GitHub repo. `netlify.toml` already sets build + publish. Add the env var under Site settings → Environment variables. |
| **Cloudflare Pages** | Connect the repo, framework "None", build `npm run build`, output `out`, add the env var. |
| **Vercel** | Import the repo (static export is detected). Add the env var. `vercel.json` sets the headers. |

Host it at the **root of a domain** (`https://something.example.com/`), not in a sub-folder.
GitHub Pages project sites (`user.github.io/repo/`) are therefore not supported.

No env var? Open Settings in the deployed site and paste the Client ID into the sync card; it is
then remembered in that browser only. Setting it at build time is easier for all your devices.

## Using it

1. On the first device: Settings → **Connect Google Drive**. Pick your Google account.
2. On the second device: open the same site, Settings → **Connect Google Drive**, same account.
   A device with no data simply downloads yours.
3. If both devices already hold separate data, you are asked to pick one side. Two separate data
   sets cannot be merged safely because document numbers would clash. Use **Download a backup**
   in that dialog first if unsure.

## How sync behaves

- Each device writes only its own file in the hidden Drive folder, and reads the others. There is
  no server logic and no write conflicts.
- Per record the **most recently edited copy wins**. Deletes are tracked and do not come back.
- If two offline devices issue the same invoice number, the later-created one is renumbered
  automatically and you are told. Before saving a new document, the app first fetches other
  devices' changes when online.
- Access tokens last an hour and cannot be renewed without a server. The app renews silently
  when it can; otherwise the sync chip changes to **Reconnect Google** (one tap).
- Sync copies mistakes too. Keep taking backups from Settings.
- **Delete Drive copy** removes the cloud files and turns sync off on all devices; local data stays.

## Limits

- Sync is for the online (browser / installed web app) version. The Android and desktop installers
  keep data on the device only, because Google blocks sign-in inside embedded web views.
- Clock errors on a device can make an older edit look newer. Keep device clocks automatic.
- Fully offline for weeks on two devices that edit the same records means "newest edit wins".
