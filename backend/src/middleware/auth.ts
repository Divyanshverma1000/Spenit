import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthPayload {
  userId: string;
  username: string;
}

// Extend Express Request type so downstream handlers can access req.user
declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/**
 * requireAuth middleware
 *
 * Reads the JWT access token from the Authorization header:
 *   Authorization: Bearer <token>
 *
 * On success: attaches req.user = { userId, username } and calls next().
 * On failure: responds 401 immediately — no server-side session state of any kind.
 *
 * Architecture.md §4: Express servers are stateless — JWT access token only,
 * no server-side session store.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET as string) as AuthPayload;
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Access token expired" });
    } else {
      res.status(401).json({ error: "Invalid access token" });
    }
  }
}
