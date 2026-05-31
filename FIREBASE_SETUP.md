# Firebase Setup Guide for Brajwasi Travels

## Step 1: Create Firebase Project
1. Go to https://console.firebase.google.com
2. Click "Add project" → name it `brajwasi-travels`
3. Disable Google Analytics (not needed) → Create project

## Step 2: Enable Authentication
1. In Firebase Console → Authentication → Get started
2. Enable **Google** provider (Sign-in method tab)
3. Enable **Email/Password** provider
4. Add your domain to Authorized Domains: `brajwasi-travels.onrender.com`

## Step 3: Enable Firestore Database
1. Firebase Console → Firestore Database → Create database
2. Choose **Production mode** → select region (asia-south1 for India)
3. Add this Firestore security rule (for mail collection only):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /mail/{document} {
      allow read, write: if false; // Only server (Admin SDK) can write
    }
  }
}
```

## Step 4: Install Trigger Email Extension
1. Firebase Console → Extensions → Browse Extensions
2. Search "Trigger Email from Firestore" → Install
3. Configure:
   - **SMTP connection URI**: `smtps://brajwasitravels.1980@gmail.com:YOUR_APP_PASSWORD@smtp.gmail.com`
   - **Email documents collection**: `mail`
   - **Default FROM address**: `Brajwasi Tour & Travels <brajwasitravels.1980@gmail.com>`
4. Click Install Extension

> Gmail App Password: Google Account → Security → 2FA enabled → App Passwords → create one

## Step 5: Get Service Account Key (for server)
1. Firebase Console → Project Settings (gear icon) → Service accounts
2. Click "Generate new private key" → Download JSON file
3. Open the JSON file, copy ALL content

## Step 6: Set Render Environment Variables
In your Render dashboard → Environment:

```
FIREBASE_SERVICE_ACCOUNT = {"type":"service_account","project_id":"...","private_key":"..."}
                           (paste the entire JSON on one line — use a JSON minifier)
```

Also add your Firebase Web Config values to index.ejs (lines 3-7 in the Firebase script block):
```
apiKey:     "AIzaSy..."     ← Firebase Console → Project Settings → Web app config
authDomain: "brajwasi-travels.firebaseapp.com"
projectId:  "brajwasi-travels"
```

## Step 7: Add Web App Config to index.ejs
In Firebase Console → Project Settings → scroll to "Your apps" → Add app (</> Web)
Copy the firebaseConfig object and paste into index.ejs replacing the placeholder values.

## What Firebase does in this app:
- **Email OTP**: Brajwasi server generates 6-digit OTP → stored in user session → sent via Firebase Trigger Email Extension (writes to Firestore `mail` collection → Extension sends via Gmail SMTP)
- **Google Sign-In**: Firebase client SDK handles OAuth popup → server verifies Firebase ID token → creates session
- **All booking emails** (confirmation, partner assignment, etc.) → go through Firebase Trigger Email Extension
- **No nodemailer**: removed completely — no Gmail App Password on server needed

## Benefits over nodemailer:
✅ Emails go through Google infrastructure (better deliverability)
✅ Google Sign-In — users can login with 1 click
✅ No Gmail "Less secure app" issues
✅ Firebase Console shows email delivery logs
✅ Free tier: 30,000 emails/month
