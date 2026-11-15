import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config/env.ts";
import { listDashboardUsers } from "../database/repositories/usersRepo.ts";

export interface DashboardUser {
  id: string;
  username: string;
  role: "owner" | "admin" | "viewer";
  fullName?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: DashboardUser;
}

function getSecret() {
  return (config as any).jwtSecret || process.env.JWT_SECRET || process.env.SESSION_SECRET || "smart-sender-secret-change-me";
}
function signToken(user: DashboardUser) {
  const payload = JSON.stringify({ id: user.id, username: user.username, role: user.role, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  const base = Buffer.from(payload).toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(base).digest("base64url");
  return `${base}.${sig}`;
}
function verifyToken(token: string): DashboardUser | null {
  try {
    const [base, sig] = token.split(".");
    if (!base || !sig) return null;
    const expected = crypto.createHmac("sha256", getSecret()).update(base).digest("base64url");
    if (sig !== expected) return null;
    const data = JSON.parse(Buffer.from(base, "base64url").toString());
    if (data.exp < Date.now()) return null;
    return { id: data.id, username: data.username, role: data.role };
  } catch { return null; }
}
function sha256(s: string) { return crypto.createHash("sha256").update(s).digest("hex"); }

export function authenticateDashboardCredentials(username: string, password: string) {
  const users = listDashboardUsers() as any[];
  const found = users.find((u: any) => u.username === username);
  const ownerUsername = (config as any).dashboardUsername || process.env.DASHBOARD_USERNAME || "admin";
  const ownerPassword = (config as any).dashboardPassword || process.env.DASHBOARD_PASSWORD || process.env.ADMIN_PASSWORD || "";

  if (found) {
    const stored = found.password_hash || found.passwordHash || "";
    const ok = stored === password || stored === sha256(password);
    if (!ok) return { ok: false as const, error: "اسم المستخدم أو كلمة المرور غير صحيحة" };
    const user: DashboardUser = { id: String(found.id), username: found.username, role: found.role || "admin", fullName: found.full_name || found.fullName || found.username };
    return { ok: true as const, token: signToken(user), user };
  }
  if (username === ownerUsername && ownerPassword && password === ownerPassword) {
    const user: DashboardUser = { id: "owner", username: ownerUsername, role: "owner", fullName: ownerUsername };
    return { ok: true as const, token: signToken(user), user };
  }
  return { ok: false as const, error: "اسم المستخدم أو كلمة المرور غير صحيحة" };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query.token as string) || "";
  if (!token) { res.status(401).json({ error: "غير مصرح - سجل دخول أولاً" }); return; }
  const user = verifyToken(token);
  if (!user) { res.status(401).json({ error: "انتهت الجلسة - سجل دخول تاني" }); return; }
  req.user = user;
  next();
}

export function requireRole(roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) { res.status(401).json({ error: "غير مصرح" }); return; }
    if (!roles.includes(req.user.role)) { res.status(403).json({ error: "ما عندك صلاحية للعملية دي" }); return; }
    next();
  };
}

export default requireAuth;
