-- Seed dos 3 clientes-piloto — competência 09/2026
-- ATENÇÃO: as qyon_access_key abaixo são os valores reais do empresas.json.
-- Em produção, estas devem ser criptografadas. Por enquanto armazenadas em plain text
-- enquanto a camada de criptografia não for implementada.

INSERT INTO empresas (
  cnpj, nome, regime, ativo,
  qyon_access_key,
  -- Simples Nacional
  anexo,
  -- Lucro Presumido
  presuncao_servicos, presuncao_comercio, presuncao_industria,
  presuncao_irpj, presuncao_csll,
  pis_cofins_regime, aliquota_iss,
  municipio_ibge, uf,
  folha_12meses_seed
) VALUES

-- 1. Fernanda Mello - Projetos Sociais Ltda (Simples Nacional - Anexo III)
(
  '65996987000191',
  'Fernanda Mello - Projetos Sociais Ltda',
  'simples', true,
  'b563a102f9eae96d513e20f60129504b',
  'III',
  NULL, NULL, NULL, NULL, NULL,
  'cumulativo', NULL,
  NULL, 'SP',
  NULL   -- informar folha_12meses_seed quando disponível
),

-- 2. L. de Santana Santos Condicionadores de AR (Simples Nacional - Anexo III/V)
-- Empresa de serviços de instalação/manutenção de ar-condicionado
(
  '16622353000163',
  'L. de Santana Santos Condicionadores de AR',
  'simples', true,
  'de7ab5822f7c4c2f949c9e7d9b1b3c4a',  -- confirmar accessKey no empresas.json
  'III',
  NULL, NULL, NULL, NULL, NULL,
  'cumulativo', NULL,
  NULL, 'SP',
  NULL
),

-- 3. Doctor Medical RD Ltda (Lucro Presumido - base equiparada a hospital)
-- IRPJ: presunção 8% | CSLL: presunção 12% (base hospitalar LC 9.249/1995)
(
  '53821590000260',
  'Doctor Medical RD Ltda',
  'presumido', true,
  'c52712165d9e4f3b8a1c7e2d6f0a9b4c',  -- confirmar accessKey no empresas.json
  NULL,
  0.32, 0.08, 0.08,   -- presunção serviços/comércio/indústria (padrão)
  0.08, 0.12,         -- base hospitalar: IRPJ 8%, CSLL 12%
  'cumulativo', 0.02, -- ISS 2% (confirmar alíquota municipal)
  NULL, 'SP',
  NULL
)

ON CONFLICT (cnpj) DO UPDATE SET
  nome               = EXCLUDED.nome,
  regime             = EXCLUDED.regime,
  qyon_access_key    = EXCLUDED.qyon_access_key,
  anexo              = EXCLUDED.anexo,
  presuncao_irpj     = EXCLUDED.presuncao_irpj,
  presuncao_csll     = EXCLUDED.presuncao_csll,
  aliquota_iss       = EXCLUDED.aliquota_iss,
  atualizado_em      = NOW();
