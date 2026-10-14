-- Totalizador: foto diária do Resumo Mensal de cada empresa, gravada logo após a captura
CREATE TABLE IF NOT EXISTS resumos_mensais (
  id                SERIAL PRIMARY KEY,
  empresa_id        INTEGER NOT NULL REFERENCES empresas(id),
  competencia       CHAR(7) NOT NULL,          -- 'YYYY-MM'
  apurado_ate       DATE NOT NULL,             -- notas emitidas até esta data
  mes_fechado       BOOLEAN NOT NULL DEFAULT false,
  total_faturamento NUMERIC(15,2),
  total_devido      NUMERIC(15,2),             -- NULL no Simples (DAS fica na apuração)
  qtd_alertas       INTEGER NOT NULL DEFAULT 0,
  dados             JSONB NOT NULL,            -- relatório completo (ResumoMensal)
  gerado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (empresa_id, competencia, apurado_ate)
);

CREATE INDEX IF NOT EXISTS idx_resumos_mensais_comp ON resumos_mensais(competencia);
