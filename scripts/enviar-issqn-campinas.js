// Envio assistido do arquivo DES-IF (serviços tomados) ao portal de NFS-e de Campinas.
//
// Roda NO SEU COMPUTADOR (não no servidor) — precisa ser assim porque o login do portal tem
// reCAPTCHA, e só um humano resolve captcha. O script automatiza tudo em volta disso:
//   1. Busca login/senha salvos em Portais Municipais e o arquivo DES já gerado
//   2. Abre um navegador de verdade, preenche CNPJ e senha sozinho
//   3. PARA no captcha — você resolve e clica em Entrar
//   4. Continua sozinho: abre a tela de importação e seleciona o arquivo
//   5. PARA de novo antes do envio final — você confere e clica em enviar
//
// Uso:
//   node scripts/enviar-issqn-campinas.js --empresa=2 --competencia=2026-09
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { chromium } = require('playwright');

const API_BASE = process.env.CHC_API_BASE || 'https://chc-fiscal-production.up.railway.app';
const API_KEY = process.env.CHC_API_KEY || 'Okc6EW2NRw3G5EuYisuwXo4ejEQQJsblIdnqYqzgQGE=';

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function apiGet(urlPath, { raw } = {}) {
  return new Promise((resolve, reject) => {
    https.get(API_BASE + urlPath, { headers: { Authorization: 'Bearer ' + API_KEY } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.toString('utf8').substring(0, 500)}`));
          return;
        }
        resolve(raw ? body : JSON.parse(body.toString('utf8')));
      });
    }).on('error', reject);
  });
}

async function main() {
  const args = parseArgs();
  const empresaId = args.empresa;
  const competencia = args.competencia;
  if (!empresaId || !competencia) {
    console.error('Uso: node scripts/enviar-issqn-campinas.js --empresa=<id> --competencia=AAAA-MM');
    process.exit(1);
  }

  console.log(`[1/5] Buscando credenciais da empresa ${empresaId}...`);
  const cred = await apiGet(`/v1/portais/credenciais?empresa_id=${empresaId}&sistema=campinas_nfse`);
  const urlLogin = cred.url_login || 'https://novanfse.campinas.sp.gov.br/notafiscal/paginas/importacaotomador/importacaoTomadorList.jsf';
  const urlImportacao = cred.url_importacao || urlLogin;

  console.log(`[2/5] Gerando/baixando arquivo DES de ${competencia}...`);
  const conteudo = await apiGet(`/v1/portais/campinas/des/${competencia}/download?empresa_id=${empresaId}`, { raw: true });
  const arquivoLocal = path.join(os.tmpdir(), `des_campinas_${empresaId}_${competencia}.txt`);
  fs.writeFileSync(arquivoLocal, conteudo);
  console.log(`      Arquivo salvo em: ${arquivoLocal} (${conteudo.length} bytes)`);

  console.log('[3/5] Abrindo navegador...');
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const page = await browser.newPage({ viewport: null });

  await page.goto(urlLogin, { waitUntil: 'networkidle', timeout: 30000 });
  await page.keyboard.press('Escape').catch(() => {});
  const fecharBtn = page.locator('button:has-text("X"), [class*="close"], [aria-label="close" i], [aria-label="fechar" i]').first();
  if (await fecharBtn.count() > 0) await fecharBtn.click().catch(() => {});

  const autenticar = page.locator('button:has-text("AUTENTICAR"), a:has-text("AUTENTICAR")').first();
  if (await autenticar.count() > 0) { await autenticar.click(); await page.waitForTimeout(1500); }

  const cpfCnpjInput = page.locator('input[name="cpfCnpj"], input#input-109').first();
  const senhaInput = page.locator('input[name="senha"], input[type="password"]').first();
  if (await cpfCnpjInput.count() > 0) await cpfCnpjInput.fill(cred.login);
  if (await senhaInput.count() > 0) await senhaInput.fill(cred.senha);

  console.log('');
  console.log('===========================================================');
  console.log(' CNPJ e senha preenchidos. Resolva o captcha na janela do');
  console.log(' navegador e clique em "Entrar". Aguardando o login...');
  console.log('===========================================================');
  console.log('');

  const urlAntesLogin = page.url();
  await page.waitForFunction(
    (urlAntiga) => window.location.href !== urlAntiga,
    urlAntesLogin,
    { timeout: 10 * 60 * 1000 } // até 10 minutos para o usuário resolver o captcha com calma
  );
  console.log('[4/5] Login detectado. Abrindo a tela de importação...');

  await page.goto(urlImportacao, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(arquivoLocal);
    console.log('      Arquivo selecionado automaticamente no campo de upload.');
  } else {
    console.log('      Não encontrei automaticamente o campo de upload nesta tela.');
    console.log(`      Selecione manualmente o arquivo: ${arquivoLocal}`);
  }

  console.log('');
  console.log('===========================================================');
  console.log(' [5/5] Confira os dados na tela e clique você mesmo no');
  console.log(' botão final de importar/confirmar — o script não envia');
  console.log(' sozinho essa última etapa, por segurança.');
  console.log(' Este terminal fica esperando; feche a janela do navegador');
  console.log(' quando terminar.');
  console.log('===========================================================');

  await page.waitForEvent('close', { timeout: 30 * 60 * 1000 }).catch(() => {});
  await browser.close().catch(() => {});
  console.log('Concluído.');
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
