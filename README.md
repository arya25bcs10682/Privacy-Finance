# PrivacyFinance (ZK-Vault)

A privacy-first personal finance app. Upload your bank statement PDF, and PrivacyFinance uses an LLM to turn it into structured transactions, verifies them with balance checks, and shows a dashboard of balances, spending, budgets, bills and investments. Everything is stored encrypted with a key only you know, so the database only ever holds ciphertext.

- **Live app:** [ADD DEPLOYED URL]
- **Demo video:** [ADD VIDEO URL]
- **Repository:** https://github.com/arya25bcs10682/privacyFinance
- **Author:** Arya Kumar

---

## Problem Statement

Most personal finance apps ask you to hand over bank credentials or upload raw statements to a server that can read everything. Bank statements contain highly sensitive information (income, spending habits, account details). Tracking expenses by hand in spreadsheets is the private alternative, but it is slow and error-prone, and every bank formats its statements differently.

## Target Users

Individuals in India (and small groups such as family or friends) who hold accounts with **HDFC, ICICI or SBI**, want a clear picture of their income, spending and investments without manual data entry, and care about who can read their financial data.

## Solution

PrivacyFinance combines **LLM-based statement parsing** with **zero-knowledge storage**:

1. **Sign up with two secrets.** A login password, and a separate *secret key* that never leaves the browser.
2. **Unlock and extract locally.** The browser unlocks the (optionally password-protected) PDF and extracts the text using pdfjs-dist. Sensitive identifiers such as account numbers are redacted by regex.
3. **Parse with an LLM.** The redacted page text is sent through the backend to the Google Gemini API, which returns structured transactions (date, narration, debit/credit, amount, balance). No bank-specific parsing scripts are used, so the same pipeline handles different bank layouts.
4. **Verify.** Every row is validated with a running-balance check (previous balance ± amount = new balance). Rows that fail are flagged for review, where the user can fix or exclude them.
5. **Deduplicate and encrypt.** Each transaction gets a per-user HMAC fingerprint so re-uploading an overlapping statement skips duplicates. New rows are encrypted in the browser with AES-GCM (256-bit) before being sent to the server.
6. **Analyse locally.** Categorization, balances, budgets and projections run in the browser on decrypted data held only in memory.

The server and MongoDB store only encrypted payloads, so a database leak does not expose readable transactions.

## Key Features

1. **Secure signup and vault unlock**
   Email and password login plus a separate secret key. The master data key is derived in the browser (PBKDF2-SHA256, 600,000 rounds), held in memory only, and cleared after 15 minutes of inactivity. A new device needs the same secret key.
2. **AI-powered statement import with verification**
   Upload an HDFC, ICICI or SBI statement PDF (password-protected PDFs supported). The LLM extracts the transactions, the app validates each row's running balance, shows a review screen (new, duplicate and needs-review rows with inline fix or exclude), and uploads only new rows, encrypted. The summary table at the end of the statement is excluded from parsing, and opening and closing balances are derived from the transactions themselves.
3. **Dashboard**
   Current balance, monthly income and spend, projected month-end cash, a running-balance chart with inflow/outflow colouring, and a spending-by-category breakdown with a month filter.
4. **Budgets and bills**
   Monthly spending limits with progress tracking, and a bills and subscriptions overview with reminders based on recurring payments.
5. **Investment tracking**
   Add holdings you already own (symbol, units, average buy price, optional purchase date). The app fetches live prices and shows invested amount, current value, and profit/loss per holding and for the whole portfolio, plus an allocation chart.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS, shadcn/ui, Recharts |
| Backend | Node.js, Express |
| Database | MongoDB Atlas with Mongoose |
| Auth | JWT-based sessions, hashed passwords |
| Cryptography | Web Crypto API (PBKDF2-SHA256, AES-GCM 256, HMAC-SHA256) |
| PDF text extraction | pdfjs-dist (in the browser) |
| Statement parsing | Google Gemini API (called through the backend, with retry and model fallback) |
| Market data | yahoo-finance2 (via backend proxy) |
| Hosting | [Vercel / Cloudflare Pages] (frontend), [Render] (backend), MongoDB Atlas |

## Architecture

```
                         BROWSER (trusted zone)
 ┌──────────────────────────────────────────────────────────────┐
 │ Secret key ──PBKDF2──► wrapping key ──► master data key      │
 │                                          (memory only)       │
 │                                                              │
 │ Statement PDF ─► unlock + extract text (pdfjs-dist)          │
 │               ─► redact identifiers ─► drop summary section   │
 │               ─► split into chunks                           │
 └───────────────────────────┬──────────────────────────────────┘
                             │ redacted text chunks
                             ▼
                  ┌─────────────────────┐        ┌──────────────┐
                  │ Express /api/parse  │───────►│  Gemini API  │
                  │ retry, model        │◄───────│ text → JSON  │
                  │ fallback, no logging│  rows  └──────────────┘
                  └──────────┬──────────┘
                             │ structured rows
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ BROWSER: validate balances ─► review/fix ─► HMAC fingerprint │
 │          (dedupe) ─► AES-GCM encrypt                         │
 └───────────────────────────┬──────────────────────────────────┘
                             │ ciphertext only
                             ▼
                  ┌─────────────────────┐        ┌──────────────┐
                  │ Express API         │───────►│ MongoDB Atlas│
                  │ auth, per-user      │        │ ciphertext + │
                  │ scoping             │        │ minimal meta │
                  └──────────┬──────────┘        └──────────────┘
                             │ non-sensitive market quotes
                             ▼
                       yahoo-finance2
```

