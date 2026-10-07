-- Corrige natureza de notas importadas antes da fix de fluxo:
-- se cnpj_emitente = CNPJ da empresa → saída (servico_prestado / venda)
-- se cnpj_tomador  = CNPJ da empresa → entrada (servico_tomado / compra)
UPDATE notas n
SET natureza = CASE
  WHEN n.tipo_doc = 'nfse' AND n.cnpj_emitente = e.cnpj THEN 'servico_prestado'
  WHEN n.tipo_doc = 'nfse' AND n.cnpj_tomador  = e.cnpj THEN 'servico_tomado'
  WHEN n.tipo_doc IN ('nfe','nfce') AND n.cnpj_emitente = e.cnpj THEN 'venda'
  WHEN n.tipo_doc IN ('nfe','nfce') AND n.cnpj_tomador  = e.cnpj THEN 'compra'
  ELSE n.natureza
END
FROM empresas e
WHERE n.empresa_id = e.id;
