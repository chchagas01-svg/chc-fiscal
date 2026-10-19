import crypto from 'crypto';
import { pool, query } from '../../config/database';

// Trava de exclusão: nenhuma rota apaga notas direto. A exclusão vira um pedido (pendente)
// e só é executada quando o responsável autoriza com a senha EXCLUSAO_SENHA, que fica só no
// servidor e é diferente da chave da API (quem só tem a chave da API, como uma automação,
// consegue pedir mas não consegue apagar). Sem a senha configurada, nada é apagado.
// As notas apagadas ficam copiadas em notas_excluidas e a decisão vai para o audit_log.

export interface Exclusao {
  id: number;
  tipo: 'nota' | 'mes';
  empresa_id: number;
  empresa_nome?: string;
  competencia: string;
  nota_id: number | null;
  qtd_notas: number;
  valor_total: number;
  motivo: string | null;
  status: 'pendente' | 'executada' | 'recusada';
  decidido_por: string | null;
  decidido_em: string | null;
  solicitado_em: string;
}

export class ErroExclusao extends Error {
  constructor(public status: number, mensagem: string) { super(mensagem); }
}

async function registrarAudit(competencia: string, empresaId: number, acao: string, payload: unknown, resultado: string) {
  await query(
    `INSERT INTO audit_log (competencia, empresa_id, acao, payload, resultado) VALUES ($1, $2, $3, $4, $5)`,
    [competencia, empresaId, acao, JSON.stringify(payload), resultado]
  );
}

// Cancelar (marcar cancelada) não apaga nada e pode ser desfeito, mas fica registrado
export async function registrarCancelamentoManual(notaIds: number[], origem: string): Promise<void> {
  if (notaIds.length === 0) return;
  const r = await query<{ id: number; empresa_id: number; competencia: string; numero: string | null }>(
    `SELECT id, empresa_id, competencia, numero FROM notas WHERE id = ANY($1::int[])`, [notaIds]
  );
  for (const n of r.rows) {
    await registrarAudit(n.competencia, n.empresa_id, 'nota_cancelada_manual', { id: n.id, numero: n.numero, origem }, 'cancelada');
  }
}

