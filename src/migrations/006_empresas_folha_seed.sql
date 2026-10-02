-- Folha acumulada 12 meses (seed manual) — usada no Fator R do Simples Nacional
-- até o módulo Folha (Subprojeto 2) estar disponível.
-- Quando folha_12meses_seed IS NOT NULL, tem precedência sobre o cálculo automático.
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS folha_12meses_seed NUMERIC(15,2) DEFAULT NULL;

COMMENT ON COLUMN empresas.folha_12meses_seed IS
  'Folha acumulada 12 meses informada manualmente. Usada no Fator R até integração com módulo Folha.';
