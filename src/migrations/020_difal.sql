-- Difal nas compras interestaduais (Resumo Mensal e, depois, DeSTDA)

-- Alíquota interna de ICMS da UF da empresa usada no Difal (SP: 18%)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS aliquota_icms_interna NUMERIC(5,4) NOT NULL DEFAULT 0.18;

-- Finalidade da compra informada no painel. Vazio = deduzida do CFOP do fornecedor.
-- O CFOP do fornecedor nem sempre diz o uso (ex.: máquina para o ativo vendida com 6102).
ALTER TABLE notas ADD COLUMN IF NOT EXISTS finalidade_entrada TEXT DEFAULT NULL;
DO $$ BEGIN
  ALTER TABLE notas ADD CONSTRAINT notas_finalidade_entrada_chk
    CHECK (finalidade_entrada IS NULL OR finalidade_entrada IN ('revenda','industrializacao','ativo','outras'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN empresas.aliquota_icms_interna IS 'Alíquota interna do ICMS da UF da empresa, usada no cálculo do Difal.';
COMMENT ON COLUMN notas.finalidade_entrada       IS 'Finalidade da compra (revenda, industrializacao, ativo, outras = uso/consumo) definida no painel; NULL = pelo CFOP.';
