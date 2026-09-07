import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import routes from './routes.js';
import { errorHandler } from './middlewares/errorHandler.js';

const app = express();

// Allow all origins dynamically (Localhost, Netlify, Vercel, Custom Domains, Mobile, etc.)
app.use(
  cors({
    origin: (origin, callback) => {
      // Allows any origin that makes the request
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', routes);

app.use(errorHandler);

export default app;
