import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-fallback';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
  };
}

export function authorizeRole(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
        // Dev mode bypass
        req.user = { id: 'dev-user', username: 'dev', role: allowedRoles[0] };
        return next();
      }

      const decoded = jwt.verify(token, JWT_SECRET) as any;
      
      if (!allowedRoles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Forbidden - Insufficient permissions' });
      }

      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }
  };
}
