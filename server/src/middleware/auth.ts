import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.js";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    let token = req.cookies?.accessToken;

    // Fallback to Bearer token in Authorization header if present
    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const payload = verifyAccessToken(token);

    // Strictly enforce Rule 4: userId taken ONLY from verified JWT
    (req as AuthenticatedRequest).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
  }
}
