// Checklist mensal de obrigações do fechamento — agenda fixa do escritório (captura, folha,
// ISSQN, EFD-Reinf, PGDAS-D, DCTFWeb, DeSTDA, parcelamentos, fechamento contábil etc.)
import { Router } from 'express';
import { query } from '../config/database';

const router = Router();

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// Formata o período de referência de uma obrigação para uma competência de processamento
function periodoReferencia(competencia: string, defasagemMeses: number | null, periodoFixo: string | null): string {
  if (periodoFixo) return periodoFixo;
  const [ano, mes] = competencia.split('-').map(Number);
  const d = new Date(ano!, mes! - 1 - (defasagemMeses ?? 0), 1);
  return `${MESES[d.getMonth()]}/${d.getFullYear()}`;
}

// ── Template (obrigações recorrentes) ───────────────────────────────────────

// GET /v1/obrigacoes — lista o template (inclui inativas se ?todas=true)
router.get('/', async (req, res) => {
  const todas = req.query['todas'] === 'true';
  const r = await query(
    `SELECT * FROM obrigacoes ${todas ? '' : 'WHERE ativo = true'} ORDER BY dia_prazo_ord, ordem`
  );
  return res.json(r.rows);
});

// POST /v1/obrigacoes — inclui uma nova obrigação no template
router.post('/', async (req, res) => {
  const b = req.body as Record<string, unknown>;
  const { dia_prazo, dia_prazo_ord, descricao } = b;
  if (!dia_prazo || dia_prazo_ord == null || !descricao)
    return res.status(400).json({ erro: 'Campos obrigatórios: dia_prazo, dia_prazo_ord, descricao' });

  try {
    const r = await query(
      `INSERT INTO obrigacoes (ordem, dia_prazo, dia_prazo_ord, descricao, defasagem_meses, periodo_fixo)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        Number(b['ordem'] ?? dia_prazo_ord), String(dia_prazo), Number(dia_prazo_ord), String(descricao),
        b['defasagem_meses'] != null ? Number(b['defasagem_meses']) : null,
        b['periodo_fixo'] ? String(b['periodo_fixo']) : null,
      ]
    );
    return res.status(201).json({ ok: true, id: r.rows[0]!['id'] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('obrigacoes_descricao_key'))
      return res.status(409).json({ erro: 'Já existe uma obrigação com essa descrição' });
    return res.status(500).json({ erro: 'Falha ao incluir obrigação', detalhe: msg });
  }
});

// PATCH /v1/obrigacoes/:id — altera uma obrigação do template
router.patch('/:id', async (req, res) => {
  const id = Number(req.params['id']);
  if (!id) return res.status(400).json({ erro: 'ID inválido' });

  const permitidos = ['ordem', 'dia_prazo', 'dia_prazo_ord', 'descricao', 'defasagem_meses', 'periodo_fixo', 'ativo'] as const;
  const campos: Record<string, unknown> = {};
  for (const k of permitidos) if (k in req.body) campos[k] = req.body[k];
  if (Object.keys(campos).length === 0) return res.status(400).json({ erro: 'Nenhum campo válido para atualizar' });

  const sets = Object.keys(campos).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const r = await query(`UPDATE obrigacoes SET ${sets} WHERE id = $1 RETURNING id`, [id, ...Object.values(campos)]);
  if ((r.rowCount ?? 0) === 0) return res.status(404).json({ erro: 'Obrigação não encontrada' });
  return res.json({ ok: true, id });
});

// DELETE /v1/obrigacoes/:id — por padrão desativa (soft delete); ?excluir=true remove de vez
router.delete('/:id', async (req, res) => {
  const id = Number(req.params['id']);
  if (!id) return res.status(400).json({ erro: 'ID inválido' });

  if (req.query['excluir'] === 'true') {
    const r = await query(`DELETE FROM obrigacoes WHERE id = $1 RETURNING id`, [id]);
    if ((r.rowCount ?? 0) === 0) return res.status(404).json({ erro: 'Obrigação não encontrada' });
    return res.json({ ok: true, excluida: true, id });
  }
  const r = await query(`UPDATE obrigacoes SET ativo = false WHERE id = $1 RETURNING id`, [id]);
  if ((r.rowCount ?? 0) === 0) return res.status(404).json({ erro: 'Obrigação não encontrada' });
  return res.json({ ok: true, desativada: true, id });
});

// ── Checklist mensal (execuções / baixa) ────────────────────────────────────

// GET /v1/obrigacoes/checklist/:competencia — cria (se faltar) e retorna o checklist do mês
router.get('/checklist/:competencia', async (req, res) => {
  const competencia = req.params['competencia'] as string;
  if (!/^\d{4}-\d{2}$/.test(competencia))
    return res.status(400).json({ erro: 'Competência inválida. Use YYYY-MM' });

  // Garante uma execução pendente para cada obrigação ativa nesta competência
  await query(
    `INSERT INTO obrigacoes_execucoes (obrigacao_id, competencia)
       SELECT id, $1 FROM obrigacoes WHERE ativo = true
     ON CONFLICT (obrigacao_id, competencia) DO NOTHING`,
    [competencia]
  );

  const r = await query<Record<string, unknown>>(
    `SELECT x.id AS execucao_id, x.status, x.concluido_em, x.observacao,
            o.id AS obrigacao_id, o.dia_prazo, o.dia_prazo_ord, o.descricao, o.defasagem_meses, o.periodo_fixo
       FROM obrigacoes_execucoes x
       JOIN obrigacoes o ON o.id = x.obrigacao_id
      WHERE x.competencia = $1
      ORDER BY o.dia_prazo_ord, o.ordem`,
    [competencia]
  );

  const itens = r.rows.map(row => ({
    execucao_id: row['execucao_id'],
    obrigacao_id: row['obrigacao_id'],
    dia_prazo: row['dia_prazo'],
    descricao: String(row['descricao']).replace(/\s*\[avulso [^\]]+\]$/, ''),
    periodo_referencia: periodoReferencia(competencia, row['defasagem_meses'] as number | null, row['periodo_fixo'] as string | null),
    status: row['status'],
    concluido_em: row['concluido_em'],
    observacao: row['observacao'],
  }));

  return res.json({
    competencia,
    total: itens.length,
    concluidas: itens.filter(i => i.status === 'concluido').length,
    itens,
  });
});

// POST /v1/obrigacoes/checklist/:competencia/item — inclui um item avulso só nesta competência
// (cria a obrigação já inativa no template, para não repetir nos meses seguintes, e a execução do mês)
router.post('/checklist/:competencia/item', async (req, res) => {
  const competencia = req.params['competencia'] as string;
  if (!/^\d{4}-\d{2}$/.test(competencia))
    return res.status(400).json({ erro: 'Competência inválida. Use YYYY-MM' });

  const { dia_prazo, descricao, periodo_referencia } = req.body as
    { dia_prazo?: string; descricao?: string; periodo_referencia?: string };
  if (!dia_prazo || !descricao)
    return res.status(400).json({ erro: 'Campos obrigatórios: dia_prazo, descricao' });

  const diaOrd = parseInt(String(dia_prazo).match(/\d+/)?.[0] ?? '1', 10);
  const descricaoUnica = `${descricao} [avulso ${competencia} #${Date.now().toString(36)}]`;

  const o = await query<{ id: number }>(
    `INSERT INTO obrigacoes (ordem, dia_prazo, dia_prazo_ord, descricao, periodo_fixo, ativo)
     VALUES (999, $1, $2, $3, $4, false) RETURNING id`,
    [String(dia_prazo), diaOrd, descricaoUnica, periodo_referencia || competencia]
  );
  const x = await query<{ id: number }>(
    `INSERT INTO obrigacoes_execucoes (obrigacao_id, competencia) VALUES ($1, $2) RETURNING id`,
    [o.rows[0]!.id, competencia]
  );
  return res.status(201).json({ ok: true, execucao_id: x.rows[0]!.id, obrigacao_id: o.rows[0]!.id });
});

// PATCH /v1/obrigacoes/execucoes/:id — dá baixa / reabre / anota uma execução
router.patch('/execucoes/:id', async (req, res) => {
  const id = Number(req.params['id']);
  if (!id) return res.status(400).json({ erro: 'ID inválido' });

  const { status, observacao } = req.body as { status?: string; observacao?: string };
  if (status && !['pendente', 'concluido'].includes(status))
    return res.status(400).json({ erro: 'status deve ser pendente ou concluido' });

  const campos: Record<string, unknown> = {};
  if (status) {
    campos['status'] = status;
    campos['concluido_em'] = status === 'concluido' ? new Date() : null;
  }
  if (observacao !== undefined) campos['observacao'] = observacao;
  if (Object.keys(campos).length === 0) return res.status(400).json({ erro: 'Informe status e/ou observacao' });

  const sets = Object.keys(campos).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const r = await query(
    `UPDATE obrigacoes_execucoes SET ${sets} WHERE id = $1 RETURNING id`,
    [id, ...Object.values(campos)]
  );
  if ((r.rowCount ?? 0) === 0) return res.status(404).json({ erro: 'Execução não encontrada' });
  return res.json({ ok: true, id });
});

// DELETE /v1/obrigacoes/execucoes/:id — remove uma execução pontual do mês (ex.: não se aplica)
router.delete('/execucoes/:id', async (req, res) => {
  const id = Number(req.params['id']);
  if (!id) return res.status(400).json({ erro: 'ID inválido' });
  const r = await query(`DELETE FROM obrigacoes_execucoes WHERE id = $1 RETURNING id`, [id]);
  if ((r.rowCount ?? 0) === 0) return res.status(404).json({ erro: 'Execução não encontrada' });
  return res.json({ ok: true, excluida: true, id });
});

export default router;
