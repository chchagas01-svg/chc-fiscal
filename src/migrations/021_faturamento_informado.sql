-- Faturamento mensal informado pelo escritório (declaração de faturamento), para os meses
-- em que o sistema ainda não tem todos os XMLs. Quando existe, vale no lugar da soma das
-- notas no acumulado do ano/trimestres do Resumo Mensal.
CREATE TABLE IF NOT EXISTS faturamento_informado (
  empresa_id  INTEGER NOT NULL REFERENCES empresas(id),
  competencia VARCHAR(7) NOT NULL,
  valor       NUMERIC(15,2) NOT NULL,
  origem      TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (empresa_id, competencia)
);

-- Doctor Medical RD: Declaração de Faturamento 01 a 09/2026 (emitida em 15/10/2026)
INSERT INTO faturamento_informado (empresa_id, competencia, valor, origem)
SELECT e.id, v.competencia, v.valor, 'Declaração de Faturamento 15/10/2026'
  FROM empresas e
  CROSS JOIN (VALUES
    ('2026-01', 5612787.23), ('2026-02', 5772050.86), ('2026-03', 4126095.12),
    ('2026-04', 5288893.24), ('2026-05', 3582164.76), ('2026-06', 3841296.85),
    ('2026-07', 3731220.44), ('2026-08', 4500529.76), ('2026-09', 4140461.85)
  ) AS v(competencia, valor)
 WHERE e.cnpj = '53821590000260'
ON CONFLICT (empresa_id, competencia) DO NOTHING;
