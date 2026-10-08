-- Checklist mensal de obrigações do fechamento (agenda fixa do escritório)
CREATE TABLE IF NOT EXISTS obrigacoes (
  id              SERIAL PRIMARY KEY,
  ordem           INT NOT NULL DEFAULT 0,
  dia_prazo       TEXT NOT NULL,          -- texto exibido, ex: "15" ou "2 a 6"
  dia_prazo_ord   INT NOT NULL,           -- dia (ou primeiro dia da faixa) para ordenar/alertar
  descricao       TEXT NOT NULL UNIQUE,
  -- período de referência da obrigação em relação ao mês de processamento:
  -- defasagem_meses: 1 = mês anterior, 2 = mês anterior ao anterior (NULL se periodo_fixo)
  defasagem_meses INT,
  periodo_fixo    TEXT,                   -- ex: "Trimestre ou Mensal" — usado quando defasagem_meses é NULL
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Execução de uma obrigação em um mês de processamento específico (a "baixa")
CREATE TABLE IF NOT EXISTS obrigacoes_execucoes (
  id            SERIAL PRIMARY KEY,
  obrigacao_id  INT NOT NULL REFERENCES obrigacoes(id) ON DELETE CASCADE,
  competencia   VARCHAR(7) NOT NULL,      -- mês de processamento (YYYY-MM), ex: captura feita em 2026-10
  status        VARCHAR(20) NOT NULL DEFAULT 'pendente', -- pendente | concluido
  concluido_em  TIMESTAMPTZ,
  observacao    TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (obrigacao_id, competencia)
);

CREATE INDEX IF NOT EXISTS idx_obrig_exec_competencia ON obrigacoes_execucoes(competencia);

INSERT INTO obrigacoes (ordem, dia_prazo, dia_prazo_ord, descricao, defasagem_meses, periodo_fixo) VALUES
(1,  '1',     1,  'Capturas da NF Qyon (XML/PDF)',                                                           1, NULL),
(2,  '1',     1,  'Conferência e Início do fechamento da Folha de Pagamento (diversos)',                      1, NULL),
(3,  '3',     3,  'Envio Holerites da Folha de Pagamento (diversos) pagto 5º dia útil',                       1, NULL),
(4,  '2 a 6', 2,  'Conferência das NFs importadas',                                                           1, NULL),
(5,  '7',     7,  'Entregar ISSQN digital (diversas prefeituras) e gerar as guias ISS PRÓPRIO e TOMADOS',     1, NULL),
(6,  '10',    10, 'Envio para Contabilidade (Folha de pagamento e fechamento fiscal)',                        1, NULL),
(7,  '15',    15, 'EFD-Contribuições – Escrituração Fiscal Digital das Contribuições incidentes sobre a Receita', 2, NULL),
(8,  '15',    15, 'EFD-Reinf – Escrituração Fiscal Digital de Retenções e Outras informações Fiscais',        1, NULL),
(9,  '15',    15, 'Limite máximo pa envio das Guias ao cliente (INSS/FGTS/IRRF/CPP/SIMPLES NACIONAL)',        1, NULL),
(10, '15',    15, 'PGDAS-D – Programa Gerador do Documento de Arrecadação do Simples Nacional',               1, NULL),
(11, '15',    15, 'DCTFWeb – Declaração de Débitos e Créditos Tributários Federais',                          1, NULL),
(12, '20',    20, 'DeSTDA - Diferencial de alíquotas (empresas do Simples Nacional)',                         2, NULL),
(13, '25',    25, 'Enviar as guias dos Parcelamentos (diversos clientes)',                                    1, NULL),
(14, '30',    30, 'Fechamento contábil (Balancete/Balanço e DRE)',                                            NULL, 'Trimestre ou Mensal')
ON CONFLICT (descricao) DO NOTHING;
