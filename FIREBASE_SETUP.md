# Firebase + Email Setup — 100% Free

## What uses Firebase (free forever)
- **Google Sign-In only** — Firebase Authentication free tier: unlimited users

## What uses Gmail SMTP (free)
- All OTP emails, booking confirmations, partner emails — via nodemailer + Gmail

---

## Step 1: Create Firebase Project (for Google Sign-In)
1. Go to https://console.firebase.google.com
2. Click "Add project" → name: `brajwasi-travels` → Create
3. Authentication → Get started → Sign-in method → Enable **Google**
4. Authorized domains → Add: `brajwasi-travels.onrender.com`

## Step 2: Get Web App Config (paste into index.ejs)
1. Firebase Console → Project Settings (gear) → "Your apps" → Add app → Web (</>)
2. Register app name `brajwasi-web` → Copy the firebaseConfig object
3. In `views/index.ejs` replace these lines (search for `YOUR_FIREBASE`):
```js
apiKey:     "AIzaSy..."
authDomain: "brajwasi-travels.firebaseapp.com"
projectId:  "brajwasi-travels"
```
Same in `views/payment.ejs`

## Step 3: Get Service Account Key (for Google Sign-In token verification on server)
1. Firebase Console → Project Settings → Service accounts tab
2. Click "Generate new private key" → Download JSON
3. Open JSON file → copy ALL content → go to Render dashboard

## Step 4: Set Render Environment Variables
```
MONGODB_URI              = mongodb+srv://...
EMAIL_USER               = brajwasitravels.1980@gmail.com
EMAIL_PASS               = xxxx xxxx xxxx xxxx   ← Gmail App Password (NOT your gmail password)
EMAIL_TO                 = brajwasitravels.1980@gmail.com
UPI_ID                   = yourname@upi
SESSION_SECRET           = any_random_long_string
ADMIN_USERNAME           = admin
ADMIN_PASSWORD           = yourpassword
FIREBASE_SERVICE_ACCOUNT = {"type":"service_account","project_id":"brajwasi-travels",...}
                           (paste entire JSON minified to ONE line — use jsonformatter.org/minify)
VAPID_PUBLIC_KEY         = (from web-push keygen)
VAPID_PRIVATE_KEY        = (from web-push keygen)
VAPID_EMAIL              = mailto:brajwasitravels.1980@gmail.com
DRIVER_SECRET            = any_secret_word
```

## How to get Gmail App Password
1. Google Account (brajwasitravels.1980@gmail.com) → Security
2. Enable 2-Step Verification (if not already)
3. Security → App passwords → Select app: Mail → Select device: Other → "Brajwasi Server"
4. Copy the 16-character password → paste as EMAIL_PASS in Render

## Cost: ₹0/month
- Firebase Authentication: FREE (unlimited)
- Gmail SMTP via nodemailer: FREE (500 emails/day)
- MongoDB Atlas free tier: FREE (512MB)
- Render free tier: FREE

## Login flow for customers:
Option A (Google): Click "Continue with Google" → Firebase popup → instant login
Option B (Email OTP): Enter email → receive 6-digit OTP via Gmail → verify → logged in
