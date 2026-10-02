import { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';

dotenv.config();

const CHC_API_KEY = process.env.CHC_API_KEY;

if (!CHC_API_KEY) {
  throw new Error('CHC_API_KEY não definida nas variáveis de ambiente');
}

export function bearerAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ erro: 'Token de autenticação ausente' });
    return;
  }

  const token = authHeader.slice(7);

  if (token !== CHC_API_KEY) {
    res.status(403).json({ erro: 'Token inválido' });
    return;
  }

  next();
}
