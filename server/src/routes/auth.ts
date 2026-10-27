import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { isDbConnected, memoryStore, type InMemoryUser } from "../models/memoryFallback.js";
import {
  generateTokens,
  setAuthCookies,
  clearAuthCookies,
  verifyRefreshToken,
} from "../utils/jwt.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const authRouter = Router();

/**
 * POST /api/auth/signup
 * Creates a new user account.
 * Server stores email, passwordHash, keySalt, wrappedDataKey, wrappedDataKeyByRecovery.
 * STRICT SECURITY: Server must NEVER receive or accept the raw Secret Key.
 */
authRouter.post("/signup", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, keySalt, wrappedDataKey, wrappedDataKeyByRecovery } = req.body;

    // Strict zero-knowledge assertion: verify secretKey was never sent
    if ("secretKey" in req.body || "secret" in req.body) {
      res.status(400).json({
        error: "Security violation: Secret key must never be transmitted to the server.",
      });
      return;
    }

    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.status(400).json({ error: "A valid email address is required." });
      return;
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters long." });
      return;
    }

    if (!keySalt || typeof keySalt !== "string") {
      res.status(400).json({ error: "keySalt is required for zero-knowledge key derivation." });
      return;
    }

    if (!wrappedDataKey || !wrappedDataKey.ciphertext) {
      res.status(400).json({ error: "wrappedDataKey is required." });
      return;
    }

    if (!wrappedDataKeyByRecovery) {
      res.status(400).json({ error: "wrappedDataKeyByRecovery is required for account recovery." });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = !isDbConnected()
      ? memoryStore.users.findByEmail(normalizedEmail)
      : await User.findOne({ email: normalizedEmail });

    if (existing) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    let userId: string;
    let savedKeySalt = keySalt;
    let savedWrappedDataKey = wrappedDataKey;
    let savedWrappedDataKeyByRecovery = wrappedDataKeyByRecovery;

    let userAccessToken = "";

    if (!isDbConnected()) {
      const memoryUser = memoryStore.users.create({
        email: normalizedEmail,
        passwordHash,
        keySalt,
        wrappedDataKey,
        wrappedDataKeyByRecovery,
        refreshTokens: [],
      });
      const { accessToken, refreshToken } = generateTokens(memoryUser._id);
      userAccessToken = accessToken;
      memoryUser.refreshTokens.push(refreshToken);
      userId = memoryUser._id;
      setAuthCookies(res, accessToken, refreshToken);
    } else {
      const user = new User({
        email: normalizedEmail,
        passwordHash,
        keySalt,
        wrappedDataKey,
        wrappedDataKeyByRecovery,
        refreshTokens: [],
      });

      const { accessToken, refreshToken } = generateTokens(user._id.toString());
      userAccessToken = accessToken;
      user.refreshTokens.push(refreshToken);
      await user.save();
      userId = user._id.toString();
      savedKeySalt = user.keySalt;
      savedWrappedDataKey = user.wrappedDataKey;
      savedWrappedDataKeyByRecovery = user.wrappedDataKeyByRecovery;
      setAuthCookies(res, accessToken, refreshToken);
    }

    res.status(201).json({
      token: userAccessToken,
      user: {
        id: userId,
        email: normalizedEmail,
      },
      keySalt: savedKeySalt,
      wrappedDataKey: savedWrappedDataKey,
      wrappedDataKeyByRecovery: savedWrappedDataKeyByRecovery,
    });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Internal server error during registration." });
  }
});

/**
 * POST /api/auth/login
 * Validates email & password, sets httpOnly JWT cookies, and returns the wrapped data key & salt
 * so the client can unwrap the data key in memory using their secret key.
 */
authRouter.post("/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required." });
      return;
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const user = !isDbConnected()
      ? memoryStore.users.findByEmail(normalizedEmail)
      : await User.findOne({ email: normalizedEmail });

    if (!user) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const { accessToken, refreshToken } = generateTokens(user._id.toString());

    // Keep up to 5 active refresh tokens per user
    user.refreshTokens = [...user.refreshTokens.slice(-4), refreshToken];
    if (!isDbConnected()) {
      memoryStore.users.save(user as unknown as InMemoryUser);
    } else {
      await (user as unknown as { save: () => Promise<unknown> }).save();
    }

    setAuthCookies(res, accessToken, refreshToken);

    res.status(200).json({
      token: accessToken,
      user: {
        id: user._id.toString(),
        email: user.email,
      },
      keySalt: user.keySalt,
      wrappedDataKey: user.wrappedDataKey,
      wrappedDataKeyByRecovery: user.wrappedDataKeyByRecovery,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error during login." });
  }
});

/**
 * POST /api/auth/refresh
 * Rotates the access token using the httpOnly refresh token cookie.
 */
