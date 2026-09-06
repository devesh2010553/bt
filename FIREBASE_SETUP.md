# Firebase Auth Setup — 100% Free, No Gmail/SMTP

## Customer login now uses ONLY Firebase (v11 change)
- **Google Sign-In** — Firebase Authentication free tier: unlimited users
- **Email Link ("magic link") Sign-In** — replaces the old Gmail-SMTP 6-digit OTP. Firebase sends the email itself; nothing to configure, no Gmail App Password needed.
- Admin/partner notification emails (booking assigned, partner approved, etc.) go through **Brevo's HTTPS email API** — NOT SMTP. This matters because Render's free web-service tier permanently blocks outbound SMTP ports (25/465/587); Gmail SMTP via nodemailer can never connect from a free Render instance, which is what caused the "rolling and rolling" hangs. Brevo's API is a normal HTTPS call (port 443), which Render never blocks, and it's free for 300 emails/day. These calls are also **fire-and-forget** — if Brevo is down or unset, the admin action still completes instantly.

## Step 0: Brevo setup (for admin/partner notification emails — optional but recommended)
1. Sign up free at https://www.brevo.com (no credit card)
2. Senders, Domains & Dedicated IPs → **Senders** → add & verify `brajwasitravels.1980@gmail.com` (or your business address) — Brevo emails you a confirmation link
3. Settings (top right) → **SMTP & API** → API Keys → **Generate a new API key** → copy it
4. Set `BREVO_API_KEY` on Render to that key, and `EMAIL_FROM` to the verified sender address


## Step 1: Firebase Console setup
1. https://console.firebase.google.com → your project → **Authentication → Sign-in method**
2. Enable **Google**
3. Enable **Email/Password** provider, then toggle on **Email link (passwordless sign-in)** inside it
4. **Authentication → Settings → Authorized domains** → add every domain you serve the site from (e.g. `brajwasi-travels.onrender.com`, your custom domain, and `localhost` for local dev)

## Step 2: Web App Config (views/index.ejs and views/payment.ejs)
Firebase Console → Project Settings (gear) → "Your apps" → Web app → copy the config, and replace the `YOUR_FIREBASE_API_KEY` / `YOUR_PROJECT...` placeholders in both files (search for `YOUR_FIREBASE`).

## Step 3: Service Account (server-side Google/Email-Link token verification — same for both)
1. Firebase Console → Project Settings → Service accounts → Generate new private key
2. Minify the downloaded JSON to one line → set as `FIREBASE_SERVICE_ACCOUNT` on Render

## Step 4: Render Environment Variables
```
MONGODB_URI              = mongodb+srv://...
SESSION_SECRET           = any_random_long_string
ADMIN_USERNAME           = admin
ADMIN_PASSWORD           = yourpassword
FIREBASE_SERVICE_ACCOUNT = {"type":"service_account","project_id":"...","...":"..."}
VAPID_PUBLIC_KEY         = (from web-push keygen)
VAPID_PRIVATE_KEY        = (from web-push keygen)
VAPID_EMAIL              = mailto:brajwasitravels.1980@gmail.com
DRIVER_SECRET            = any_secret_word
UPI_ID                   = yourname@upi

# OPTIONAL — only needed for admin/partner notification emails via Brevo (see Step 0 above).
# Leave unset and the app works perfectly; those emails are just skipped.
BREVO_API_KEY            = xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM               = brajwasitravels.1980@gmail.com   ← must be a Brevo-verified sender
EMAIL_TO                 = brajwasitravels.1980@gmail.com   ← where new-booking/new-partner alerts go
```

## Login flow for customers (v11)
- **Google**: Click "Continue with Google" → Firebase popup → instant login.
- **Email Link**: Enter email → Firebase emails a sign-in link directly (no server/Gmail involved) → customer opens it on the same device/browser → auto-logged in, no code to type.

## Cost: ₹0/month
Firebase Authentication (Google + Email Link): FREE unlimited · MongoDB Atlas free tier · Render free tier.
