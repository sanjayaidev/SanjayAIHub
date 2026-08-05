// app.js — builds the coding-agent Express app WITHOUT starting a server.
//
// This is the piece that's actually mountable inside another app
// (SanjayAIHub's main server.js does `app.use('/agent', createCodingAgentApp(httpServer))`
// so both services run in one process on one port). index.js in this
// folder is a thin wrapper that calls this same factory for standalone
// use (`npm run dev:agent` / `npm start` from modules/coding-agent).
import './env.js'; // MUST stay first — see env.js for why
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';

import agentRoutes from './routes/agent.js';
import authRoutes from './routes/auth.js';
import repoRoutes from './routes/repos.js';
import fileRoutes from './routes/files.js';
import collabRoutes, { initCollaboration } from './routes/collaboration.js';
import analysisRoutes from './routes/codeAnalysis.js';
import { securityMiddleware, auditLogger, monitorRepoAccess } from './middleware/security.js';
import { createLogger } from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger('coding-agent');

/**
 * @param {import('http').Server} httpServer - the (possibly shared) HTTP
 *   server Socket.IO should attach to. Mounting this app under a path
 *   prefix (e.g. app.use('/agent', codingAgentApp)) does NOT prefix
 *   Socket.IO's own path — it binds directly to httpServer's 'upgrade'
 *   event at the default /socket.io/ path, so it works unprefixed even
 *   when the Express routes above it are mounted under /agent.
 */
export function createCodingAgentApp(httpServer) {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  // Initialize collaboration manager with Socket.IO, sharing httpServer
  // rather than creating a second one.
  const { collaborationManager, workspaceManager } = initCollaboration(httpServer);
  app.set('collaborationManager', collaborationManager);
  app.set('workspaceManager', workspaceManager);

  // Needed so `secure` cookies work correctly behind a reverse proxy
  // (Render/Railway/etc.)
  app.set('trust proxy', 1);

  // Middleware
  app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
  }));
  app.use(express.json({ limit: '10mb' }));

  app.use(securityMiddleware);
  app.use(auditLogger);
  app.use(monitorRepoAccess);

  app.use(session({
    name: 'coding_agent.sid',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
    // NOTE: default in-memory store — fine for one instance/low traffic,
    // but sessions are lost on restart and won't share across instances.
    // Swap in connect-redis or connect-pg-simple for persistence/scaling.
  }));

  // Routes - MUST be before static middleware so API calls aren't
  // swallowed by the static/file serving or the SPA catch-all below.
  app.use('/api/agent', agentRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/repos', repoRoutes);
  app.use('/api/files', fileRoutes);
  app.use('/api/collab', collabRoutes);
  app.use('/api/analysis', analysisRoutes);

  // Static files
  app.use(express.static(path.join(__dirname, '../public')));

  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      models: 68,
      version: '2.0.0',
      features: {
        collaboration: true,
        codeAnalysis: true,
        securityEnhanced: true,
        realTimeEditing: true,
      }
    });
  });

  // Serve index.html for all other routes (SPA)
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  logger.info('Coding agent app initialized');
  return app;
}
