-- O painel de notas permite lançar nota manual (tipo_doc='manual' — ex.: recibos sem
-- XML, como vale-benefícios em papel), mas a constraint original não incluía esse valor.
-- Isso derrubava o processo inteiro ao tentar salvar (erro não tratado na rota — ver
-- src/index.ts, express-async-errors).
ALTER TABLE notas DROP CONSTRAINT IF EXISTS notas_tipo_doc_check;
ALTER TABLE notas ADD CONSTRAINT notas_tipo_doc_check
  CHECK (tipo_doc IN ('nfse','nfe','nfce','cte','nfcom','nf3e','manual'));
