export type TipoDoc = 'nfse' | 'nfe' | 'nfce' | 'cte' | 'nfcom' | 'nf3e';

export interface ParsedNota {
  chaveAcesso: string;
  tipoDoc: TipoDoc;
  numero?: string;
  serie?: string;
  dataEmissao: Date;
  // Competência (YYYY-MM) declarada no documento — NFS-e: dCompet / Competencia / DataFatoGerador.
  // Define o mês de lançamento; a data de emissão só é usada quando ela não existe.
  competencia?: string;
  natureza: 'servico_prestado' | 'servico_tomado' | 'venda' | 'compra' | 'transferencia' | 'outro';
  cfop?: string;
  cnpjEmitente: string;
  nomeEmitente?: string;
  cnpjTomador?: string;
  nomeTomador?: string;
  valorBruto: number;
  valorDeducoes: number;
  valorLiquido: number;
  issRetido: boolean;
  valorIss: number;
  retPis: number;
  retCofins: number;
  retCsll: number;
  retIrrf: number;
  retInss: number;
  icmsDebito: number;
  icmsCredito: number;
  cancelada: boolean;
  chaveSubstituta?: string;
  // NF-e: itens com CFOP, valor do produto e ICMS (não gravados; derivados do xml_raw quando preciso)
  itens?: { cfop: string; valor: number; icms: number }[];
  xmlRaw: string;
}
