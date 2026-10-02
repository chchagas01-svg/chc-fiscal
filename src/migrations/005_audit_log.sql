CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  competencia   CHAR(7),
  empresa_id    INTEGER REFERENCES empresas(id),
  acao          TEXT NOT NULL,
  payload       JSONB,
  resultado     TEXT,
  criado_em     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_empresa_competencia
  ON audit_log(empresa_id, competencia);

CREATE INDEX IF NOT EXISTS idx_audit_criado_em
  ON audit_log(criado_em DESC);
