# Privacy-First Personal Finance Monorepo

A zero-knowledge, privacy-focused personal finance web application built on the MERN stack with modern TypeScript tooling, Tailwind CSS, shadcn/ui components, and Recharts.

---

## Workspace Architecture

```
end-term-project/
├── client/                      # Frontend Application (React 19, Vite, TypeScript)
│   ├── src/
│   │   ├── components/
│   │   │   ├── auth/            # LoginForm, SignupModal, LockScreen
│   │   │   └── ui/              # shadcn/ui primitives (Button, Card, etc.)
│   │   ├── context/
│   │   │   ├── KeyContext.tsx   # React KeyContext provider (in-memory key storage & 15m idle lock)
│   │   │   └── KeyContext.test.tsx
│   │   ├── lib/
│   │   │   ├── api.ts           # API client with credentials: "include" for httpOnly cookies
│   │   │   ├── crypto/          # Web Crypto library (AES-GCM, PBKDF2, HKDF, recovery code)
│   │   │   └── utils.ts         # Tailwind clsx + twMerge utility
│   │   ├── test/                # Setup & jsdom polyfills
│   │   ├── App.tsx              # App layout with Router, KeyProvider, and Vault Status
│   │   ├── index.css            # Base Tailwind layers & design system CSS tokens
│   │   └── main.tsx             # React DOM root
│   ├── components.json          # shadcn/ui configuration
│   ├── eslint.config.js         # ESLint (flat config) + React hooks/refresh plugins
│   ├── package.json             # React 19, Vite, Tailwind, Recharts, React Router
│   ├── tailwind.config.ts       # Tailwind config mapped to project theme tokens
│   └── vite.config.ts           # Vite + Vitest configuration
│
├── server/                      # Backend API Server (Node, Express, TypeScript, Mongoose)
│   ├── src/
│   │   ├── config/db.ts         # MongoDB connection helper (Mongoose)
│   │   ├── middleware/auth.ts   # requireAuth middleware strictly extracting userId from JWT
│   │   ├── models/User.ts       # User model storing email, passwordHash, keySalt, wrapped keys
│   │   ├── routes/auth.ts       # Signup, login, refresh, logout, me endpoints
│   │   ├── utils/jwt.ts         # Access & refresh tokens, httpOnly cookie helpers
│   │   ├── app.ts               # Express factory, Helmet, CORS, rate limiting, cookies
│   │   ├── auth.test.ts         # Auth endpoints Vitest suite with Supertest
│   │   └── index.ts             # Server entry loading dotenv & listening on port
│   ├── package.json             # Express, Mongoose, bcryptjs, jsonwebtoken, helmet, etc.
│   ├── tsconfig.json            # Strict TypeScript configuration
│   └── vitest.config.ts         # Vitest node test runner configuration
│
├── .gitignore                   # Workspace gitignore
├── .prettierignore              # Prettier ignore rules
├── .prettierrc                  # Shared Prettier configuration
├── package.json                 # Monorepo workspaces definition and unified scripts
├── rules.md                     # Core project rules & security requirements
└── README.md                    # Setup and run instructions
```

---

## Zero-Knowledge Architecture & Project Rules

1. **Zero-Knowledge Data Flow**:
   - The user's master Secret Key is **never** sent over the wire, never stored in MongoDB, and never stored in `localStorage` or `sessionStorage`.
   - The server stores only:
     - `email`: Normalized user identifier.
     - `passwordHash`: bcrypt hash for server authentication.
     - `keySalt`: Random 16-byte salt for client-side PBKDF2 key derivation.
     - `wrappedDataKey`: AES-GCM master data key wrapped with the secret-derived key (`AES-KW`).
     - `wrappedDataKeyByRecovery`: Master data key wrapped with the recovery code key.
2. **Two-Factor Authentication / Key Separation (Rule 3)**:
   - Login password authenticates with Express.
   - Secret Key decrypts financial records inside browser memory.
3. **In-Memory Key Lifecycle & Auto-Lock (Rule 2)**:
   - All `CryptoKey` instances live exclusively in React memory (`KeyContext`).
   - After **15 minutes of user inactivity** (no mouse, touch, scroll, or keyboard), keys are wiped from memory and the vault locks.
   - On explicit logout, cookies are cleared and all keys are wiped.
4. **Mandatory Recovery Code Flow**:
   - During registration, a human-readable recovery code (`RC-XXXX-XXXX-...`) is generated from the master data key.
   - Displayed once with an explicit warning and mandatory acknowledgment checkbox: _"I have saved my Recovery Code. I understand that lost key = lost data."_
   - Registration payload to server contains **only** salt and wrapped keys.
