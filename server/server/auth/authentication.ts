import type { Request, Response, NextFunction } from "express";

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).session?.user || (req as any).user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  (req as any).user = user;
  next();
}

export const requireAuth = authenticate;
export const authMiddleware = authenticate;
export const isAuthenticated = authenticate;

export function getUser(req: Request) {
  return (req as any).user || (req as any).session?.user || null;
}

export default authenticate;