async function criarPedido(
  tipo: 'nota' | 'mes', empresaId: number, competencia: string, notaId: number | null,
  qtd: number, valor: number, motivo?: string
): Promise<Exclusao> {
  // Mesmo pedido já pendente: devolve o existente em vez de duplicar
  const existente = await query<Exclusao>(
    `SELECT * FROM exclusoes WHERE status = 'pendente' AND tipo = $1 AND empresa_id = $2
        AND competencia = $3 AND nota_id IS NOT DISTINCT FROM $4`,
    [tipo, empresaId, competencia, notaId]
  );
  if (existente.rows[0]) return existente.rows[0];
  const r = await query<Exclusao>(
    `INSERT INTO exclusoes (tipo, empresa_id, competencia, nota_id, qtd_notas, valor_total, motivo)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [tipo, empresaId, competencia, notaId, qtd, valor, motivo ?? null]
  );
  const pedido = r.rows[0]!;
  await registrarAudit(competencia, empresaId, 'exclusao_solicitada',
    { exclusao_id: pedido.id, tipo, nota_id: notaId, qtd_notas: qtd, motivo: motivo ?? null }, 'pendente');
  return pedido;
}

export async function solicitarExclusaoNota(notaId: number, motivo?: string): Promise<Exclusao> {
  const r = await query<{ empresa_id: number; competencia: string; valor_bruto: string }>(
    `SELECT empresa_id, competencia, valor_bruto FROM notas WHERE id = $1`, [notaId]
  );
  const nota = r.rows[0];
  if (!nota) throw new ErroExclusao(404, 'Nota não encontrada');
  return criarPedido('nota', nota.empresa_id, nota.competencia, notaId, 1, Number(nota.valor_bruto), motivo);
}

export async function solicitarExclusaoMes(empresaId: number, competencia: string, motivo?: string): Promise<Exclusao> {
  const r = await query<{ qtd: string; valor: string }>(
    `SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_bruto), 0) AS valor FROM notas WHERE empresa_id = $1 AND competencia = $2`,
    [empresaId, competencia]
  );
  const qtd = Number(r.rows[0]?.qtd ?? 0);
  if (qtd === 0) throw new ErroExclusao(404, 'Nenhuma nota nesta empresa e competência');
  return criarPedido('mes', empresaId, competencia, null, qtd, Number(r.rows[0]?.valor ?? 0), motivo);
}

export async function listarExclusoes(status?: string): Promise<Exclusao[]> {
  const r = await query<Exclusao>(
    `SELECT x.*, x.valor_total::float AS valor_total, e.nome AS empresa_nome
       FROM exclusoes x JOIN empresas e ON e.id = x.empresa_id
      WHERE ($1::text IS NULL OR x.status = $1)
      ORDER BY x.solicitado_em DESC LIMIT 200`,
    [status ?? null]
  );
  return r.rows;
}

function conferirSenha(senha: unknown): void {
  const correta = process.env['EXCLUSAO_SENHA'];
  if (!correta) throw new ErroExclusao(503, 'Exclusão bloqueada: a senha de autorização (EXCLUSAO_SENHA) não está configurada no servidor');
  const a = crypto.createHash('sha256').update(String(senha ?? '')).digest();
  const b = crypto.createHash('sha256').update(correta).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new ErroExclusao(403, 'Senha de autorização incorreta');
}

async function pedidoPendente(id: number): Promise<Exclusao> {
  const r = await query<Exclusao>(`SELECT * FROM exclusoes WHERE id = $1`, [id]);
  const pedido = r.rows[0];
  if (!pedido) throw new ErroExclusao(404, 'Pedido de exclusão não encontrado');
  if (pedido.status !== 'pendente') throw new ErroExclusao(409, `Pedido já ${pedido.status}`);
  return pedido;
}

// Executa a exclusão autorizada: copia as notas para notas_excluidas e apaga, numa transação
export async function autorizarExclusao(id: number, responsavel: string, senha: unknown): Promise<{ excluidas: number }> {
  if (!responsavel?.trim()) throw new ErroExclusao(400, 'Informe o nome de quem autoriza');
  conferirSenha(senha);
  const pedido = await pedidoPendente(id);

  const filtro: { sql: string; params: unknown[] } = pedido.tipo === 'nota'
    ? { sql: 'id = $1 AND empresa_id = $2', params: [pedido.nota_id, pedido.empresa_id] }
    : { sql: 'empresa_id = $1 AND competencia = $2', params: [pedido.empresa_id, pedido.competencia] };

  const client = await pool.connect();
  let excluidas = 0;
  try {
    await client.query('BEGIN');
    // Trava o pedido para não ser executado duas vezes em paralelo
    const lock = await client.query(`SELECT status FROM exclusoes WHERE id = $1 FOR UPDATE`, [id]);
    if (lock.rows[0]?.status !== 'pendente') throw new ErroExclusao(409, 'Pedido já decidido');
    await client.query(
      `INSERT INTO notas_excluidas (exclusao_id, nota_id, empresa_id, competencia, dados)
       SELECT $3::int, n.id, n.empresa_id, n.competencia, to_jsonb(n) FROM notas n WHERE ${filtro.sql}`,
      [...filtro.params, id]
    );
    const del = await client.query(`DELETE FROM notas WHERE ${filtro.sql}`, filtro.params);
    excluidas = del.rowCount ?? 0;
    await client.query(
      `UPDATE exclusoes SET status = 'executada', decidido_por = $2, decidido_em = NOW(), qtd_notas = $3 WHERE id = $1`,
      [id, responsavel.trim(), excluidas]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await registrarAudit(pedido.competencia, pedido.empresa_id, 'exclusao_executada',
    { exclusao_id: id, tipo: pedido.tipo, nota_id: pedido.nota_id, excluidas, autorizado_por: responsavel.trim() }, 'executada');
  return { excluidas };
}

export async function recusarExclusao(id: number, responsavel: string): Promise<void> {
  const pedido = await pedidoPendente(id);
  await query(
    `UPDATE exclusoes SET status = 'recusada', decidido_por = $2, decidido_em = NOW() WHERE id = $1 AND status = 'pendente'`,
    [id, responsavel?.trim() || null]
  );
  await registrarAudit(pedido.competencia, pedido.empresa_id, 'exclusao_recusada',
    { exclusao_id: id, recusado_por: responsavel?.trim() || null }, 'recusada');
}
