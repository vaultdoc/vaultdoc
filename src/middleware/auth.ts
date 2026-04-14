import type { Request, Response, NextFunction } from "express";
import { isInSubnet } from "../utils/cidr.js";

const API_KEYS = new Set(
  (process.env.API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
);

const ALLOWED_IPS = (process.env.ALLOWED_IPS ?? "")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);

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

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  if (API_KEYS.size === 0) {
    console.warn("WARNING: No API_KEYS configured — server is unprotected");
    return next();
  }

  const header = req.headers["authorization"] ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7) : header;

  if (!key || !API_KEYS.has(key)) {
    res.status(401).json({ error: "Unauthorized: invalid or missing API key" });
    return;
  }
  next();
}
