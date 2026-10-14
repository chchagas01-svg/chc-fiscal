import { Router } from 'express';
import { query } from '../config/database';
import { parseXml, aplicarNatureza } from '../services/parsers';
import { inserirNota, competenciaDaNota } from '../services/captura/CapturaService';
import { ParsedNota } from '../types/nota';

const router = Router();

// Natureza da nota do ponto de vista da empresa; null se a empresa não participa do documento
function naturezaParaEmpresa(nota: ParsedNota, cnpjEmpresa: string): ParsedNota['natureza'] | null {
  const emitente = nota.cnpjEmitente === cnpjEmpresa;
  const tomador  = nota.cnpjTomador  === cnpjEmpresa;
  if (!emitente && !tomador) return null;
  if (nota.tipoDoc === 'cte') return nota.natureza;
  if (nota.tipoDoc === 'nfse') return emitente ? 'servico_prestado' : 'servico_tomado';
  return emitente ? nota.natureza : 'compra'; // NF-e emitida pela empresa: parser já usa tpNF
}

// POST /v1/notas/importar-xml — importa XMLs avulsos (NFS-e/NF-e/CT-e) enviados pelo painel
// Body: { empresa_id, xmls: [{ nome, conteudo }] }
// A competência vem do próprio documento (NFS-e: competência declarada; demais: mês de emissão).
router.post('/importar-xml', async (req, res) => {
  const { empresa_id, xmls } = req.body as {
    empresa_id?: number;
    xmls?: { nome?: string; conteudo?: string }[];
  };
  if (!empresa_id || !Array.isArray(xmls) || xmls.length === 0)
    return res.status(400).json({ erro: 'Campos obrigatórios: empresa_id, xmls[]' });

  const empRes = await query<{ id: number; cnpj: string }>(
    `SELECT id, cnpj FROM empresas WHERE id = $1`, [Number(empresa_id)]
  );
  const empresa = empRes.rows[0];
  if (!empresa) return res.status(404).json({ erro: 'Empresa não encontrada' });
  const cnpjEmpresa = empresa.cnpj.replace(/\D/g, '');

  const resultados: Record<string, unknown>[] = [];
  for (const arq of xmls) {
    const nome = arq.nome ?? 'xml';
    try {
      const notas = await parseXml(String(arq.conteudo ?? '').replace(/^﻿/, ''));
      for (const nota of notas) {
        const natureza = naturezaParaEmpresa(nota, cnpjEmpresa);
        if (!natureza) {
          resultados.push({ arquivo: nome, numero: nota.numero, status: 'erro',
            erro: `Empresa não é emitente nem tomadora (emitente ${nota.cnpjEmitente}, tomador ${nota.cnpjTomador ?? '-'})` });
          continue;
        }
        const competencia = competenciaDaNota(nota, new Date().toISOString().substring(0, 7));
        const inserida = await inserirNota(empresa.id, competencia, aplicarNatureza(nota, natureza));
        resultados.push({
          arquivo: nome, numero: nota.numero, emitente: nota.nomeEmitente, valor: nota.valorBruto,
          natureza, competencia, status: inserida ? 'importada' : 'duplicada',
        });
      }
    } catch (err) {
      resultados.push({ arquivo: nome, status: 'erro', erro: err instanceof Error ? err.message : String(err) });
    }
  }

  return res.json({
    importadas: resultados.filter(r => r['status'] === 'importada').length,
    duplicadas: resultados.filter(r => r['status'] === 'duplicada').length,
    erros:      resultados.filter(r => r['status'] === 'erro').length,
    resultados,
  });
});

