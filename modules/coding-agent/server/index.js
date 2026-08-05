// index.js — standalone entry point for the coding-agent module.
// Uses the same app factory as app.js so it can run either standalone
// (`npm run dev:agent` / `npm start`) or mounted inside another app.
import './env.js'; // MUST stay first — see env.js for why
import { createServer } from 'http';
import { createCodingAgentApp } from './app.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('server');

const PORT = process.env.PORT || 3000;

// Create HTTP server and pass it to the app factory
const httpServer = createServer();
const app = createCodingAgentApp(httpServer);

// Attach the Express app to the HTTP server
httpServer.on('request', app);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Coding Agent v2.0 running on port ${PORT}`);
  console.log(`📡 Alibaba endpoint: ${process.env.ALIBABA_BASE_URL || 'using workspace ID'}`);
  console.log(`🤖 Models available: 68 working models`);
  console.log(`🔒 Security: Enhanced with helmet, rate limiting, audit logging`);
  console.log(`👥 Collaboration: Real-time editing enabled`);
  console.log(`📊 Code Analysis: Complexity, bugs, optimizations\n`);
  
  logger.info('Server started', { 
    port: PORT, 
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid 
  });
});

export { httpServer, app };
