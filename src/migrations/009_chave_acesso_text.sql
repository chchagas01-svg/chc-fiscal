-- Expande chave_acesso e chave_substituta de VARCHAR(50) para TEXT
-- Necessário para NFS-e DFe 3.0 cujo Id tem ~52 caracteres
ALTER TABLE notas ALTER COLUMN chave_acesso    TYPE TEXT;
ALTER TABLE notas ALTER COLUMN chave_substituta TYPE TEXT;
