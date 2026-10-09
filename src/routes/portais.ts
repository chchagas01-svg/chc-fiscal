import { Router } from 'express';
import { query } from '../config/database';
import { gerarDesCampinas } from '../services/des/CampinasDesService';

const router = Router();

// GET /v1/portais?empresa_id=X — lista portais cadastrados (sem a senha)
router.get('/', async (req, res) => {
  const empresaId = Number(req.query['empresa_id']);
  if (!empresaId) return res.status(400).json({ erro: 'empresa_id é obrigatório' });
  const r = await query(
    `SELECT id, sistema, login, inscricao_municipal, url_login, url_importacao, ativo, atualizado_em
       FROM portais_municipais WHERE empresa_id = $1 ORDER BY sistema`,
    [empresaId]
  );
  return res.json(r.rows);
});

// GET /v1/portais/credenciais?empresa_id=X&sistema=Y — retorna COM a senha (uso: script local
// de automação, que roda na máquina do usuário e precisa preencher o formulário de login)
router.get('/credenciais', async (req, res) => {
  const empresaId = Number(req.query['empresa_id']);
  const sistema = String(req.query['sistema'] ?? '');
  if (!empresaId || !sistema) return res.status(400).json({ erro: 'empresa_id e sistema são obrigatórios' });
  const r = await query(
    `SELECT login, senha, inscricao_municipal, url_login, url_importacao FROM portais_municipais
      WHERE empresa_id = $1 AND sistema = $2 AND ativo = true`,
    [empresaId, sistema]
  );
  if (!r.rows[0]) return res.status(404).json({ erro: 'Credenciais não cadastradas para esta empresa/sistema' });
  return res.json(r.rows[0]);
});

// POST /v1/portais — cria ou atualiza credenciais (upsert por empresa_id+sistema)
// Body: { empresa_id, sistema, login, senha, inscricao_municipal?, url_login?, url_importacao? }
router.post('/', async (req, res) => {
  const b = req.body as Record<string, unknown>;
  const { empresa_id, sistema, login, senha } = b;
  if (!empresa_id || !sistema || !login || !senha)
    return res.status(400).json({ erro: 'Campos obrigatórios: empresa_id, sistema, login, senha' });

  // Campos opcionais: string vazia conta como "não informado" — nunca apaga um valor já salvo.
  // Em UPDATE, COALESCE(novo, atual) preserva o que já existia quando o campo vem vazio/ausente.
  const semValor = (v: unknown) => v == null || String(v).trim() === '';
  const inscricaoMunicipal = semValor(b['inscricao_municipal']) ? null : String(b['inscricao_municipal']).trim();
  const urlLogin = semValor(b['url_login']) ? null : String(b['url_login']).trim();
  const urlImportacao = semValor(b['url_importacao']) ? null : String(b['url_importacao']).trim();

  const r = await query<{ id: number }>(
    `INSERT INTO portais_municipais (empresa_id, sistema, login, senha, inscricao_municipal, url_login, url_importacao)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (empresa_id, sistema) DO UPDATE SET
       login = $3, senha = $4,
       inscricao_municipal = COALESCE($5, portais_municipais.inscricao_municipal),
       url_login = COALESCE($6, portais_municipais.url_login),
       url_importacao = COALESCE($7, portais_municipais.url_importacao),
       ativo = true, atualizado_em = NOW()
     RETURNING id`,
    [Number(empresa_id), String(sistema), String(login), String(senha), inscricaoMunicipal, urlLogin, urlImportacao]
  );
  return res.status(201).json({ ok: true, id: r.rows[0]!.id });
});

// DELETE /v1/portais/:id — remove credenciais
router.delete('/:id', async (req, res) => {
  const r = await query(`DELETE FROM portais_municipais WHERE id = $1`, [Number(req.params['id'])]);
  if ((r.rowCount ?? 0) === 0) return res.status(404).json({ erro: 'Não encontrado' });
  return res.json({ ok: true });
});

// GET /v1/portais/campinas/des/:competencia?empresa_id=X — gera o arquivo DES (preview em JSON)
router.get('/campinas/des/:competencia', async (req, res) => {
  const competencia = req.params['competencia'] as string;
  const empresaId = Number(req.query['empresa_id']);
  if (!empresaId || !/^\d{4}-\d{2}$/.test(competencia))
    return res.status(400).json({ erro: 'empresa_id e competencia (YYYY-MM) são obrigatórios' });
  try {
    const resultado = await gerarDesCampinas(empresaId, competencia);
    return res.json(resultado);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ erro: 'Falha ao gerar arquivo DES', detalhe: msg });
  }
});

// GET /v1/portais/campinas/des/:competencia/download?empresa_id=X — baixa o .txt direto
router.get('/campinas/des/:competencia/download', async (req, res) => {
  const competencia = req.params['competencia'] as string;
  const empresaId = Number(req.query['empresa_id']);
  if (!empresaId || !/^\d{4}-\d{2}$/.test(competencia))
    return res.status(400).json({ erro: 'empresa_id e competencia (YYYY-MM) são obrigatórios' });
  try {
    const resultado = await gerarDesCampinas(empresaId, competencia);
    if (!resultado.conteudo) {
      return res.status(422).json({ erro: 'Há itens sem mapeamento de CNAE — resolva antes de baixar', faltando: resultado.faltando_mapeamento });
    }
    await query(
      `INSERT INTO des_exportacoes (empresa_id, sistema, competencia, notas_ids, conteudo) VALUES ($1,'campinas_nfse',$2,$3,$4)`,
      [empresaId, competencia, resultado.notas_ids, resultado.conteudo]
    );
    // Arquivo de colunas fixas: o portal de Campinas espera ISO-8859-1 (Latin-1), 1 byte por
    // caractere. Em UTF-8, acentos (ç/ã/á...) ocupam 2 bytes e desalinham todas as colunas
    // seguintes — foi a causa confirmada do "Erro de Layout" ao gravar no portal.
    let fora = 0;
    const bufferLatin1 = Buffer.from(resultado.conteudo.replace(/[^\x00-\xFF]/g, () => { fora++; return '?'; }), 'latin1');
    if (fora > 0) console.warn(`[campinas-des] ${fora} caractere(s) fora do Latin-1 substituídos por '?' na competência ${competencia}`);

    res.setHeader('Content-Disposition', `attachment; filename="des_campinas_${competencia}.txt"`);
    res.setHeader('Content-Type', 'text/plain; charset=ISO-8859-1');
    return res.send(bufferLatin1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ erro: 'Falha ao gerar arquivo DES', detalhe: msg });
  }
});

export default router;
