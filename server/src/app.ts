import express, { type Application, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { authRouter } from "./routes/auth.js";
import { transactionsRouter } from "./routes/transactions.js";
import { accountsRouter } from "./routes/accounts.js";
import { budgetsRouter } from "./routes/budgets.js";
import { billsRouter } from "./routes/bills.js";
import { holdingsRouter } from "./routes/holdings.js";
import { statementFilesRouter } from "./routes/statementFiles.js";
import { parseRouter } from "./routes/parse.js";
import { quotesRouter } from "./routes/quotes.js";

export function createApp(): Application {
  const app = express();

  // Comprehensive Security Headers via Helmet with customized Content Security Policy
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'", "https://api.mfapi.in"],
          workerSrc: ["'self'", "blob:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
        },
      },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    })
  );

  // CORS configuration with credentials support for httpOnly cookies
  app.use(
    cors({
      origin: process.env.CLIENT_URL || "http://localhost:5173",
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // Body and cookie parsers
  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());

  // Rate Limiting
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500, // 500 requests per 15 mins
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50, // 50 auth attempts per 15 mins
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many authentication attempts, please try again later." },
  });

  app.use("/api/", globalLimiter);
  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/signup", authLimiter);

  // Resource Routers
  app.use("/api/auth", authRouter);
  app.use("/api/transactions", transactionsRouter);
  app.use("/api/accounts", accountsRouter);
  app.use("/api/budgets", budgetsRouter);
  app.use("/api/bills", billsRouter);
  app.use("/api/holdings", holdingsRouter);
  app.use("/api/statement-files", statementFilesRouter);
  app.use("/api/parse", parseRouter);
  app.use("/api/quotes", quotesRouter);

  // Health check endpoint
  app.get("/api/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      service: "privacy-finance-server",
    });
  });

  return app;
}
