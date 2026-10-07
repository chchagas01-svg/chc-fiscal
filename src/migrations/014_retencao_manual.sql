-- Retenções ajustadas manualmente no painel (conferência com o PDF da nota).
-- O reprocessamento a partir do XML não sobrescreve notas com retencao_manual = true.
ALTER TABLE notas ADD COLUMN IF NOT EXISTS retencao_manual BOOLEAN NOT NULL DEFAULT false;
