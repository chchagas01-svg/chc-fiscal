import { Router, Request, Response } from 'express';

const router = Router();

// POST /v1/contabil/lancar  — stub (Subprojeto 4)
router.post('/lancar', (_req: Request, res: Response) => {
  res.status(501).json({
    status: 'not_implemented',
    fase: 'subprojeto-4',
    mensagem: 'Módulo contábil não disponível nesta versão. Lançamentos são feitos no Qyon.',
  });
});

export default router;
