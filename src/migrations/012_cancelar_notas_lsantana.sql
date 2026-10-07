-- Cancela NFs 2663, 2664 e 2666 da L. de Santana que estavam marcadas indevidamente como normais
UPDATE notas n
SET cancelada = true
FROM empresas e
WHERE n.empresa_id = e.id
  AND e.cnpj = '16622353000163'
  AND n.numero IN ('2663', '2664', '2666');
