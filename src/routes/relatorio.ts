import { Router, Request, Response } from 'express';
import { gerarRelatorioConferencia } from '../services/relatorio/RelatorioService';
import { relatorioRetencoes } from '../services/relatorio/RetencoesService';
import { gerarResumoMensal } from '../services/relatorio/ResumoMensalService';
import { query } from '../config/database';

const router = Router();

// GET /v1/relatorio/conferencia/:competencia
router.get('/conferencia/:competencia', async (req: Request, res: Response) => {
  const competencia = req.params['competencia'] as string;

  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    res.status(400).json({ erro: 'Competência inválida. Use YYYY-MM' });
    return;
  }

  try {
    const relatorio = await gerarRelatorioConferencia(competencia);

    // Resumo para exibição ao usuário conforme SKILL.md §1.3
    const { resumo } = relatorio;
    const pergunta = `**Posso liberar a apuração?** (todas / só as empresas OK / lista específica)\n\n` +
      `Resumo: ${resumo.empresas_ok} OK · ${resumo.empresas_atencao} com alerta · ` +
      `${resumo.empresas_bloqueadas} bloqueadas · ${resumo.empresas_sem_movimento} sem movimento.`;

    res.json({ ...relatorio, pergunta_liberacao: pergunta });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ erro: 'Falha ao gerar relatório', detalhe: msg });
  }
});

// GET /v1/relatorio/retencoes/:competencia?empresa_id=X — retenções sobre serviços tomados (EFD-Reinf)
router.get('/retencoes/:competencia', async (req: Request, res: Response) => {
  const competencia = req.params['competencia'] as string;
  const empresaId = Number(req.query['empresa_id']);
  if (!/^\d{4}-\d{2}$/.test(competencia) || !empresaId) {
    res.status(400).json({ erro: 'Informe competencia (YYYY-MM) e empresa_id' });
    return;
  }
  try {
    res.json(await relatorioRetencoes(empresaId, competencia));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ erro: 'Falha ao gerar relatório de retenções', detalhe: msg });
  }
});

// GET /v1/relatorio/resumo-mensal/:competencia?empresa_id=X[&ate=YYYY-MM-DD]
// Totalizador: Resumo Mensal da empresa acumulado até a data (padrão: hoje)
router.get('/resumo-mensal/:competencia', async (req: Request, res: Response) => {
  const competencia = req.params['competencia'] as string;
  const empresaId = Number(req.query['empresa_id']);
  const ate = req.query['ate'] ? String(req.query['ate']) : undefined;
  if (!/^\d{4}-\d{2}$/.test(competencia) || !empresaId || (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate))) {
    res.status(400).json({ erro: 'Informe competencia (YYYY-MM), empresa_id e opcionalmente ate (YYYY-MM-DD)' });
    return;
  }
  try {
    res.json(await gerarResumoMensal(empresaId, competencia, ate));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ erro: 'Falha ao gerar Resumo Mensal', detalhe: msg });
  }
});

// GET /v1/relatorio/resumos-mensais/:competencia[?empresa_id=X]
// Resumos gravados pela rotina diária: o mais recente de cada empresa, ou o histórico de uma empresa
router.get('/resumos-mensais/:competencia', async (req: Request, res: Response) => {
  const competencia = req.params['competencia'] as string;
  const empresaId = req.query['empresa_id'] ? Number(req.query['empresa_id']) : null;
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    res.status(400).json({ erro: 'Competência inválida. Use YYYY-MM' });
    return;
  }
  const colunas = `rm.empresa_id, e.nome, e.cnpj, rm.competencia, TO_CHAR(rm.apurado_ate, 'YYYY-MM-DD') AS apurado_ate,
                   rm.mes_fechado, rm.total_faturamento::float AS total_faturamento,
                   rm.total_devido::float AS total_devido, rm.qtd_alertas, rm.gerado_em`;
  const r = empresaId
    ? await query(
        `SELECT ${colunas} FROM resumos_mensais rm JOIN empresas e ON e.id = rm.empresa_id
          WHERE rm.competencia = $1 AND rm.empresa_id = $2 ORDER BY rm.apurado_ate DESC`,
        [competencia, empresaId])
    : await query(
        `SELECT DISTINCT ON (rm.empresa_id) ${colunas} FROM resumos_mensais rm JOIN empresas e ON e.id = rm.empresa_id
          WHERE rm.competencia = $1 ORDER BY rm.empresa_id, rm.apurado_ate DESC`,
        [competencia]);
  res.json(r.rows);
});

export default router;
