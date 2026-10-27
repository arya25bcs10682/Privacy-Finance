Project: privacy-first personal finance app for ~5 users, MERN stack (MongoDB, Express, React+Vite, Node), Tailwind + shadcn/ui, Recharts, javascript.

Non-negotiable rules:

1. Zero-knowledge: bank statement PDFs are parsed in the browser (pdfjs-dist). Transaction data is encrypted client-side with AES-GCM 256 (Web Crypto) BEFORE any network call. The server and MongoDB never see plaintext financial data or PDF text.
2. The user's secret key is never sent to the server, never logged, never stored in localStorage/sessionStorage. Derived keys live in memory only.
3. Login password and encryption secret are separate things.
4. Every DB query is scoped by userId taken from the verified JWT, never from request body or params.
5. Fresh random 12-byte IV per encryption. Never reuse.
6. Supported banks: HDFC, ICICI, SBI only.
7. Use TypeScript, strict mode. Write unit tests for crypto and parsers.
8. Never log decrypted data or secrets.

UI theme: pure black background #000000, cards/sidebar #0C0E10, borders 1px #1F242D, grid lines #161B22, text #E0E3E6, active nav pill #2A2D32, green #22C55E and red #EF4444 used ONLY for trend lines, deltas and status dots.
