-- Cadastro e correções para o Resumo Mensal (totalizador diário por empresa)

-- Regra do escritório: só apura ICMS a empresa com Inscrição Estadual que não é do Simples
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS inscricao_estadual VARCHAR(20) DEFAULT NULL;
-- Empresa sujeita ao diferencial de alíquota (linha Difal do Resumo Mensal)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS tem_difal BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN empresas.inscricao_estadual IS 'IE da empresa. Vazia = não contribuinte do ICMS (não apura débito/crédito).';
COMMENT ON COLUMN empresas.tem_difal          IS 'Empresa recolhe Difal nas compras interestaduais para uso/consumo/ativo.';

-- O parser gravava o ICMS destacado das compras como débito (e o Difal vICMSUFDest como crédito).
-- Nas compras de NF-e o ICMS destacado é crédito. Idempotente: só move enquanto houver débito.
UPDATE notas
   SET icms_credito = icms_debito,
       icms_debito  = 0
 WHERE natureza = 'compra'
   AND tipo_doc IN ('nfe', 'nfce')
   AND icms_debito > 0;

-- Saídas com CFOP de devolução, remessa, transferência ou retorno não são receita.
-- A captura sobrescrevia a natureza com o fluxo do Qyon ('venda'); volta para 'outro'.
UPDATE notas
   SET natureza = 'outro'
 WHERE natureza = 'venda'
   AND tipo_doc IN ('nfe', 'nfce')
   AND cfop IN (
     '5201','5202','5203','5204','5205','5206','5207','5208','5209','5210','5214',
     '6201','6202','6203','6204','6205','6206','6207','6208','6209','6210',
     '5410','5411','5412','5413','5414','5415','5416','5417','5418',
     '6410','6411','6412','6413',
     '5901','5902','5903','5904','5905','5906','5907','5908','5909','5910',
     '5911','5912','5913','5914','5915','5916','5917','5918','5919','5920',
     '5921','5922','5923','5924','5925','5926','5927',
     '6901','6902','6903','6904','6905','6906','6907','6908','6909','6910',
     '5151','5152','5153','5154','5155','5156',
     '5551','5552','5553','5554','5555','5556','5557',
     '6151','6152','6153','6154','6155','6156',
     '6551','6552','6553','6554','6555','6556','6557',
     '5949','6949'
   );
