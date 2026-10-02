import { query } from '../../config/database';

export interface EmpresaConferencia {
  empresa_id: number;
  cnpj: string;
  nome: string;
  regime: string;
  status_captura: 'ok' | 'pendente' | 'erro' | 'sem_movimento';
  total_notas: number;
  notas_prestadas: number;
  notas_tomadas: number;
  notas_mercadorias: number;
  receita_bruta: number;
  total_retencoes: number;
  alertas: AlertaConferencia[];
  status_geral: 'ok' | 'atencao' | 'bloqueada';
}

export interface AlertaConferencia {
  gravidade: 'info' | 'atencao' | 'bloqueio';
  codigo: string;
  descricao: string;
  chave_nota?: string;
}

export interface RelatorioConferencia {
  competencia: string;
  gerado_em: string;
  resumo: {
    total_empresas: number;
    empresas_ok: number;
    empresas_atencao: number;
    empresas_bloqueadas: number;
    empresas_sem_movimento: number;
    total_notas: number;
    receita_bruta_total: number;
  };
  empresas: EmpresaConferencia[];
  pendencias: AlertaConferencia[];
}

export async function gerarRelatorioConferencia(competencia: string): Promise<RelatorioConferencia> {
  // Dados base de cada empresa
  const empRes = await query(
    `SELECT
       e.id, e.cnpj, e.nome, e.regime,
       fe.status AS status_captura,
       COUNT(n.id)                                                                       AS total_notas,
       COUNT(n.id) FILTER (WHERE n.natureza = 'servico_prestado' AND NOT n.cancelada)   AS notas_prestadas,
       COUNT(n.id) FILTER (WHERE n.natureza = 'servico_tomado'   AND NOT n.cancelada)   AS notas_tomadas,
       COUNT(n.id) FILTER (WHERE n.natureza IN ('venda','compra') AND NOT n.cancelada)  AS notas_mercadorias,
       COALESCE(SUM(n.valor_bruto)  FILTER (WHERE n.natureza = 'servico_prestado' AND NOT n.cancelada), 0) AS receita_servicos,
       COALESCE(SUM(n.valor_bruto)  FILTER (WHERE n.natureza = 'venda'            AND NOT n.cancelada), 0) AS receita_comercio,
       COALESCE(SUM(n.ret_pis + n.ret_cofins + n.ret_csll + n.ret_irrf + n.ret_inss)
                FILTER (WHERE NOT n.cancelada), 0)                                      AS total_retencoes
     FROM empresas e
     LEFT JOIN fechamentos_estado fe
       ON fe.empresa_id = e.id AND fe.competencia = $1 AND fe.etapa = 'captura'
     LEFT JOIN notas n
       ON n.empresa_id = e.id AND n.competencia = $1
     WHERE e.ativo = true
     GROUP BY e.id, e.cnpj, e.nome, e.regime, fe.status
     ORDER BY e.nome`,
    [competencia]
  );

  // Notas canceladas/substituídas com substituta já registrada
  const canceladasSemSubst = await query(
    `SELECT e.id AS empresa_id, n.chave_acesso, n.numero
     FROM notas n JOIN empresas e ON e.id = n.empresa_id
     WHERE n.competencia = $1 AND n.cancelada = true AND n.chave_substituta IS NULL`,
    [competencia]
  );
  const canceladasMap: Record<number, string[]> = {};
  for (const row of canceladasSemSubst.rows) {
    const eid = Number(row['empresa_id']);
    if (!canceladasMap[eid]) canceladasMap[eid] = [];
    canceladasMap[eid].push(String(row['chave_acesso']));
  }

  // Variação de faturamento vs mês anterior
  const mesAnterior = (() => {
    const [ano, mes] = competencia.split('-').map(Number);
    const d = new Date(ano!, mes! - 1, 1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();

  const receitaAnterior = await query(
    `SELECT empresa_id,
       COALESCE(SUM(valor_bruto) FILTER (WHERE natureza IN ('servico_prestado','venda') AND NOT cancelada), 0) AS receita
     FROM notas WHERE competencia = $1 GROUP BY empresa_id`,
    [mesAnterior]
  );
  const recAntMap: Record<number, number> = {};
  for (const row of receitaAnterior.rows) {
    recAntMap[Number(row['empresa_id'])] = Number(row['receita'] ?? 0);
  }

  const LIMITE_VARIACAO = 0.30;
  const empresas: EmpresaConferencia[] = [];

  for (const row of empRes.rows) {
    const empresaId = Number(row['id']);
    const receitaBruta = Number(row['receita_servicos'] ?? 0) + Number(row['receita_comercio'] ?? 0);
    const alertas: AlertaConferencia[] = [];

    // Captura com erro
    const statusCaptura = (row['status_captura'] ?? 'pendente') as EmpresaConferencia['status_captura'];
    if (statusCaptura === 'erro') {
      alertas.push({ gravidade: 'bloqueio', codigo: 'CAPTURA_ERRO', descricao: 'Captura de XMLs falhou nesta competência.' });
    }

    // Sem notas
    if (Number(row['total_notas'] ?? 0) === 0 && statusCaptura === 'ok') {
      alertas.push({ gravidade: 'atencao', codigo: 'SEM_MOVIMENTO', descricao: 'Empresa sem notas importadas — confirmar se é sem movimento.' });
    }

    // Canceladas sem substituta
    const canceladas = canceladasMap[empresaId] ?? [];
    for (const chave of canceladas) {
      alertas.push({ gravidade: 'atencao', codigo: 'CANCELADA_SEM_SUBST', descricao: 'Nota cancelada sem nota substituta registrada.', chave_nota: chave });
    }

    // Variação de faturamento
    const recAnt = recAntMap[empresaId] ?? 0;
    if (recAnt > 0 && receitaBruta > 0) {
      const variacao = Math.abs(receitaBruta - recAnt) / recAnt;
      if (variacao > LIMITE_VARIACAO) {
        const sinal = receitaBruta > recAnt ? '+' : '-';
        alertas.push({
          gravidade: 'atencao',
          codigo: 'VARIACAO_FATURAMENTO',
          descricao: `Faturamento ${sinal}${(variacao * 100).toFixed(1)}% vs mês anterior (R$ ${recAnt.toFixed(2)} → R$ ${receitaBruta.toFixed(2)}).`,
        });
      }
    }

    // Regime x natureza: empresa só de serviços com nota de mercadoria
    if (row['regime'] === 'simples' && Number(row['notas_mercadorias'] ?? 0) > 0 && Number(row['notas_prestadas'] ?? 0) > 0) {
      alertas.push({ gravidade: 'info', codigo: 'MISTO_SERVICO_MERCADORIA', descricao: 'Empresa com notas de serviço e mercadoria — verificar se o anexo do Simples está correto.' });
    }

    const statusGeral: EmpresaConferencia['status_geral'] =
      alertas.some(a => a.gravidade === 'bloqueio') ? 'bloqueada' :
      alertas.some(a => a.gravidade === 'atencao')  ? 'atencao'   : 'ok';

    empresas.push({
      empresa_id: empresaId,
      cnpj: String(row['cnpj']),
      nome: String(row['nome']),
      regime: String(row['regime']),
      status_captura: statusCaptura,
      total_notas: Number(row['total_notas'] ?? 0),
      notas_prestadas: Number(row['notas_prestadas'] ?? 0),
      notas_tomadas: Number(row['notas_tomadas'] ?? 0),
      notas_mercadorias: Number(row['notas_mercadorias'] ?? 0),
      receita_bruta: receitaBruta,
      total_retencoes: Number(row['total_retencoes'] ?? 0),
      alertas,
      status_geral: statusGeral,
    });
  }

  // Pendências globais ordenadas por gravidade
  const pendencias = empresas
    .flatMap(e => e.alertas.map(a => ({ ...a, empresa: e.nome })))
    .sort((a, b) => {
      const ordem = { bloqueio: 0, atencao: 1, info: 2 };
      return ordem[a.gravidade] - ordem[b.gravidade];
    });

  const semMovimento = empresas.filter(e => e.status_captura === 'sem_movimento' || e.total_notas === 0).length;

  return {
    competencia,
    gerado_em: new Date().toISOString(),
    resumo: {
      total_empresas: empresas.length,
      empresas_ok:          empresas.filter(e => e.status_geral === 'ok').length,
      empresas_atencao:     empresas.filter(e => e.status_geral === 'atencao').length,
      empresas_bloqueadas:  empresas.filter(e => e.status_geral === 'bloqueada').length,
      empresas_sem_movimento: semMovimento,
      total_notas:          empresas.reduce((s, e) => s + e.total_notas, 0),
      receita_bruta_total:  empresas.reduce((s, e) => s + e.receita_bruta, 0),
    },
    empresas,
    pendencias,
  };
}