// POST /v1/notas/recalcular-competencia — move NFS-e já importadas para a competência declarada no XML
// Body: { empresa_id?, aplicar?: boolean } — sem aplicar=true apenas lista as divergências
router.post('/recalcular-competencia', async (req, res) => {
  const { empresa_id, aplicar } = req.body as { empresa_id?: number; aplicar?: boolean };
  const params: unknown[] = [];
  let filtro = '';
  if (empresa_id) { params.push(Number(empresa_id)); filtro = `AND n.empresa_id = $1`; }

  const r = await query<{ id: number; empresa: string; numero: string; competencia: string; xml_raw: string }>(
    `SELECT n.id, e.nome AS empresa, n.numero, n.competencia, n.xml_raw
       FROM notas n JOIN empresas e ON e.id = n.empresa_id
      WHERE n.tipo_doc = 'nfse' AND n.xml_raw IS NOT NULL ${filtro}`,
    params
  );

  const divergentes: Record<string, unknown>[] = [];
  for (const row of r.rows) {
    try {
      const notas = await parseXml(row.xml_raw);
      const comp = notas[0]?.competencia;
      if (comp && comp !== row.competencia)
        divergentes.push({ id: row.id, empresa: row.empresa, numero: row.numero, de: row.competencia, para: comp });
    } catch { /* XML que não reparseia fica como está */ }
  }

  if (aplicar) {
    for (const d of divergentes)
      await query(`UPDATE notas SET competencia = $2 WHERE id = $1`, [d['id'], d['para']]);
  }
  return res.json({ analisadas: r.rows.length, divergentes: divergentes.length, aplicado: Boolean(aplicar), notas: divergentes });
});

// GET /v1/notas/empresas — lista empresas ativas para o seletor
router.get('/empresas', async (_req, res) => {
  const result = await query<{ id: number; nome: string; cnpj: string; regime: string }>(
    `SELECT id, nome, cnpj, regime FROM empresas WHERE ativo = true ORDER BY nome`
  );
  return res.json(result.rows);
});

// GET /v1/notas?empresa_id=X&competencia=YYYY-MM
router.get('/', async (req, res) => {
  const { empresa_id, competencia } = req.query;

  if (!empresa_id || !competencia) {
    return res.status(400).json({ erro: 'empresa_id e competencia são obrigatórios' });
  }

  const empRes = await query<{ id: number; nome: string; cnpj: string }>(
    `SELECT id, nome, cnpj FROM empresas WHERE id = $1`,
    [Number(empresa_id)]
  );
  if (empRes.rows.length === 0) {
    return res.status(404).json({ erro: 'Empresa não encontrada' });
  }

  const notasRes = await query<Record<string, unknown>>(
    `SELECT
       id, chave_acesso, tipo_doc, numero, serie, data_emissao, natureza,
       cnpj_emitente, nome_emitente, cnpj_tomador, nome_tomador,
       valor_bruto, valor_deducoes, valor_liquido,
       iss_retido, valor_iss,
       ret_pis, ret_cofins, ret_csll, ret_irrf, ret_inss,
       icms_debito, icms_credito, finalidade_entrada,
       cancelada, importado_em
     FROM notas
     WHERE empresa_id = $1 AND competencia = $2
     ORDER BY data_emissao, CAST(NULLIF(regexp_replace(numero, '\\D','','g'), '') AS bigint) NULLS LAST, id`,
    [Number(empresa_id), String(competencia)]
  );

  const rows = notasRes.rows;
  const saida  = rows.filter(n => n.natureza === 'servico_prestado' || n.natureza === 'venda');
  const entrada = rows.filter(n => n.natureza === 'servico_tomado'  || n.natureza === 'compra');
  const outros  = rows.filter(n => !saida.includes(n) && !entrada.includes(n));

  const soma = (arr: Record<string, unknown>[], campo: string) =>
    arr.filter(n => !n['cancelada']).reduce((s, n) => s + parseFloat(String(n[campo] ?? 0)), 0);

  return res.json({
    empresa:    empRes.rows[0],
    competencia,
    resumo: {
      saida: {
        total: saida.length,
        ativos: saida.filter(n => !n['cancelada']).length,
        canceladas: saida.filter(n => n['cancelada']).length,
        valor_bruto:   soma(saida, 'valor_bruto'),
        valor_liquido: soma(saida, 'valor_liquido'),
      },
      entrada: {
        total: entrada.length,
        ativos: entrada.filter(n => !n['cancelada']).length,
        canceladas: entrada.filter(n => n['cancelada']).length,
        valor_bruto:   soma(entrada, 'valor_bruto'),
        valor_liquido: soma(entrada, 'valor_liquido'),
      },
    },
    saida,
    entrada,
    outros,
  });
});

