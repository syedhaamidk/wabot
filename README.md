# WABot — WhatsApp Message Scheduler

Schedule WhatsApp messages, set up auto-replies, and manage message templates — all from a clean web dashboard.

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set environment variables
Copy `.env.example` to `.env` and fill in values:
```bash
cp .env.example .env
```

**Required:**
- `JWT_SECRET` — generate with: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

**Optional (Google OAuth):**
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BASE_URL`

### 3. Create the public folder
```bash
mkdir public
cp login.html dashboard.html favicon.* public/
```

### 4. Start
```bash
node index.js
```

Open `http://localhost:3000` and sign up.

### 5. Connect WhatsApp
Go to the **Setup** page → scan the QR code with WhatsApp → Linked Devices → Link a Device.

---

## Deploying to Railway

1. Push to GitHub
2. Create a new Railway project → Deploy from GitHub
3. Add a **Volume** mounted at `/data`, set `DATA_DIR=/data`
4. Add env vars: `JWT_SECRET`, `BASE_URL`, optionally Google OAuth vars
5. Railway auto-detects `npm start`

---

## New in v2.1

- **Security:** Helmet HTTP headers, rate limiting on auth, CORS locked to your domain, XSS-safe OAuth callback, token no longer accepted in URL query params
- **Reliability:** Async file writes (no more event loop blocking), debounced saves, proper retry counter logging, contacts server-side cached (5min TTL)
- **Bug fixes:** `PATCH /scheduled` null session crash fixed, shallow merge in autoreply config fixed, overdue restored messages now retry properly, reply log pruned to prevent memory leak
- **UX:** Failed message banner, contacts picker error state, polling pauses when tab is hidden, system dark/light theme detection on both pages, Inter font throughout

---

## Project Structure

```
├── index.js          — Express server, all API routes
├── auth.js           — JWT auth, signup/login, Google OAuth
├── scheduler.js      — Message scheduling, retry logic, persistence
├── autoreply.js      — Auto-reply config and handler
├── templates.js      — Message template CRUD
├── public/
│   ├── login.html    — Login/signup page
│   └── dashboard.html — Main app dashboard
├── data/             — Auto-created, stores user data and WA sessions
├── .env.example      — Environment variable reference
├── Dockerfile        — Railway/Docker deployment
└── package.json
```
