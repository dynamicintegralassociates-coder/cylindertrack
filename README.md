# CylinderTrack — Gas Cylinder Rental Management System

A full-stack web application for managing gas cylinder rentals, deliveries, returns, billing, and customer pricing. Multi-user with login authentication.

## Features

- **Login & User Management** — Password-protected, add colleagues with their own accounts
- **Customer Management** — Add, edit, search customer accounts
- **Cylinder Types & Services** — Tracked cylinders (on-hand + returns) and non-tracked services (billed per sale)
- **Delivery / Return / Sale** — Record cylinder movements and gas supply sales
- **Cylinder Tracking** — Real-time view of what's on-hand at each customer site
- **Monthly Billing** — Auto-calculated rental charges + service sales with customer-specific pricing
- **Pricing Manager** — Bulk update prices across multiple customers, inline editing, override defaults per customer

## Tech Stack

- **Frontend:** React 18, Vite
- **Backend:** Node.js, Express
- **Database:** SQLite (via better-sqlite3) — zero config, single file
- **Auth:** bcrypt password hashing, session cookies

---

## Deploy to Railway (recommended)

### 1. Create a GitHub repo

1. Go to https://github.com/new
2. Name it `cylindertrack`, set to **Private**, tick **"Add a README file"**
3. Click **Create repository**
4. Click **"Add file"** → **"Upload files"**
5. Unzip the download, drag in the **contents** (not the folder): `package.json`, `nixpacks.toml`, `server/`, `client/`, `.gitignore`, `README.md`
6. Click **"Commit changes"**

### 2. Deploy on Railway

1. Go to https://railway.app — sign in with GitHub
2. Click **"New Project"** → **"Deploy from GitHub Repo"**
3. Select your `cylindertrack` repo
4. Railway reads `nixpacks.toml` automatically — **no build/start commands to configure**
5. Under **Settings** → **Networking**, click **"Generate Domain"** to get a public URL
6. Under **Variables**, add: `NODE_ENV` = `production`
7. Deploy

### 3. First-time setup

1. Visit your Railway URL
2. Create your admin account (username + password)
3. Go to **Manage Users** in the sidebar to add your colleague
4. Share the URL and their credentials — they sign in and you both share the same data

---

## Run Locally

### Prerequisites

Node.js 18+ installed. Check with `node --version`.

### Quick start

```bash
npm install
npm run build
npm start
```

Open http://localhost:3001. First visitor creates the admin account.

### Development mode (hot reload)

```bash
npm install
npm run dev
```

Frontend: http://localhost:5173 (with hot reload)
API: http://localhost:3001

---

## Project Structure

```
cylindertrack/
├── package.json          # All dependencies + scripts
├── nixpacks.toml         # Railway build config
├── server/
│   ├── index.js          # Express server
│   ├── db.js             # Database init & migrations
│   ├── routes.js         # API endpoints
│   ├── auth.js           # Login, sessions, user management
│   └── cylindertrack.db  # SQLite database (auto-created)
├── client/
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx       # Full application UI
│       └── api.js        # API client
└── .gitignore
```

## Backup

Your entire database is one file: `server/cylindertrack.db`. Copy it to back up everything.
