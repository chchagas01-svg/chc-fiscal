export type TipoDoc = 'nfse' | 'nfe' | 'nfce' | 'cte' | 'nfcom' | 'nf3e';

export interface ParsedNota {
  chaveAcesso: string;
  tipoDoc: TipoDoc;
  numero?: string;
  serie?: string;
  dataEmissao: Date;
  natureza: 'servico_prestado' | 'servico_tomado' | 'venda' | 'compra' | 'transferencia' | 'outro';
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
  xmlRaw: string;
}
