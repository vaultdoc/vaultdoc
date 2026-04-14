import type { Request, Response, NextFunction } from "express";
import { isInSubnet } from "../utils/cidr.js";
import { hasKey } from "../services/keyStore.js";

const ALLOWED_IPS = (process.env.ALLOWED_IPS ?? "")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);

const ADMIN_KEY = process.env.ADMIN_KEY ?? "";

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "";
}

export function ipAllowlist(req: Request, res: Response, next: NextFunction) {
  if (ALLOWED_IPS.length === 0) return next();
  const clientIp = getClientIp(req);
  const allowed = ALLOWED_IPS.some((range) => isInSubnet(clientIp, range));
  if (!allowed) {
    res.status(403).json({ error: "Forbidden: IP not in allowlist" });
    return;
  }
  next();
}

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers["authorization"] ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;

  if (!token) {
    res.status(401).json({ error: "Unauthorized: missing Authorization header" });
    return;
  }

  const valid = await hasKey(token);
  if (!valid) {
    res.status(401).json({ error: "Unauthorized: invalid API key" });
    return;
  }
  next();
}

export function adminKeyAuth(req: Request, res: Response, next: NextFunction) {
  if (!ADMIN_KEY) {
    res.status(503).json({ error: "Admin API not configured (set ADMIN_KEY)" });
    return;
  }
  const header = req.headers["authorization"] ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (token !== ADMIN_KEY) {
    res.status(401).json({ error: "Unauthorized: invalid admin key" });
    return;
  }
  next();
}
