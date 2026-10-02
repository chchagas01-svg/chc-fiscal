CREATE TABLE IF NOT EXISTS apuracoes (
  id                    SERIAL PRIMARY KEY,
  empresa_id            INTEGER NOT NULL REFERENCES empresas(id),
  competencia           CHAR(7) NOT NULL,
  regime                TEXT NOT NULL,

  -- Receitas
  receita_servicos      NUMERIC(15,2) DEFAULT 0,
  receita_comercio      NUMERIC(15,2) DEFAULT 0,
  receita_industria     NUMERIC(15,2) DEFAULT 0,
  receita_total         NUMERIC(15,2) DEFAULT 0,

  -- Simples Nacional
  rbt12                 NUMERIC(15,2),
  folha_12meses         NUMERIC(15,2),
  fator_r               NUMERIC(8,6),
  anexo_aplicado        TEXT,
  aliquota_nominal      NUMERIC(8,6),
  parcela_dedutivel     NUMERIC(15,2),
  aliquota_efetiva      NUMERIC(8,6),
  das_bruto             NUMERIC(15,2),
  das_deducoes          NUMERIC(15,2),
  das_devido            NUMERIC(15,2),
  vencimento_das        DATE,

  -- Lucro Presumido — bases
  base_irpj             NUMERIC(15,2),
  base_csll             NUMERIC(15,2),

  -- Lucro Presumido — tributos mensais
  pis_devido            NUMERIC(15,2),
  cofins_devida         NUMERIC(15,2),
  iss_devido            NUMERIC(15,2),

  -- ICMS (mensal)
  icms_saldo_anterior   NUMERIC(15,2) DEFAULT 0,
  icms_debitos          NUMERIC(15,2) DEFAULT 0,
  icms_creditos         NUMERIC(15,2) DEFAULT 0,
  icms_devido           NUMERIC(15,2) DEFAULT 0,
  icms_saldo_credor     NUMERIC(15,2) DEFAULT 0,

  -- IRPJ / CSLL (trimestral — acumula até fechar o trimestre)
  irpj_devido           NUMERIC(15,2),
  csll_devida           NUMERIC(15,2),
  trimestre             CHAR(7),   -- ex: '2026-T3'
  irpj_adicional        NUMERIC(15,2) DEFAULT 0,
  vencimento_irpj_csll  DATE,

  -- Retenções
  ret_pis_total         NUMERIC(15,2) DEFAULT 0,
  ret_cofins_total      NUMERIC(15,2) DEFAULT 0,
  ret_csll_total        NUMERIC(15,2) DEFAULT 0,
  ret_irrf_total        NUMERIC(15,2) DEFAULT 0,
  ret_inss_total        NUMERIC(15,2) DEFAULT 0,
  saldo_ret_anterior    JSONB DEFAULT '{"pis":0,"cofins":0,"csll":0,"irrf":0,"inss":0}'::jsonb,
  saldo_ret_proximo     JSONB DEFAULT '{"pis":0,"cofins":0,"csll":0,"irrf":0,"inss":0}'::jsonb,

  -- Memória de cálculo e controle
  memoria_calculo       JSONB,
  status                TEXT DEFAULT 'rascunho'
                          CHECK (status IN ('rascunho','retida','aprovada')),
  motivo_retencao       TEXT,
  criado_em             TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (empresa_id, competencia)
);
