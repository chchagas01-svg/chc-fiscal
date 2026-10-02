CREATE TABLE IF NOT EXISTS notas (
  id                SERIAL PRIMARY KEY,
  empresa_id        INTEGER NOT NULL REFERENCES empresas(id),
  chave_acesso      VARCHAR(50) UNIQUE NOT NULL,
  tipo_doc          TEXT NOT NULL CHECK (tipo_doc IN ('nfse','nfe','nfce','cte','nfcom','nf3e')),
  modelo            TEXT,
  numero            TEXT,
  serie             TEXT,
  data_emissao      DATE NOT NULL,
  competencia       CHAR(7) NOT NULL,    -- 'YYYY-MM'
  natureza          TEXT CHECK (natureza IN (
                      'servico_prestado','servico_tomado',
                      'venda','compra','transferencia','outro'
                    )),
  cnpj_emitente     VARCHAR(14),
  nome_emitente     TEXT,
  cnpj_tomador      VARCHAR(14),
  nome_tomador      TEXT,

  -- Valores
  valor_bruto       NUMERIC(15,2) NOT NULL DEFAULT 0,
  valor_deducoes    NUMERIC(15,2) DEFAULT 0,
  valor_liquido     NUMERIC(15,2) DEFAULT 0,

  -- ISS
  iss_retido        BOOLEAN DEFAULT FALSE,
  valor_iss         NUMERIC(15,2) DEFAULT 0,

  -- Retenções federais (IN RFB 1.234/2012)
  ret_pis           NUMERIC(15,2) DEFAULT 0,
  ret_cofins        NUMERIC(15,2) DEFAULT 0,
  ret_csll          NUMERIC(15,2) DEFAULT 0,
  ret_irrf          NUMERIC(15,2) DEFAULT 0,
  ret_inss          NUMERIC(15,2) DEFAULT 0,

  -- ICMS (NF-e)
  icms_debito       NUMERIC(15,2) DEFAULT 0,
  icms_credito      NUMERIC(15,2) DEFAULT 0,

  -- Controle
  cancelada         BOOLEAN DEFAULT FALSE,
  chave_substituta  VARCHAR(50),
  xml_raw           TEXT,
  importado_em      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notas_empresa_competencia
  ON notas(empresa_id, competencia);

CREATE INDEX IF NOT EXISTS idx_notas_competencia
  ON notas(competencia);
