-- Seed dos 3 clientes-piloto — competência 09/2026
-- As migrations rodam a cada início do contêiner: este seed só cria a empresa se ela ainda
-- não existir e nunca sobrescreve o cadastro. A qyon_access_key não fica no repositório:
-- em banco novo entra vazia e deve ser preenchida no cadastro da empresa.

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
  '',
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
  '',
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
  '',
  NULL,
  0.32, 0.08, 0.08,   -- presunção serviços/comércio/indústria (padrão)
  0.08, 0.12,         -- base hospitalar: IRPJ 8%, CSLL 12%
  'cumulativo', 0.02, -- ISS 2% (confirmar alíquota municipal)
  NULL, 'SP',
  NULL
)

ON CONFLICT (cnpj) DO NOTHING;
