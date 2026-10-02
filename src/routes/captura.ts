import { Router, Request, Response } from 'express';
import { capturar } from '../services/captura/CapturaService';
import { query } from '../config/database';

const router = Router();

// POST /v1/captura/importar
// Body: { competencia: "YYYY-MM" }
router.post('/importar', async (req: Request, res: Response) => {
  const { competencia } = req.body as { competencia?: string };
  const comp = Array.isArray(competencia) ? competencia[0] : competencia;

  if (!comp || !/^\d{4}-\d{2}$/.test(comp)) {
    res.status(400).json({ erro: 'Campo "competencia" obrigatório no formato YYYY-MM' });
    return;
  }

  try {
    const resultados = await capturar(comp);

    const ok = resultados.filter(r => r.status === 'ok').length;
    const semMovimento = resultados.filter(r => r.status === 'sem_movimento').length;
    const erros = resultados.filter(r => r.status === 'erro').length;

    res.json({
      competencia: comp,
      resumo: {
        total_empresas: resultados.length,
        ok,
        sem_movimento: semMovimento,
        com_erro: erros,
        total_notas_importadas: resultados.reduce((s, r) => s + r.notas_importadas, 0),
        total_duplicatas_ignoradas: resultados.reduce((s, r) => s + r.notas_ignoradas_duplicatas, 0),
      },
      empresas: resultados.map(r => ({
        empresa_id: r.empresa_id,
        cnpj: r.cnpj,
        nome: r.nome,
        status: r.status,
        notas_importadas: r.notas_importadas,
        duplicatas_ignoradas: r.notas_ignoradas_duplicatas,
        erros: r.erros.length > 0 ? r.erros : undefined,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Erro na captura:', err);
    res.status(500).json({ erro: 'Falha na captura', detalhe: msg });
  }
});

// GET /v1/captura/status/:competencia
router.get('/status/:competencia', async (req: Request, res: Response) => {
  const competencia = req.params['competencia'] as string;

  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    res.status(400).json({ erro: 'Competência inválida. Use YYYY-MM' });
    return;
  }

  try {
    const result = await query(
      `SELECT
         e.id, e.cnpj, e.nome, e.regime,
         fe.status, fe.detalhe, fe.atualizado_em,
         COUNT(n.id) FILTER (WHERE n.cancelada = false) AS total_notas,
         SUM(n.valor_bruto) FILTER (WHERE n.cancelada = false) AS receita_bruta
       FROM empresas e
       LEFT JOIN fechamentos_estado fe
         ON fe.empresa_id = e.id AND fe.competencia = $1 AND fe.etapa = 'captura'
       LEFT JOIN notas n
         ON n.empresa_id = e.id AND n.competencia = $1
       WHERE e.ativo = true
       GROUP BY e.id, e.cnpj, e.nome, e.regime, fe.status, fe.detalhe, fe.atualizado_em
       ORDER BY e.nome`,
      [competencia]
    );

    const empresas = result.rows.map(r => ({
      empresa_id: r.id,
      cnpj: r.cnpj,
      nome: r.nome,
      regime: r.regime,
      status_captura: r.status ?? 'pendente',
      detalhe: r.detalhe,
      total_notas: Number(r.total_notas ?? 0),
      receita_bruta: Number(r.receita_bruta ?? 0),
      atualizado_em: r.atualizado_em,
    }));

    res.json({ competencia, empresas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ erro: 'Falha ao consultar status', detalhe: msg });
  }
});

export default router;
