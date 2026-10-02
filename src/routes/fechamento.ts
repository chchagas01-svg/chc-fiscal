import { Router, Request, Response } from 'express';
import { query } from '../config/database';

const router = Router();

// POST /v1/fechamento/liberar — registra liberação da Fase 2 (TRAVA obrigatória)
// Body: { competencia, responsavel, observacao?, empresas_ids? }
router.post('/liberar', async (req: Request, res: Response) => {
  const { competencia, responsavel, observacao, empresas_ids } = req.body as {
    competencia?: string;
    responsavel?: string;
    observacao?: string;
    empresas_ids?: number[];
  };

  if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) {
    res.status(400).json({ erro: 'Campo "competencia" obrigatório no formato YYYY-MM' });
    return;
  }
  if (!responsavel || responsavel.trim() === '') {
    res.status(400).json({ erro: 'Campo "responsavel" obrigatório' });
    return;
  }

  try {
    // Impede dupla liberação da mesma competência
    const jaLiberada = await query(
      'SELECT id, criado_em FROM liberacoes WHERE competencia = $1 LIMIT 1',
      [competencia]
    );
    if (jaLiberada.rows.length > 0) {
      res.status(409).json({
        erro: 'Competência já liberada',
        liberacao_anterior: jaLiberada.rows[0],
      });
      return;
    }

    await query(
      `INSERT INTO liberacoes (competencia, responsavel, observacao, empresas_ids)
       VALUES ($1, $2, $3, $4)`,
      [competencia, responsavel.trim(), observacao ?? null, empresas_ids ?? null]
    );

    await query(
      `INSERT INTO audit_log (competencia, acao, payload, resultado)
       VALUES ($1, 'fase2_liberada', $2, 'ok')`,
      [competencia, JSON.stringify({ responsavel, empresas_ids: empresas_ids ?? 'todas' })]
    );

    res.json({
      status: 'liberado',
      competencia,
      responsavel,
      empresas: empresas_ids ?? 'todas as empresas OK',
      mensagem: 'Fase 2 liberada. Chame POST /v1/apuracao/executar para iniciar a apuração.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ erro: 'Falha ao registrar liberação', detalhe: msg });
  }
});

// GET /v1/fechamento/status/:competencia — painel completo de fechamento
router.get('/status/:competencia', async (req: Request, res: Response) => {
  const competencia = req.params['competencia'] as string;

  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    res.status(400).json({ erro: 'Competência inválida. Use YYYY-MM' });
    return;
  }

  try {
    // Status por empresa e etapa
    const estadosRes = await query(
      `SELECT
         e.id, e.cnpj, e.nome, e.regime,
         MAX(fe.atualizado_em) AS ultima_atualizacao,
         json_object_agg(fe.etapa, json_build_object(
           'status', fe.status,
           'detalhe', fe.detalhe,
           'atualizado_em', fe.atualizado_em
         )) AS etapas
       FROM empresas e
       LEFT JOIN fechamentos_estado fe
         ON fe.empresa_id = e.id AND fe.competencia = $1
       WHERE e.ativo = true
       GROUP BY e.id, e.cnpj, e.nome, e.regime
       ORDER BY e.nome`,
      [competencia]
    );

    // Apurações aprovadas
    const apuracoesRes = await query(
      `SELECT empresa_id, das_devido, pis_devido, cofins_devida, iss_devido,
              icms_devido, irpj_devido, csll_devida, status
       FROM apuracoes WHERE competencia = $1`,
      [competencia]
    );
    const apMap: Record<number, Record<string, unknown>> = {};
    for (const row of apuracoesRes.rows) {
      apMap[Number(row['empresa_id'])] = row as Record<string, unknown>;
    }

    // Liberação registrada
    const liberacaoRes = await query(
      'SELECT responsavel, criado_em, empresas_ids FROM liberacoes WHERE competencia = $1 LIMIT 1',
      [competencia]
    );
    const liberacao = liberacaoRes.rows[0] ?? null;

    // Pendências críticas: prazo próximo sem status 'ok'
    const hoje = new Date();
    const diasRestantes = (venc: string) => {
      const d = new Date(venc);
      return Math.ceil((d.getTime() - hoje.getTime()) / 86_400_000);
    };

    const pendenciasCriticas: string[] = [];
    for (const row of estadosRes.rows) {
      const etapas = (row['etapas'] as Record<string, { status: string }>) ?? {};
      if (!etapas['apuracao'] || etapas['apuracao'].status !== 'ok') {
        pendenciasCriticas.push(`${row['nome']}: apuração pendente`);
      }
    }

    const empresas = estadosRes.rows.map(row => ({
      empresa_id: Number(row['id']),
      cnpj: row['cnpj'],
      nome: row['nome'],
      regime: row['regime'],
      etapas: row['etapas'] ?? {},
      apuracao: apMap[Number(row['id'])] ?? null,
    }));

    res.json({
      competencia,
      fase2_liberada: liberacao !== null,
      liberacao,
      resumo: {
        total: empresas.length,
        captura_ok:    empresas.filter(e => (e.etapas as Record<string, {status:string}>)?.['captura']?.status === 'ok').length,
        apuracao_ok:   empresas.filter(e => (e.etapas as Record<string, {status:string}>)?.['apuracao']?.status === 'ok').length,
        retidas:       empresas.filter(e => (e.etapas as Record<string, {status:string}>)?.['apuracao']?.status === 'retida').length,
      },
      pendencias_criticas: pendenciasCriticas,
      empresas,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ erro: 'Falha ao consultar fechamento', detalhe: msg });
  }
});

export default router;
