import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import vaultsRouter from './routes/vaults';
import usersRouter from './routes/users';
import adminRouter from './routes/admin';
import { startOperatorExpiryTask } from './tasks/operatorExpiry';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.use('/api/v1/vaults', vaultsRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/admin', adminRouter);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`StellarYield API server running on port ${PORT}`);
  console.log(`Environment: ${config.nodeEnv}`);
  
  startOperatorExpiryTask();
});
