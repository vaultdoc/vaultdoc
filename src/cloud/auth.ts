import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "";

export interface WorkspaceToken {
  workspaceId: string;
  userId: string;
  role: "owner" | "member";
}

declare global {
  namespace Express {
    interface Request {
      workspace?: WorkspaceToken;
    }
  }
}

export function jwtAuth(req: Request, res: Response, next: NextFunction) {
  if (!JWT_SECRET) {
    res.status(503).json({ error: "JWT_SECRET not configured" });
    return;
  }

  const header = req.headers["authorization"] ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;

  if (!token) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as WorkspaceToken;
    req.workspace = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function issueToken(payload: WorkspaceToken): string {
  if (!JWT_SECRET) throw new Error("JWT_SECRET not configured");
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}
