-- Credenciais de acesso a portais municipais (ex.: NFS-e Campinas) por empresa.
-- Senha em texto plano por ora — mesmo padrão já usado para qyon_access_key (ver migration 007).
CREATE TABLE IF NOT EXISTS portais_municipais (
  id            SERIAL PRIMARY KEY,
  empresa_id    INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  sistema       TEXT NOT NULL,              -- ex.: 'campinas_nfse'
  login              TEXT NOT NULL,         -- credencial de autenticação no portal (geralmente o CNPJ)
  senha              TEXT NOT NULL,
  inscricao_municipal TEXT,                 -- nº de inscrição municipal do tomador (cabeçalho do arquivo DES — diferente do CNPJ)
  url_login     TEXT,                       -- URL da tela de login (pode mudar por sistema)
  url_importacao TEXT,                      -- URL da tela de importação de tomador
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (empresa_id, sistema)
);
ALTER TABLE portais_municipais ADD COLUMN IF NOT EXISTS inscricao_municipal TEXT;

-- Equivalência entre item da Lista de Serviços (LC 116/2003, 4 dígitos, do cTribNac da NFS-e)
-- e o código usado pelo sistema de Campinas no arquivo de importação de tomador (import DES).
-- Alimentada manualmente à medida que novos itens aparecem (consulta em
-- https://drm-codae.campinas.sp.gov.br/cnae.php) — ver [[feedback_campinas_des_layout]].
CREATE TABLE IF NOT EXISTS campinas_cnae_item (
  item_lc116    VARCHAR(4) PRIMARY KEY,     -- ex.: '1401' (item 14.01)
  codigo_cnae   VARCHAR(9) NOT NULL,        -- ex.: '432230211'
  descricao     TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO campinas_cnae_item (item_lc116, codigo_cnae, descricao) VALUES
  ('0103', '631190001', 'Processamento de dados'),
  ('0105', '620230002', 'Licenciamento de programas de computação'),
  ('0802', '859960401', 'Instrução, treinamento e ensino'),
  ('1401', '432230211', 'Manutenção e conservação de máquinas, veículos e equipamentos')
ON CONFLICT (item_lc116) DO NOTHING;

-- Override por prestador específico (CNPJ) quando o item real da nota (cTribNac) não é o que
-- a Prefeitura espera para aquele prestador recorrente — ex.: Caju/Empresa Brasileira de
-- Benefícios (nota usa 17.12, Campinas espera 15.14) e Google (nota variável, Campinas 10.08).
CREATE TABLE IF NOT EXISTS campinas_cnae_override (
  cnpj_prestador VARCHAR(14) PRIMARY KEY,
  item_lc116     VARCHAR(4) NOT NULL,
  codigo_cnae    VARCHAR(9) NOT NULL,
  observacao     TEXT,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO campinas_cnae_override (cnpj_prestador, item_lc116, codigo_cnae, observacao) VALUES
  ('33449007000144', '1514', '829970200', 'Empresa Brasileira de Benefícios (Caju) — vale-benefícios'),
  ('06990590000123', '1008', '731220001', 'Google Brasil — publicidade/inserção')
ON CONFLICT (cnpj_prestador) DO NOTHING;

-- Histórico de arquivos DES gerados (e, quando sabido, se já foram enviados)
CREATE TABLE IF NOT EXISTS des_exportacoes (
  id           SERIAL PRIMARY KEY,
  empresa_id   INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  sistema      TEXT NOT NULL DEFAULT 'campinas_nfse',
  competencia  VARCHAR(7) NOT NULL,
  notas_ids    INT[] NOT NULL,
  conteudo     TEXT NOT NULL,
  enviado      BOOLEAN NOT NULL DEFAULT false,
  enviado_em   TIMESTAMPTZ,
  gerado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
