import { Router } from 'express';
import { setQyonTokens } from '../services/qyon/QyonClient';
import { query } from '../config/database';

const router = Router();

// DELETE /v1/admin/notas/:competencia/:empresaId — limpa notas de uma empresa/competência para reimportar
router.delete('/notas/:competencia/:empresaId', async (req, res) => {
  const { competencia, empresaId } = req.params;
  if (!competencia || !empresaId) {
    return res.status(400).json({ erro: 'competencia e empresaId são obrigatórios' });
  }
  const result = await query(
    `DELETE FROM notas WHERE competencia = $1 AND empresa_id = $2`,
    [competencia, Number(empresaId)]
  );
  const deletadas = result.rowCount ?? 0;
  console.log(`[admin] ${deletadas} nota(s) deletadas — empresa=${empresaId} competencia=${competencia}`);
  return res.json({ ok: true, deletadas });
});

// POST /v1/admin/qyon-token — atualiza JWT e refresh_token Qyon em memória + banco
router.post('/qyon-token', async (req, res) => {
  const { jwt, refreshToken } = req.body as { jwt?: string; refreshToken?: string };

  if (!jwt || !refreshToken) {
    return res.status(400).json({ erro: 'Campos obrigatórios: jwt, refreshToken' });
  }

  setQyonTokens(jwt, refreshToken);

  await query(
    `INSERT INTO config (key, value, updated_at) VALUES ('qyon_jwt', $1, NOW()), ('qyon_refresh_token', $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [jwt, refreshToken]
  );

  console.log('[admin] Tokens Qyon atualizados via API');
  return res.json({ ok: true, mensagem: 'Tokens Qyon atualizados com sucesso' });
});

export default router;
