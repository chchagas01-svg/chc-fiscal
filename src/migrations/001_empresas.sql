CREATE TABLE IF NOT EXISTS empresas (
  id                    SERIAL PRIMARY KEY,
  cnpj                  VARCHAR(14) UNIQUE NOT NULL,
  nome                  TEXT NOT NULL,
  regime                TEXT NOT NULL CHECK (regime IN ('simples', 'presumido')),
  ativo                 BOOLEAN DEFAULT TRUE,
  qyon_access_key       TEXT NOT NULL,

  -- Simples Nacional
  anexo                 TEXT CHECK (anexo IN ('I','II','III','IV','V','VI')),

  -- Lucro Presumido
  presuncao_servicos    NUMERIC(5,4),
  presuncao_comercio    NUMERIC(5,4),
  presuncao_industria   NUMERIC(5,4),
  presuncao_irpj        NUMERIC(5,4),  -- base de cálculo IRPJ (hospital-equiv: 8%)
  presuncao_csll        NUMERIC(5,4),  -- base de cálculo CSLL (hospital-equiv: 12%)
  pis_cofins_regime     TEXT DEFAULT 'cumulativo' CHECK (pis_cofins_regime IN ('cumulativo','nao_cumulativo')),
  aliquota_iss          NUMERIC(5,4),  -- alíquota ISS municipal

  municipio_ibge        CHAR(7),
  uf                    CHAR(2),

  criado_em             TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ DEFAULT NOW()
);
