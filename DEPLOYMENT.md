# Production Deployment Guide: Privacy Finance

This document provides end-to-end instructions for deploying the **Privacy Finance** application with zero-knowledge encryption in production.

---

## Architecture Overview

```
+-----------------------------------+        +-----------------------------------+
|  Client (React + Vite SPA)        |        |  Server (Express API Node.js)     |
|  - Vercel or Cloudflare Pages     | <----> |  - Render Web Service             |
|  - AES-GCM 256 In-Browser Crypto  |  REST  |  - No Plaintext Logging/Storage   |
+-----------------------------------+        +-----------------------------------+
                                                               ^
                                                               | Mongoose TLS
                                                               v
                                             +-----------------------------------+
                                             |  Database (MongoDB Atlas)         |
                                             |  - Encrypted Payloads { iv, ct }  |
                                             +-----------------------------------+
```

---

## 1. Database Setup: MongoDB Atlas

1. **Create an Atlas Account**: Visit [mongodb.com/atlas](https://www.mongodb.com/atlas) and create an organization/project.
2. **Deploy a Free/Shared Cluster**: Select `M0 Sandbox` (Free) in your preferred AWS/GCP region.
3. **Database Access (Security)**:
   - Navigate to **Security > Database Access**.
   - Click **Add New Database User**.
   - Authentication method: `Password`. Provide a username (e.g., `pf_db_user`) and a strong auto-generated password.
   - User Privileges: `Read and write to any database`.
4. **Network Access (IP Whitelist)**:
   - Navigate to **Security > Network Access**.
   - Click **Add IP Address**.
   - Select **Allow Access From Anywhere** (`0.0.0.0/0`) or enter Render's static outbound IP addresses if using a dedicated IP plan.
5. **Get Connection String**:
   - Go to **Clusters > Connect > Drivers > Node.js**.
   - Copy connection URI:
     ```
     mongodb+srv://pf_db_user:<password>@cluster0.xxxxx.mongodb.net/privacy_finance?retryWrites=true&w=majority
     ```

---

## 2. Server Deployment: Render

### Option A: Render Blueprint (`render.yaml`)
1. Fork or push this repository to GitHub/GitLab.
2. In Render Dashboard, click **New > Blueprint**.
3. Select your repository. Render automatically reads [`render.yaml`](./render.yaml).
4. Provide the secret environment variables (`MONGODB_URI`, `CLIENT_URL`, `LLM_API_KEY`).
5. Click **Apply**.

### Option B: Manual Web Service Setup
1. In Render Dashboard, click **New > Web Service**.
2. Connect your Git repository.
3. Configure service parameters:
   - **Name**: `privacy-finance-api`
   - **Region**: `Oregon (US West)` or nearest to Atlas
   - **Branch**: `main`
   - **Root Directory**: Leave blank (uses repo root)
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build -w server`
   - **Start Command**: `npm run start -w server`
   - **Health Check Path**: `/api/health`
4. **Add Environment Variables**:
   | Variable | Value / Description |
   | :--- | :--- |
   | `NODE_ENV` | `production` |
   | `PORT` | `5000` (Render binds to this automatically) |
   | `CLIENT_URL` | Your frontend production URL (e.g., `https://your-app.vercel.app`) |
   | `MONGODB_URI` | Your MongoDB Atlas connection URI string |
   | `JWT_ACCESS_SECRET` | 64-char random hex (`node -e "console.log(crypto.randomBytes(32).toString('hex'))"`) |
   | `JWT_REFRESH_SECRET` | 64-char random hex (`node -e "console.log(crypto.randomBytes(32).toString('hex'))"`) |
   | `LLM_PROVIDER` | `gemini` (or `openai-compatible`) |
   | `LLM_API_KEY` | Google AI Studio or OpenAI API key |
   | `LLM_MODEL` | `gemini-1.5-flash` |
5. Click **Create Web Service**. Your backend will be accessible at `https://privacy-finance-api.onrender.com`.

---

## 3. Client Deployment: Vercel or Cloudflare Pages

### Option A: Vercel
1. In the Vercel Dashboard, click **Add New > Project**.
2. Import your Git repository.
3. Configure Build Settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `./`
   - **Build Command**: `npm run build -w client`
   - **Output Directory**: `client/dist`
4. **Environment Variables**:
   - `VITE_API_URL`: `https://privacy-finance-api.onrender.com/api`
5. Click **Deploy**. Vercel uses [`vercel.json`](./vercel.json) to configure SPA routing and strict CSP headers automatically.

### Option B: Cloudflare Pages
1. In Cloudflare Dashboard, go to **Workers & Pages > Create application > Pages > Connect to Git**.
2. Select repository and configure build settings:
   - **Project Name**: `privacy-finance`
   - **Production Branch**: `main`
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build -w client`
   - **Build Output Directory**: `client/dist`
3. **Environment Variables**:
   - `VITE_API_URL`: `https://privacy-finance-api.onrender.com/api`
4. Click **Save and Deploy**. Cloudflare automatically applies security headers from [`client/public/_headers`](./client/public/_headers).

---

## 4. Post-Deployment Verification

1. **Verify Backend Health**:
   ```bash
   curl -I https://privacy-finance-api.onrender.com/api/health
   ```
   Should return `HTTP/2 200 OK` with JSON `{"status":"ok"}`.
2. **Verify CORS & Cookies**:
   - In production, JWT cookies are set with `SameSite=None; Secure; HttpOnly`.
   - Ensure `CLIENT_URL` matches your frontend domain exactly (including `https://`).
3. **Verify Zero-Knowledge Vault**:
   - Open frontend in a private browsing window.
   - Complete signup: save master secret key and recovery code.
   - Upload a test bank statement (PDF or CSV).
   - Inspect network tab: confirm that payloads sent to `/api/transactions/bulk` contain only `{ iv, ct }` ciphertext blobs.