**Main components**

- `client/`: React single-page app with the crypto module, PDF extraction and redaction, parse orchestration and validation, dashboard, budgets, bills and investments pages.
- `server/`: Express API handling authentication, encrypted-data storage (every query scoped to the authenticated user), the LLM parsing endpoint, and the market data proxy.
- **Key design decisions:** a wrapped master data key (the secret key can change without re-encrypting everything), a fresh random IV for every encryption, a per-user HMAC for transaction fingerprints, sequential LLM requests with retry and fallback models, and an append-only insert model that skips duplicates.

> Folder names may differ slightly. Adjust this section to match the repository layout.

## Privacy and Security Notes

- **What is zero-knowledge:** storage. The secret key, derived keys and decrypted data live in browser memory only, never in localStorage or on the server. The database holds ciphertext.
- **What is not:** statement parsing. The redacted text of each statement page is processed by the Google Gemini API. The backend relays it without storing or logging it, but the AI provider does receive that text. Redaction reduces, but cannot guarantee removal of, all identifying details in narrations.
- PDF passwords are used only in the browser to unlock the file and are never sent anywhere.
- Every database query is scoped to the authenticated user's id taken from the verified token.
- Passwords are hashed, secrets live in environment variables, and nothing sensitive is committed.
- **Losing the secret key means losing access to the encrypted data.** The server cannot recover it.

## Local Setup

**Prerequisites:** Node.js 18+ (LTS), npm, a MongoDB Atlas cluster (free tier works), and a Google AI Studio API key.

```bash
# 1. Clone
git clone [REPO_URL]
cd [REPO_FOLDER]

# 2. Install dependencies
npm install              # or run inside client/ and server/ separately

# 3. Configure environment
cp server/.env.example server/.env
cp client/.env.example client/.env
# then fill in the values (see below)

# 4. Run
npm run dev              # starts client and server
```

- Client: http://localhost:5173 (Vite default)
- Server: http://localhost:5000

## Environment Variables

**Server (`server/.env`)**

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string (URL-encode special characters in the password) |
| `JWT_SECRET` | Long random string for signing tokens |
| `CLIENT_URL` | Frontend origin allowed by CORS |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `GEMINI_MODEL` | Primary model name |
| `GEMINI_FALLBACK_MODELS` | Comma-separated fallback models |
| `PORT` | Server port (default 5000) |

**Client (`client/.env`)**

| Variable | Description |
|---|---|
| `VITE_API_URL` | Base URL of the backend API |

> Check these names against `.env.example` in the repo and correct any that differ. No real values are committed.

## Deployment

- **Frontend:** [Vercel / Cloudflare Pages], with `VITE_API_URL` pointing to the backend.
- **Backend:** Render (free tier). Environment variables are set in the Render dashboard. The free tier sleeps after inactivity, so the first request can take 30-60 seconds.
- **Database:** MongoDB Atlas, with network access allowing the backend host.

Live app: [ADD URL]

## Testing

- Unit tests for the crypto module (round trip, wrong key, tamper detection, IV uniqueness) and the validation logic. Run with `npm test`.
- Test data in this repository is fabricated. No real bank statements are included.

## Known Limitations

- **Privacy trade-off:** because parsing uses a hosted LLM, redacted statement text is sent to the AI provider. Storage is zero-knowledge, parsing is not.
- **LLM accuracy:** the model can misread or skip rows. The running-balance check and the review screen catch most errors, but users should glance at flagged rows before uploading.
- **Free-tier limits:** Gemini free-tier quotas are small and the model is sometimes busy. The app retries with backoff and falls back to other models, but large or repeated uploads can hit daily limits.
- **Statement layouts:** only HDFC, ICICI and SBI statements are targeted. Scanned (image-only) PDFs have no text layer and cannot be parsed.
- **Reminders** are shown inside the app, not sent as push or email notifications.
- **Live prices** come from an unofficial Yahoo Finance library and may occasionally be unavailable.
- **Pdf extraction** this feature use to work but i somehow broke it while reviewing, even llm's are not able to fix it 

## Future Work (something which i actually am working on but i was caught in different things and couldnt finish it)

- Optional on-device model for fully private parsing (mere gemini pe load kam hojayega and be able to process more parser requests)
- Push and email reminders for bills 
- Mutual fund NAV tracking and SIP support (investments tab me ye jayega )
- Secret key rotation and recovery code flow 
- Multi-account support (the problem is nothing is getting openly stored on the database(encrypted) or it is not even being stored in the db and if a user wants to use this website on some other device it will fail kyunki even the database doesnt know a damm thing to kaha se fetch karega)

## AI Usage

AI tools (Google Antigravity and LLM assistants) were used for planning, code generation, debugging and documentation. The application design, integration, testing and deployment were reviewed and verified by the author. The Gemini API is also used inside the product for statement parsing, with deterministic validation around it.
