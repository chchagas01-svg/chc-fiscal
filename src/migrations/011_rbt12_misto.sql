-- RBT12 seed (base histórica acumulada antes do início da captura automática)
-- e suporte a empresa mista (dois anexos Simples Nacional)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS rbt12_seed    NUMERIC(15,2) DEFAULT NULL;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS anexo_comercio VARCHAR(5)    DEFAULT NULL;

COMMENT ON COLUMN empresas.rbt12_seed     IS 'Receita acumulada 12 meses informada manualmente. Complementa o RBT12 calculado das notas até o sistema ter 12 meses de histórico.';
COMMENT ON COLUMN empresas.anexo_comercio IS 'Segundo anexo para empresa mista (ex: I = comércio, quando a empresa presta serviços E vende mercadorias). Nulo = atividade única.';

-- Fernanda Mello: acumulado até 31/08/2026
UPDATE empresas SET rbt12_seed = 352698.64
  WHERE cnpj = '65996987000191';

-- L. de Santana: acumulado até 31/08/2026 + atividade mista (Anexo III serviços + Anexo I comércio)
UPDATE empresas SET rbt12_seed = 3072690.84, anexo_comercio = 'I'
  WHERE cnpj = '16622353000163';
