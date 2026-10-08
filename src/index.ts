import 'dotenv/config';
// Faz qualquer erro de um handler async (ex.: query ao banco que rejeita) ser
// encaminhado ao middleware de erro do Express em vez de virar uma unhandled
// promise rejection — no Node 24 isso derrubava o processo inteiro, tirando o
// sistema do ar para todas as empresas até a Railway reiniciar o contêiner.
// Precisa ser importado antes de registrar qualquer rota.
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { bearerAuth } from './middleware/auth';
import capturaRouter from './routes/captura';
import relatorioRouter from './routes/relatorio';
import apuracaoRouter from './routes/apuracao';
import fechamentoRouter from './routes/fechamento';
import contabilRouter from './routes/contabil';
import adminRouter from './routes/admin';
import notasRouter from './routes/notas';
import obrigacoesRouter from './routes/obrigacoes';
import portaisRouter from './routes/portais';
import { initQyonTokens } from './services/qyon/QyonClient';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json({ limit: '25mb' })); // importação de XMLs avulsos pelo painel
app.use(express.static(path.join(__dirname, 'public')));

// Health check — sem autenticação
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', sistema: 'CHC-Fiscal', versao: '1.0.0' });
});

// Todas as rotas /v1 exigem Bearer token
app.use('/v1', bearerAuth);
app.use('/v1/captura', capturaRouter);
app.use('/v1/relatorio', relatorioRouter);
app.use('/v1/apuracao', apuracaoRouter);
app.use('/v1/fechamento', fechamentoRouter);
app.use('/v1/contabil', contabilRouter);
app.use('/v1/admin', adminRouter);
app.use('/v1/notas', notasRouter);
app.use('/v1/obrigacoes', obrigacoesRouter);
app.use('/v1/portais', portaisRouter);

// 404 genérico
app.use((_req, res) => {
  res.status(404).json({ erro: 'Endpoint não encontrado' });
});

// Handler de erros
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// Rede de segurança: nada fora do ciclo de requisição (timers, tarefas em
// background) deve derrubar o processo. Loga e mantém o servidor no ar.
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

app.listen(PORT, () => {
  console.log(`CHC-Fiscal rodando na porta ${PORT}`);
  // Carrega tokens Qyon do banco (sobrescreve env vars se houver tokens mais recentes)
  initQyonTokens().catch(err => console.warn('[startup] initQyonTokens:', err));
});

export default app;