// POST /v1/notas/reprocessar-retencoes — relê as retenções federais/ISS do XML das notas já importadas
// Body: { empresa_id?, competencia?, natureza?, aplicar?: boolean } — sem aplicar=true apenas lista as diferenças
// ATENÇÃO: retenções de servico_prestado entram na apuração — reprocessar prestadas altera impostos.
router.post('/reprocessar-retencoes', async (req, res) => {
  const { empresa_id, competencia, natureza, aplicar } =
    req.body as { empresa_id?: number; competencia?: string; natureza?: string; aplicar?: boolean };
  const conds = [`n.xml_raw IS NOT NULL`, `n.tipo_doc = 'nfse'`, `NOT n.retencao_manual`];
  const params: unknown[] = [];
  if (empresa_id)  { params.push(Number(empresa_id)); conds.push(`n.empresa_id = $${params.length}`); }
  if (competencia) { params.push(String(competencia)); conds.push(`n.competencia = $${params.length}`); }
  if (natureza)    { params.push(String(natureza));    conds.push(`n.natureza = $${params.length}`); }

  const campos = ['ret_irrf', 'ret_pis', 'ret_cofins', 'ret_csll', 'ret_inss', 'iss_retido', 'valor_iss', 'valor_liquido'] as const;
  const r = await query<Record<string, unknown>>(
    `SELECT n.id, e.nome AS empresa, n.numero, n.competencia, n.natureza, n.xml_raw, ${campos.map(c => 'n.' + c).join(', ')}
       FROM notas n JOIN empresas e ON e.id = n.empresa_id WHERE ${conds.join(' AND ')}`,
    params
  );

  const alteradas: Record<string, unknown>[] = [];
  for (const row of r.rows) {
    let nota: ParsedNota | undefined;
    try { nota = (await parseXml(String(row['xml_raw'])))[0]; } catch { continue; }
    if (!nota) continue;
    const novo: Record<(typeof campos)[number], number | boolean> = {
      ret_irrf: nota.retIrrf, ret_pis: nota.retPis, ret_cofins: nota.retCofins,
      ret_csll: nota.retCsll, ret_inss: nota.retInss,
      iss_retido: nota.issRetido, valor_iss: nota.valorIss, valor_liquido: nota.valorLiquido,
    };
    const diff: Record<string, unknown> = {};
    for (const c of campos) {
      const atual = row[c];
      const igual = typeof novo[c] === 'boolean'
        ? Boolean(atual) === novo[c]
        : Math.abs(parseFloat(String(atual ?? 0)) - Number(novo[c])) < 0.005;
      if (!igual) diff[c] = { de: atual, para: novo[c] };
    }
    if (Object.keys(diff).length === 0) continue;
    alteradas.push({ id: row['id'], empresa: row['empresa'], numero: row['numero'],
      competencia: row['competencia'], natureza: row['natureza'], alteracoes: diff });
    if (aplicar) {
      await query(
        `UPDATE notas SET ${campos.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [row['id'], ...campos.map(c => novo[c])]
      );
    }
  }
  return res.json({ analisadas: r.rows.length, alteradas: alteradas.length, aplicado: Boolean(aplicar), notas: alteradas });
});

// POST /v1/notas/reparsear — relê o XML já salvo com o parser atual e corrige TODOS os campos
// (emitente, tomador, valores, competência, retenções) — não só retenções como o endpoint acima.
// Usado para consertar notas corrompidas por bugs antigos de parser (ex.: Prestador/Tomador
// perdido em layouts municipais que fogem do padrão ABRASF usual).
// Body: { ids?: number[], empresa_id?, competencia?, aplicar?: boolean }
// NUNCA altera 'natureza' automaticamente — se o emitente corrigido não bater com o esperado
// pela natureza atual, a nota entra em 'suspeitas' para revisão manual em vez de ser aplicada.
router.post('/reparsear', async (req, res) => {
  const { ids, empresa_id, competencia, aplicar } = req.body as
    { ids?: number[]; empresa_id?: number; competencia?: string; aplicar?: boolean };

  const conds = [`n.xml_raw IS NOT NULL`];
  const params: unknown[] = [];
  if (ids && ids.length > 0) { params.push(ids); conds.push(`n.id = ANY($${params.length}::int[])`); }
  if (empresa_id)  { params.push(Number(empresa_id)); conds.push(`n.empresa_id = $${params.length}`); }
  if (competencia) { params.push(String(competencia)); conds.push(`n.competencia = $${params.length}`); }

  const r = await query<Record<string, unknown>>(
    `SELECT n.*, e.cnpj AS empresa_cnpj, e.nome AS empresa_nome
       FROM notas n JOIN empresas e ON e.id = n.empresa_id
      WHERE ${conds.join(' AND ')}`,
    params
  );

  const CAMPOS_BASE = [
    'numero', 'cnpj_emitente', 'nome_emitente', 'cnpj_tomador', 'nome_tomador',
    'valor_bruto', 'valor_deducoes', 'valor_liquido', 'iss_retido', 'valor_iss', 'competencia',
  ] as const;
  const CAMPOS_RETENCAO = ['ret_pis', 'ret_cofins', 'ret_csll', 'ret_irrf', 'ret_inss'] as const;

  const alteradas: Record<string, unknown>[] = [];
  const suspeitas: Record<string, unknown>[] = [];

  for (const row of r.rows) {
    let nota: ParsedNota | undefined;
    try { nota = (await parseXml(String(row['xml_raw'])))[0]; } catch { continue; }
    if (!nota) continue;

    const cnpjEmpresa = String(row['empresa_cnpj']).replace(/\D/g, '');
    const naturezaEsperada = naturezaParaEmpresa(nota, cnpjEmpresa);
    const comp = competenciaDaNota(nota, String(row['competencia']));

    // Retenção conferida manualmente no painel (aba Retenções) fica protegida — só os
    // demais campos (emitente/tomador/valores/competência) são corrigidos para essas notas.
    const protegeRetencao = Boolean(row['retencao_manual']);
    const camposComparados = protegeRetencao ? CAMPOS_BASE : [...CAMPOS_BASE, ...CAMPOS_RETENCAO];

    const novo: Record<string, unknown> = {
      numero: nota.numero ?? null,
      cnpj_emitente: nota.cnpjEmitente || null, nome_emitente: nota.nomeEmitente || null,
      cnpj_tomador: nota.cnpjTomador || null, nome_tomador: nota.nomeTomador || null,
      valor_bruto: nota.valorBruto, valor_deducoes: nota.valorDeducoes, valor_liquido: nota.valorLiquido,
      iss_retido: nota.issRetido, valor_iss: nota.valorIss, competencia: comp,
      ...(protegeRetencao ? {} : {
        ret_pis: nota.retPis, ret_cofins: nota.retCofins, ret_csll: nota.retCsll,
        ret_irrf: nota.retIrrf, ret_inss: nota.retInss,
      }),
    };

    const diff: Record<string, unknown> = {};
    for (const c of camposComparados) {
      const atual = row[c];
      const igual = typeof novo[c] === 'boolean'
        ? Boolean(atual) === novo[c]
        : typeof novo[c] === 'number'
          ? Math.abs(parseFloat(String(atual ?? 0)) - Number(novo[c])) < 0.005
          : String(atual ?? '') === String(novo[c] ?? '');
      if (!igual) diff[c] = { de: atual, para: novo[c] };
    }
    if (Object.keys(diff).length === 0) continue;

    const item = {
      id: row['id'], empresa: row['empresa_nome'], numero_atual: row['numero'],
      natureza: row['natureza'], cancelada: row['cancelada'], alteracoes: diff,
    };

    // Já existe outra nota ATIVA com o emitente correto, mesmo número/competência/natureza?
    // (ex.: bug antigo gravou a nota com emitente vazio e depois uma recaptura trouxe a
    // versão certa como registro separado — são o mesmo documento, não duas notas)
    if (!row['cancelada']) {
      const dup = await query<{ id: number }>(
        `SELECT id FROM notas
          WHERE empresa_id = $1 AND tipo_doc = 'nfse' AND numero = $2 AND natureza = $3
            AND cancelada = false AND id != $4 AND cnpj_emitente = $5
          LIMIT 1`,
        [row['empresa_id'], novo['numero'], row['natureza'], row['id'], novo['cnpj_emitente']]
      );
      if (dup.rows[0]) {
        const dupItem = { ...item, status: 'duplicata_de', duplicata_da_nota_id: dup.rows[0].id };
        suspeitas.push({ ...dupItem, motivo: `Já existe a nota ${dup.rows[0].id} com o emitente correto para este número — esta parece ser uma duplicata corrompida. ${aplicar ? 'Cancelada automaticamente.' : 'Revisar antes de cancelar.'}` });
        if (aplicar) await query(`UPDATE notas SET cancelada = true WHERE id = $1`, [row['id']]);
        continue;
      }
    }

    // Natureza divergente da esperada pelo emitente/tomador corrigidos → não mexe sozinho
    if (naturezaEsperada && naturezaEsperada !== row['natureza']) {
      suspeitas.push({ ...item, natureza_esperada: naturezaEsperada,
        motivo: `Após corrigir emitente/tomador, a natureza esperada seria '${naturezaEsperada}', mas a nota está como '${row['natureza']}'. Revisar manualmente.` });
      continue;
    }
    if (!naturezaEsperada) {
      suspeitas.push({ ...item, motivo: 'Empresa não é emitente nem tomadora no XML corrigido — nota pode pertencer a outra empresa.' });
      continue;
    }

    alteradas.push(item);
    if (aplicar) {
      const sets = camposComparados.map((c, i) => `${c} = $${i + 2}`).join(', ');
      await query(`UPDATE notas SET ${sets} WHERE id = $1`, [row['id'], ...camposComparados.map(c => novo[c])]);
    }
  }

  return res.json({
    analisadas: r.rows.length, alteradas: alteradas.length, suspeitas: suspeitas.length,
    aplicado: Boolean(aplicar), notas: alteradas, notas_suspeitas: suspeitas,
  });
});

// GET /v1/notas/:id/xml — XML original da nota
router.get('/:id/xml', async (req, res) => {
  const r = await query<{ numero: string; xml_raw: string | null }>(
    `SELECT numero, xml_raw FROM notas WHERE id = $1`, [Number(req.params['id'])]
  );
  const nota = r.rows[0];
  if (!nota?.xml_raw) return res.status(404).json({ erro: 'XML não disponível para esta nota' });
  res.setHeader('Content-Disposition', `attachment; filename="nota-${nota.numero ?? req.params['id']}.xml"`);
  return res.type('application/xml').send(nota.xml_raw);
});

// PATCH /v1/notas/:id — atualiza campos de uma nota
router.patch('/:id', async (req, res) => {
  const id = Number(req.params['id']);
  if (!id) return res.status(400).json({ erro: 'ID inválido' });

  const campos: Record<string, unknown> = {};
  const permitidos = [
    'numero', 'data_emissao', 'natureza', 'nome_emitente', 'nome_tomador',
    'valor_bruto', 'valor_deducoes', 'valor_liquido',
    'iss_retido', 'valor_iss',
    'ret_pis', 'ret_cofins', 'ret_csll', 'ret_irrf', 'ret_inss',
    'icms_debito', 'icms_credito', 'cancelada', 'cfop', 'competencia', 'retencao_manual',
    'finalidade_entrada',
  ] as const;

  // Retenção editada à mão fica protegida do reprocessamento do XML (a menos que venha retencao_manual=false)
  const camposRet = ['ret_pis', 'ret_cofins', 'ret_csll', 'ret_irrf', 'ret_inss'];
  if (camposRet.some(k => k in req.body) && !('retencao_manual' in req.body)) req.body.retencao_manual = true;

  // Finalidade da compra (Resumo Mensal/Difal): revenda, industrializacao, ativo, outras (uso/consumo) ou null
  if ('finalidade_entrada' in req.body && req.body.finalidade_entrada != null &&
      !['revenda', 'industrializacao', 'ativo', 'outras'].includes(String(req.body.finalidade_entrada)))
    return res.status(400).json({ erro: 'finalidade_entrada deve ser revenda, industrializacao, ativo, outras ou null' });

  if ('competencia' in req.body && !/^\d{4}-\d{2}$/.test(String(req.body.competencia)))
    return res.status(400).json({ erro: 'competencia deve estar no formato YYYY-MM' });

  for (const k of permitidos) {
    if (k in req.body) campos[k] = req.body[k];
  }

  if (Object.keys(campos).length === 0)
    return res.status(400).json({ erro: 'Nenhum campo válido para atualizar' });

  const sets = Object.keys(campos).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const vals = Object.values(campos);

  const r = await query(
    `UPDATE notas SET ${sets} WHERE id = $1 RETURNING id`,
    [id, ...vals]
  );
  if ((r.rowCount ?? 0) === 0) return res.status(404).json({ erro: 'Nota não encontrada' });
  return res.json({ ok: true, id });
});

// DELETE /v1/notas/:id — cancela (soft) ou exclui fisicamente
// Query param: ?excluir=true para exclusão física
router.delete('/:id', async (req, res) => {
  const id = Number(req.params['id']);
  if (!id) return res.status(400).json({ erro: 'ID inválido' });

  if (req.query['excluir'] === 'true') {
    const r = await query(`DELETE FROM notas WHERE id = $1 RETURNING id`, [id]);
    if ((r.rowCount ?? 0) === 0) return res.status(404).json({ erro: 'Nota não encontrada' });
    return res.json({ ok: true, excluida: true, id });
  }

  const r = await query(
    `UPDATE notas SET cancelada = true WHERE id = $1 RETURNING id`,
    [id]
  );
  if ((r.rowCount ?? 0) === 0) return res.status(404).json({ erro: 'Nota não encontrada' });
  return res.json({ ok: true, cancelada: true, id });
});

// DELETE /v1/notas?empresa_id=X&competencia=YYYY-MM — exclui todas as notas do mês (para recapturar)
router.delete('/', async (req, res) => {
  const empresaId = Number(req.query['empresa_id']);
  const competencia = String(req.query['competencia'] ?? '');
  if (!empresaId || !/^\d{4}-\d{2}$/.test(competencia))
    return res.status(400).json({ erro: 'empresa_id e competencia (YYYY-MM) são obrigatórios' });

  const r = await query(
    `DELETE FROM notas WHERE empresa_id = $1 AND competencia = $2`,
    [empresaId, competencia]
  );
  return res.json({ ok: true, excluidas: r.rowCount ?? 0 });
});

// POST /v1/notas — cria nota manual
router.post('/', async (req, res) => {
  const b = req.body as Record<string, unknown>;
  const { empresa_id, competencia, natureza, data_emissao, valor_bruto } = b;

  if (!empresa_id || !competencia || !natureza || !data_emissao || valor_bruto == null)
    return res.status(400).json({ erro: 'Campos obrigatórios: empresa_id, competencia, natureza, data_emissao, valor_bruto' });

  const chave = `MANUAL-${empresa_id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const vBruto  = Number(b['valor_bruto']    ?? 0);
  const vDed    = Number(b['valor_deducoes'] ?? 0);
  const vLiq    = Number(b['valor_liquido']  ?? vBruto - vDed);

  const r = await query(
    `INSERT INTO notas (
       empresa_id, chave_acesso, tipo_doc, numero, data_emissao, competencia,
       natureza, cfop,
       cnpj_emitente, nome_emitente, cnpj_tomador, nome_tomador,
       valor_bruto, valor_deducoes, valor_liquido,
       iss_retido, valor_iss,
       ret_pis, ret_cofins, ret_csll, ret_irrf, ret_inss,
       icms_debito, icms_credito, cancelada
     ) VALUES (
       $1,$2,'manual',$3,$4,$5,
       $6,$7,
       $8,$9,$10,$11,
       $12,$13,$14,
       $15,$16,
       $17,$18,$19,$20,$21,
       $22,$23,false
     ) RETURNING id`,
    [
      Number(empresa_id), chave,
      b['numero'] ?? null, data_emissao, competencia,
      natureza, b['cfop'] ?? null,
      b['cnpj_emitente'] ?? null, b['nome_emitente'] ?? null,
      b['cnpj_tomador'] ?? null, b['nome_tomador'] ?? null,
      vBruto, vDed, vLiq,
      Boolean(b['iss_retido']), Number(b['valor_iss'] ?? 0),
      Number(b['ret_pis']    ?? 0), Number(b['ret_cofins'] ?? 0),
      Number(b['ret_csll']   ?? 0), Number(b['ret_irrf']   ?? 0),
      Number(b['ret_inss']   ?? 0),
      0, 0,
    ]
  );
  return res.status(201).json({ ok: true, id: r.rows[0]['id'] });
});

export default router;