5. **Zero-Knowledge LLM Statement Parsing Pipeline**:
   - **Client**: `pdfjs-dist` decrypts password-protected PDFs locally in browser memory (password never leaves client).
   - **Local PII Redaction**: Account numbers, customer IDs, PAN cards, names, addresses, emails, and phone numbers are redacted via regexes before transmission.
   - **Server (`POST /api/parse`)**: Protected by JWT auth and dedicated rate limiting. Calls a pluggable LLM provider (`ILLMProvider`: OpenAI-compatible, Gemini, or Mock).
   - **Integrity**: System prompt enforces strict RAW JSON output (`[{date, narration, type, amount, balance}]`), preserving every row without summarization or hallucination. Validated via **Zod** with automatic single retry on invalid output.
   - **Zero-Logging Guarantee**: The server strictly never logs or stores the raw page text or the parsed response.
   - **Client-Side Bulk Encryption**: Client encrypts the parsed rows with `dataKey` (AES-GCM 256) and computes `hmacTxHash` before bulk-saving to MongoDB.
6. **CSV / Excel (XLSX) Tabular Import & Encrypted Mappings**:
   - **Alternative to PDF**: Native in-browser parsing of CSV and Excel (`.xlsx`, `.xls`) statement exports via SheetJS.
   - **Intelligent Header Detection**: Scans and auto-detects columns for Date, Narration/Description, Debit/Withdrawal, Credit/Deposit, and Running Balance.
   - **Bank Mapping Confirmation**: Prompts user to verify the detected column mapping once per bank.
   - **Encrypted Mapping Persistence**: Column mappings are encrypted with the master `dataKey` (AES-GCM 256) and saved in `localStorage` + synced to `/api/auth/mappings`.
   - **Shared Validation & Deduplication**: Extracted tabular rows pass through the exact same mathematical verification (`prevBalance ± amount = balance`), boundary balance checks, date ordering checks, needs-review preview list with inline editing/exclusion, and HMAC deduplication.

---

## UI Color Tokens & Theme Configuration

The client Tailwind theme and CSS variables implement the exact tokens from `rules.md`:

| Token                     | Hex Value     | Usage Rule                                     | Tailwind Class                       |
| :------------------------ | :------------ | :--------------------------------------------- | :----------------------------------- |
| **Pure Black Background** | `#000000`     | Base viewport canvas background                | `bg-background`                      |
| **Cards & Sidebar**       | `#0C0E10`     | Elevated surfaces, cards, and sidebar          | `bg-card`, `bg-sidebar`              |
| **Borders**               | `1px #1F242D` | Structural container borders                   | `border-border`                      |
| **Grid Lines**            | `#161B22`     | Data grid separators and muted borders         | `border-gridline`                    |
| **Text**                  | `#E0E3E6`     | Primary foreground text                        | `text-foreground`                    |
| **Active Nav Pill**       | `#2A2D32`     | Active navigation pill & button accents        | `bg-nav-active`, `bg-secondary`      |
| **Green**                 | `#22C55E`     | **ONLY** for trend lines, deltas & status dots | `text-trend-green`, `bg-trend-green` |
| **Red**                   | `#EF4444`     | **ONLY** for trend lines, deltas & status dots | `text-trend-red`, `bg-trend-red`     |

---

## Installation & Setup

1. **Install all dependencies across the monorepo**:

   ```bash
   npm install
   ```

2. **Verify Environment Configurations**:
   - Client (`client/.env`):
     ```env
     VITE_API_URL=http://localhost:5000/api
     ```
   - Server (`server/.env`):
     ```env
     PORT=5000
     MONGODB_URI=mongodb://localhost:27017/privacy_finance
     NODE_ENV=development
     CLIENT_URL=http://localhost:5173
     JWT_ACCESS_SECRET=your-access-secret-at-least-32-chars
     JWT_REFRESH_SECRET=your-refresh-secret-at-least-32-chars
     ```

---

## Running Applications

### Start Both Apps Concurrently

```bash
npm run dev
```

- **Client**: `http://localhost:5173`
- **Server**: `http://localhost:5000` (`http://localhost:5000/api/health`)

### Start Individually

- Client: `npm run dev:client`
- Server: `npm run dev:server`

---

## Testing & Verification

### Unit & Integration Tests (Vitest)

Run all 133 unit & integration test suites across both `/client` (98 tests) and `/server` (35 tests):

```bash
npm run test
```

### End-to-End Tests (Playwright)

Execute automated browser E2E tests covering User Signup, Second-Device Login, Statement Upload with Deduplication, and Wrong-Key Failure:

```bash
npm run test:e2e
```

### Linting & Production Build

```bash
npm run lint
npm run build
```

---

## Production Deployment

Comprehensive deployment guidelines, SPA rewrite configurations, security headers, and environment variable references are documented in [DEPLOYMENT.md](file:///c:/Users/aryaa/end%20term%20project/DEPLOYMENT.md):

- **Client Deployment**: Vercel (`vercel.json`) or Cloudflare Pages (`client/public/_headers`)
- **Server Deployment**: Render Web Service (`render.yaml` blueprint)
- **Database**: MongoDB Atlas M0/Serverless cluster
- **Environment Variables Reference**: [server/.env.example](file:///c:/Users/aryaa/end%20term%20project/server/.env.example) and [client/.env.example](file:///c:/Users/aryaa/end%20term%20project/client/.env.example)
