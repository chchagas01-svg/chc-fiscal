-- Adiciona coluna CFOP às notas (para filtrar retornos/remessas do faturamento)
ALTER TABLE notas ADD COLUMN IF NOT EXISTS cfop VARCHAR(10) DEFAULT NULL;

COMMENT ON COLUMN notas.cfop IS 'CFOP do primeiro item da NF-e. Usado para classificar retornos/remessas como natureza=outro (excluídos do faturamento).';

-- Corrige NF 413 da L. de Santana (CFOP 5949 = Retorno de mercadoria — não é receita)
UPDATE notas n
SET natureza = 'outro', cfop = '5949'
FROM empresas e
WHERE n.empresa_id = e.id
  AND e.cnpj = '16622353000163'
  AND n.numero = '413'
  AND n.tipo_doc = 'nfe';
