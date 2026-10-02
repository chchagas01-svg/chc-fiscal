CREATE TABLE IF NOT EXISTS fechamentos_estado (
  id            SERIAL PRIMARY KEY,
  competencia   CHAR(7) NOT NULL,
  empresa_id    INTEGER NOT NULL REFERENCES empresas(id),
  fase          TEXT NOT NULL CHECK (fase IN ('fase1','fase2')),
  etapa         TEXT NOT NULL CHECK (etapa IN (
                  'captura','apuracao','guia','declaracao','contabil','encerramento'
                )),
  status        TEXT NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente','ok','erro','retida','ignorada')),
  detalhe       TEXT,
  responsavel   TEXT,
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (competencia, empresa_id, etapa)
);

CREATE INDEX IF NOT EXISTS idx_fechamentos_competencia
  ON fechamentos_estado(competencia);

-- Tabela para registro da liberação da Fase 2
CREATE TABLE IF NOT EXISTS liberacoes (
  id            SERIAL PRIMARY KEY,
  competencia   CHAR(7) NOT NULL,
  responsavel   TEXT NOT NULL,
  observacao    TEXT,
  empresas_ids  INTEGER[],  -- NULL = todas as aprovadas; lista = seletiva
  criado_em     TIMESTAMPTZ DEFAULT NOW()
);
