import { Router, Request, Response } from 'express';
import { gerarRelatorioConferencia } from '../services/relatorio/RelatorioService';
import { relatorioRetencoes } from '../services/relatorio/RetencoesService';

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

export default router;
