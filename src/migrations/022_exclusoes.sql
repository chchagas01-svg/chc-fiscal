-- Trava de exclusão: apagar notas vira um pedido que só é executado com a autorização do
-- responsável (senha EXCLUSAO_SENHA). As notas apagadas ficam guardadas em notas_excluidas.
CREATE TABLE IF NOT EXISTS exclusoes (
  id            SERIAL PRIMARY KEY,
  tipo          TEXT NOT NULL CHECK (tipo IN ('nota','mes')),
  empresa_id    INTEGER NOT NULL REFERENCES empresas(id),
  competencia   CHAR(7) NOT NULL,
  nota_id       INTEGER,                -- tipo 'nota'
  qtd_notas     INTEGER NOT NULL DEFAULT 0,
  valor_total   NUMERIC(15,2) NOT NULL DEFAULT 0,
  motivo        TEXT,
  status        TEXT NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente','executada','recusada')),
  decidido_por  TEXT,
  decidido_em   TIMESTAMPTZ,
  solicitado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exclusoes_status ON exclusoes(status);

-- Cópia integral (JSON) de cada nota apagada, para conferência ou restauração
CREATE TABLE IF NOT EXISTS notas_excluidas (
  id            BIGSERIAL PRIMARY KEY,
  exclusao_id   INTEGER NOT NULL REFERENCES exclusoes(id),
  nota_id       INTEGER NOT NULL,
  empresa_id    INTEGER NOT NULL,
  competencia   CHAR(7) NOT NULL,
  dados         JSONB NOT NULL,
  excluida_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notas_excluidas_exclusao ON notas_excluidas(exclusao_id);
