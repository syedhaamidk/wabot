```
██╗    ██╗ █████╗ ██████╗  ██████╗ ████████╗
██║    ██║██╔══██╗██╔══██╗██╔═══██╗╚══██╔══╝
██║ █╗ ██║███████║██████╔╝██║   ██║   ██║
██║███╗██║██╔══██║██╔══██╗██║   ██║   ██║
╚███╔███╔╝██║  ██║██████╔╝╚██████╔╝   ██║
 ╚══╝╚══╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝   ╚═╝
```

<div align="center">

**Schedule WhatsApp messages. Auto-reply when you're away. Manage templates.**
*All from a clean, self-hosted web dashboard.*

[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![Railway](https://img.shields.io/badge/deploy-Railway-blueviolet?style=flat-square&logo=railway)](https://railway.app)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

</div>

---

## ✦ Features

| | Feature | Description |
|---|---|---|
| 📅 | **Message Scheduler** | Send WhatsApp messages at any future date and time |
| 🤖 | **Auto-Reply** | Automatically reply when you're busy or away |
| 📝 | **Templates** | Save and reuse your most-sent messages |
| 🗑️ | **Trash & Restore** | Cancelled messages go to trash — restore anytime |
| 🔐 | **Auth** | Email/password or Google OAuth sign-in |
| 🌙 | **Theme** | Dark/light mode, follows your OS preference |
| 📱 | **Mobile-first** | Fully responsive — works on phone, tablet, desktop |

---

## ⚡ Quick Start

### 1 · Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/wabot.git
cd wabot
npm install
```

### 2 · Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```env
# Required — generate with: openssl rand -hex 64
JWT_SECRET=your_secret_here

# Optional — for Google sign-in
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
BASE_URL=https://yourapp.up.railway.app
```

### 3 · Set up public folder

```bash
mkdir public
cp login.html dashboard.html favicon.* public/
```

### 4 · Run

```bash
node index.js
# → Server running on port 3000
```

Open **http://localhost:3000**, create an account, and scan the QR code on the Setup page.

---

## 🚂 Deploy to Railway

```
1. Push this repo to GitHub
2. railway.app → New Project → Deploy from GitHub repo
3. Add a Volume  →  mount path: /data
4. Set environment variables (see below)
5. Deploy — done.
```

**Required variables on Railway:**

```
JWT_SECRET          →  any long random string (64+ chars)
BASE_URL            →  https://your-app.up.railway.app
DATA_DIR            →  /data
GOOGLE_CLIENT_ID    →  from Google Cloud Console  (optional)
GOOGLE_CLIENT_SECRET→  from Google Cloud Console  (optional)
```

> **Google OAuth setup:** Console → APIs & Services → Credentials → OAuth 2.0 Client ID
> Add authorized redirect URI: `https://your-app.up.railway.app/api/auth/google/callback`

---

## 🗂 Project Structure

```
wabot/
│
├── index.js              ← Express server + all API routes
├── auth.js               ← JWT auth, signup/login, Google OAuth
├── scheduler.js          ← Message scheduling, retry logic, persistence
├── autoreply.js          ← Auto-reply config and message handler
├── templates.js          ← Template CRUD operations
│
├── public/
│   ├── login.html        ← Login & signup page
│   ├── dashboard.html    ← Main app (SPA)
│   └── favicon.*         ← Icons
│
├── data/                 ← Auto-created — user data & WA sessions
│   └── {userId}/
│       ├── scheduled.json
│       ├── trash.json
│       ├── autoreply.json
│       ├── templates.json
│       └── .wwebjs_auth/
│
├── .env.example          ← Environment variable reference
├── .gitignore
├── Dockerfile
└── package.json
```

---

## 🔌 API Reference

All routes under `/api/*` (except auth) require `Authorization: Bearer <token>`.

```
POST   /api/auth/signup              Create account
POST   /api/auth/login               Sign in
GET    /api/auth/google              Google OAuth redirect
GET    /api/auth/google/callback     Google OAuth callback

GET    /api/status                   WhatsApp connection status
GET    /api/qr-data                  QR code (base64)
POST   /api/logout-whatsapp          Disconnect WhatsApp

GET    /api/contacts                 List contacts (5min cached)
POST   /api/contacts/refresh         Bust contacts cache

GET    /api/scheduled                List scheduled messages
POST   /api/scheduled                Schedule a new message
PATCH  /api/scheduled/:id            Edit a pending message
DELETE /api/scheduled/:id            Cancel → moves to trash

GET    /api/trash                    List trashed messages
POST   /api/trash/:id/restore        Restore from trash
DELETE /api/trash/:id                Permanently delete

GET    /api/autoreply                Get auto-reply config
PUT    /api/autoreply                Update auto-reply config

GET    /api/templates                List templates
POST   /api/templates                Create template
PATCH  /api/templates/:id            Update template
DELETE /api/templates/:id            Delete template
POST   /api/templates/:id/use        Insert template body + record usage
```

---

## 🛡 Security

- Passwords hashed with **PBKDF2** (100,000 iterations, SHA-512)
- **Timing-safe** JWT verification (prevents timing attacks)
- Rate limiting on auth routes (10 req/min)
- HTTP security headers via **Helmet**
- Google OAuth tokens exchanged server-side (never in URL hash)
- Server `.js` files blocked from static serving

---

## 📦 Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 4 |
| WhatsApp | whatsapp-web.js |
| Auth | Custom JWT (HS256) + Google OAuth |
| Storage | JSON files (no database needed) |
| Scheduling | Native `setTimeout` with retry backoff |
| Frontend | Vanilla JS SPA, Inter font, Flatpickr |

---

## 🔧 Troubleshooting

**QR code not appearing**
→ Check Railway logs for `[WA:xxx] QR ready`. If missing, Chromium may have crashed. Ensure `--no-sandbox` flag is set.

**Contacts not loading**
→ Takes 10–30s on first load — WhatsApp has to sync. Wait, then try again. If empty, check logs for `[Contacts:xxx] N contacts`.

**Google OAuth not working**
→ Verify `BASE_URL` has no trailing slash. Check the redirect URI in Google Console matches exactly: `{BASE_URL}/api/auth/google/callback`

**Messages not sending**
→ Check that WhatsApp shows "Connected" in the Setup page. Messages queued while offline will retry automatically when reconnected.

---

<div align="center">
<sub>Built with whatsapp-web.js · Self-hosted · No third-party message brokers</sub>
</div>
