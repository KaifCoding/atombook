# Publishing setup (for the AtomBook publisher)

Users never need this page. It is the one-time Google and hosting setup I do before releasing
builds with Drive sync. User guide: [SYNC-GUIDE.md](SYNC-GUIDE.md).

## 1. Google Cloud project

Create one project and keep every client ID in it (web, desktop, Android), so all devices reach
the same hidden Drive folder.

1. Enable the **Google Drive API** (APIs & Services → Library).
2. **Google Auth Platform → Branding** (the page that asks for the app details):

   | Field | Value |
   |---|---|
   | App name | AtomBook |
   | User support email | kaif@atomprod.in |
   | App logo | `public/icon-512.png` (optional) |
   | Application home page | https://atombook.atomprod.in |
   | Application privacy policy link | https://atombook.atomprod.in/privacy/ |
   | Authorized domains | atomprod.in |
   | Developer contact email | kaif@atomprod.in |

   The privacy page is part of the app (`app/privacy/page.tsx`). Deploy the site first, so the
   link works when Google checks it. The home page footer links to it as Google requires.
3. **Data Access**: add the scope `https://www.googleapis.com/auth/drive.appdata`.
4. **Audience**: choose External, then **Publish app** (In production). While it says "Testing",
   only listed test users can sign in and sign-ins expire after 7 days.

## 2. OAuth clients (Credentials → Create credentials → OAuth client ID)

| Type | Settings | Build value |
|---|---|---|
| Web application | Authorized JavaScript origins: `https://atombook.atomprod.in` | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (hosting) |
| Desktop app | none | `GOOGLE_DESKTOP_CLIENT_ID` (GitHub variable), `GOOGLE_DESKTOP_CLIENT_SECRET` (GitHub secret) |
| Android | Package `in.atomprod.atombook`, SHA-1 of the release signing key, Advanced → **Enable custom URI scheme** | `GOOGLE_ANDROID_CLIENT_ID` (GitHub variable) |

SHA-1 of the signing key: `keytool -list -v -keystore <file>.jks -alias <alias>`.
A debug build has another key and needs its own Android client.

## 3. Where the values go

- GitHub → Settings → Secrets and variables → Actions. Use the names above, **without**
  `NEXT_PUBLIC_`; the release workflow adds the prefix.
- Hosting dashboard (Netlify / Cloudflare Pages / Vercel): `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
- Signing: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`,
  `ANDROID_KEY_ALIAS` (secrets).
- Never commit `.env`, a `.jks` keystore or the desktop client secret.

## 4. Hosting

Build command `npm run build`, output folder `out`, at the root of a domain
(`https://atombook.atomprod.in/`). `netlify.toml`, `vercel.json` and `public/_headers` are included.
After changing an environment value, redeploy.
