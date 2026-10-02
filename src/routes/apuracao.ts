import { Router, Request, Response } from 'express';
import { apurar, apurarEmpresa } from '../services/engine/ApuracaoService';
import { query } from '../config/database';

const router = Router();

// POST /v1/apuracao/executar
// Body: { competencia: "YYYY-MM", empresas_ids?: number[] }
router.post('/executar', async (req: Request, res: Response) => {
  const { competencia, empresas_ids } = req.body as {
    competencia?: string;
    empresas_ids?: number[];
  };

  if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) {
    res.status(400).json({ erro: 'Campo "competencia" obrigatório no formato YYYY-MM' });
    return;
  }

  // Verificar se existe liberação registrada para esta competência
  const liberacao = await query(
    'SELECT id FROM liberacoes WHERE competencia = $1 LIMIT 1',
    [competencia]
  );
  if (liberacao.rows.length === 0) {
    res.status(403).json({
      erro: 'Fase 2 bloqueada',
      mensagem: 'A competência não foi liberada pelo responsável. Registre a liberação em POST /v1/fechamento/liberar antes de apurar.',
    });
    return;
  }

  try {
    const resultados = await apurar(competencia, empresas_ids);
    const aprovadas = resultados.filter(r => r.status === 'aprovada').length;
    const retidas   = resultados.filter(r => r.status === 'retida').length;

    res.json({
      competencia,
      resumo: { total: resultados.length, aprovadas, retidas },
      empresas: resultados.map(r => ({
        empresa_id: r.empresa_id,
        cnpj: r.cnpj,
        nome: r.nome,
        status: r.status,
        motivo: r.motivo,
        alertas: r.alertas.length > 0 ? r.alertas : undefined,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ erro: 'Falha na apuração', detalhe: msg });
  }
});

// GET /v1/apuracao/:competencia/:cnpj — memória de cálculo
router.get('/:competencia/:cnpj', async (req: Request, res: Response) => {
  const competencia = req.params['competencia'] as string;
  const cnpj = (req.params['cnpj'] as string).replace(/\D/g, '');

  const r = await query(
    `SELECT ap.*, e.nome, e.regime
     FROM apuracoes ap
     JOIN empresas e ON e.id = ap.empresa_id
     WHERE ap.competencia = $1 AND e.cnpj = $2`,
    [competencia, cnpj]
  );

  if (r.rows.length === 0) {
    res.status(404).json({ erro: 'Apuração não encontrada' });
    return;
  }

  res.json(r.rows[0]);
});

// GET /v1/apuracao/:competencia/:cnpj/guia — dados da guia
router.get('/:competencia/:cnpj/guia', async (req: Request, res: Response) => {
  const competencia = req.params['competencia'] as string;
  const cnpj = (req.params['cnpj'] as string).replace(/\D/g, '');

  const r = await query(
    `SELECT ap.regime, ap.das_devido, ap.pis_devido, ap.cofins_devida,
            ap.iss_devido, ap.icms_devido, ap.irpj_devido, ap.csll_devida,
            ap.vencimento_das, ap.vencimento_irpj_csll,
            e.nome, e.cnpj, e.municipio_ibge, e.uf
     FROM apuracoes ap
     JOIN empresas e ON e.id = ap.empresa_id
     WHERE ap.competencia = $1 AND e.cnpj = $2 AND ap.status = 'aprovada'`,
    [competencia, cnpj]
  );

  if (r.rows.length === 0) {
    res.status(404).json({ erro: 'Apuração aprovada não encontrada para esta competência e CNPJ' });
    return;
  }

  const ap = r.rows[0];
  const guias: Record<string, unknown>[] = [];

  if (ap.regime === 'simples' && ap.das_devido > 0) {
    guias.push({ tipo: 'DAS', valor: Number(ap.das_devido), vencimento: ap.vencimento_das });
  }
  if (ap.regime === 'presumido') {
    if (Number(ap.pis_devido ?? 0) > 0)    guias.push({ tipo: 'DARF-PIS',    valor: Number(ap.pis_devido),    vencimento: null });
    if (Number(ap.cofins_devida ?? 0) > 0) guias.push({ tipo: 'DARF-COFINS', valor: Number(ap.cofins_devida), vencimento: null });
    if (Number(ap.iss_devido ?? 0) > 0)    guias.push({ tipo: 'DAM-ISS',     valor: Number(ap.iss_devido),    vencimento: null });
    if (Number(ap.icms_devido ?? 0) > 0)   guias.push({ tipo: 'GNRE-ICMS',   valor: Number(ap.icms_devido),   vencimento: null });
    if (Number(ap.irpj_devido ?? 0) > 0)   guias.push({ tipo: 'DARF-IRPJ',   valor: Number(ap.irpj_devido),   vencimento: ap.vencimento_irpj_csll });
    if (Number(ap.csll_devida ?? 0) > 0)   guias.push({ tipo: 'DARF-CSLL',   valor: Number(ap.csll_devida),   vencimento: ap.vencimento_irpj_csll });
  }

  res.json({ competencia, cnpj: ap.cnpj, nome: ap.nome, guias });
});

export default router;
