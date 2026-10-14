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

// PATCH /v1/admin/empresas/:id — cadastro usado pela apuração e pelo Resumo Mensal
// Body (todos opcionais): { inscricao_estadual, tem_difal, aliquota_iss, aliquota_icms_interna }
router.patch('/empresas/:id', async (req, res) => {
  const id = Number(req.params['id']);
  const body = req.body as { inscricao_estadual?: string | null; tem_difal?: boolean; aliquota_iss?: number | null; aliquota_icms_interna?: number };

  const sets: string[] = [];
  const params: unknown[] = [];
  if ('inscricao_estadual' in body) {
    const ie = body.inscricao_estadual ? String(body.inscricao_estadual).replace(/\D/g, '') : null;
    params.push(ie || null); sets.push(`inscricao_estadual = $${params.length}`);
  }
  if ('tem_difal' in body) {
    params.push(Boolean(body.tem_difal)); sets.push(`tem_difal = $${params.length}`);
  }
  if ('aliquota_iss' in body) {
    const aliq = body.aliquota_iss == null ? null : Number(body.aliquota_iss);
    if (aliq != null && (isNaN(aliq) || aliq < 0 || aliq > 0.05)) {
      return res.status(400).json({ erro: 'aliquota_iss deve ser decimal entre 0 e 0.05 (ex.: 0.05 = 5%)' });
    }
    params.push(aliq); sets.push(`aliquota_iss = $${params.length}`);
  }
  if ('aliquota_icms_interna' in body) {
    const aliq = Number(body.aliquota_icms_interna);
    if (isNaN(aliq) || aliq <= 0 || aliq > 0.35) {
      return res.status(400).json({ erro: 'aliquota_icms_interna deve ser decimal (ex.: 0.18 = 18%)' });
    }
    params.push(aliq); sets.push(`aliquota_icms_interna = $${params.length}`);
  }
  if (sets.length === 0) return res.status(400).json({ erro: 'Nenhum campo para atualizar' });

  params.push(id);
  const r = await query(
    `UPDATE empresas SET ${sets.join(', ')}, atualizado_em = NOW()
      WHERE id = $${params.length}
      RETURNING id, cnpj, nome, regime, inscricao_estadual, tem_difal, aliquota_iss, aliquota_icms_interna`,
    params
  );
  if (!r.rows[0]) return res.status(404).json({ erro: 'Empresa não encontrada' });
  return res.json({ ok: true, empresa: r.rows[0] });
});

export default router;
