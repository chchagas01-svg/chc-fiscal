import 'dotenv/config';
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

// 404 genérico
app.use((_req, res) => {
  res.status(404).json({ erro: 'Endpoint não encontrado' });
});

// Handler de erros
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

app.listen(PORT, () => {
  console.log(`CHC-Fiscal rodando na porta ${PORT}`);
  // Carrega tokens Qyon do banco (sobrescreve env vars se houver tokens mais recentes)
  initQyonTokens().catch(err => console.warn('[startup] initQyonTokens:', err));
});

export default app;