authRouter.post("/refresh", async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) {
      res.status(401).json({ error: "Refresh token missing." });
      return;
    }

    const payload = verifyRefreshToken(token);
    const user = await User.findById(payload.userId);

    if (!user || !user.refreshTokens.includes(token)) {
      clearAuthCookies(res);
      res.status(401).json({ error: "Invalid or revoked refresh token." });
      return;
    }

    // Rotate tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id.toString());

    user.refreshTokens = user.refreshTokens.filter((t) => t !== token).concat(newRefreshToken);
    await user.save();

    setAuthCookies(res, accessToken, newRefreshToken);
    res.status(200).json({ ok: true });
  } catch {
    clearAuthCookies(res);
    res.status(401).json({ error: "Invalid refresh token." });
  }
});

/**
 * POST /api/auth/logout
 * Clears cookies and revokes active refresh token.
 */
authRouter.post("/logout", async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.cookies?.refreshToken;
    if (token) {
      try {
        const payload = verifyRefreshToken(token);
        await User.findByIdAndUpdate(payload.userId, {
          $pull: { refreshTokens: token },
        });
      } catch {
        // Token already invalid, ignore
      }
    }
  } finally {
    clearAuthCookies(res);
    res.status(200).json({ ok: true, message: "Logged out successfully." });
  }
});

/**
 * GET /api/auth/me
 * Returns authenticated user info and wrapped key material.
 */
authRouter.get("/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const user = !isDbConnected()
      ? memoryStore.users.findById(userId)
      : await User.findById(userId);

    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    res.status(200).json({
      user: {
        id: user._id.toString(),
        email: user.email,
      },
      keySalt: user.keySalt,
      wrappedDataKey: user.wrappedDataKey,
      wrappedDataKeyByRecovery: user.wrappedDataKeyByRecovery,
    });
  } catch (err) {
    console.error("Auth /me error:", err);
    res.status(500).json({ error: "Failed to fetch user session." });
  }
});

/**
 * GET /api/auth/mappings
 * Returns encrypted column mappings for bank CSV/XLSX imports.
 */
authRouter.get(
  "/mappings",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).userId!;
      const user = !isDbConnected()
        ? memoryStore.users.findById(userId)
        : await User.findById(userId);

      if (!user) {
        res.status(404).json({ error: "User not found." });
        return;
      }

      res.status(200).json({
        encryptedMappings: user.encryptedMappings || null,
      });
    } catch (err) {
      console.error("Fetch mappings error:", err);
      res.status(500).json({ error: "Failed to fetch bank mappings." });
    }
  }
);

/**
 * PUT /api/auth/mappings
 * Saves encrypted column mappings for bank CSV/XLSX imports (zero-knowledge payload).
 */
authRouter.put(
  "/mappings",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).userId!;
      const { encryptedMappings } = req.body;

      if (!encryptedMappings || !encryptedMappings.iv || !encryptedMappings.ct) {
        res.status(400).json({ error: "Invalid encryptedMappings payload." });
        return;
      }

      if (!isDbConnected()) {
        const u = memoryStore.users.findById(userId);
        if (!u) {
          res.status(404).json({ error: "User not found." });
          return;
        }
        u.encryptedMappings = encryptedMappings;
        res.status(200).json({ ok: true, encryptedMappings });
        return;
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { $set: { encryptedMappings } },
        { new: true }
      );

      if (!user) {
        res.status(404).json({ error: "User not found." });
        return;
      }

      res.status(200).json({
        ok: true,
        encryptedMappings: user.encryptedMappings,
      });
    } catch (err) {
      console.error("Save mappings error:", err);
      res.status(500).json({ error: "Failed to save bank mappings." });
    }
  }
);

/**
 * GET /api/auth/rules
 * Returns encrypted user categorization rules and manual overrides.
 */
authRouter.get(
  "/rules",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).userId!;
      const user = !isDbConnected()
        ? memoryStore.users.findById(userId)
        : await User.findById(userId);

      if (!user) {
        res.status(404).json({ error: "User not found." });
        return;
      }

      res.status(200).json({
        encryptedRules: user.encryptedRules || null,
      });
    } catch (err) {
      console.error("Fetch rules error:", err);
      res.status(500).json({ error: "Failed to fetch categorization rules." });
    }
  }
);

/**
 * PUT /api/auth/rules
 * Saves encrypted user categorization rules and manual overrides (zero-knowledge payload).
 */
authRouter.put(
  "/rules",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).userId!;
      const { encryptedRules } = req.body;

      if (!encryptedRules || !encryptedRules.iv || !encryptedRules.ct) {
        res.status(400).json({ error: "Invalid encryptedRules payload." });
        return;
      }

      if (!isDbConnected()) {
        const u = memoryStore.users.findById(userId);
        if (!u) {
          res.status(404).json({ error: "User not found." });
          return;
        }
        u.encryptedRules = encryptedRules;
        res.status(200).json({ ok: true, encryptedRules });
        return;
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { $set: { encryptedRules } },
        { new: true }
      );

      if (!user) {
        res.status(404).json({ error: "User not found." });
        return;
      }

      res.status(200).json({
        ok: true,
        encryptedRules: user.encryptedRules,
      });
    } catch (err) {
      console.error("Save rules error:", err);
      res.status(500).json({ error: "Failed to save categorization rules." });
    }
  }
);
