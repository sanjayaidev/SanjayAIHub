// env.js — must be the FIRST import in server/index.js.
//
// ESM hoists static imports: every module a file imports is fully
// evaluated before that file's own top-level code runs. server/index.js
// transitively imports server/lib/aider.js, which imports the main
// SanjayAIHub app's db/index.js (shared DB — see aider.js for why) and
// reads process.env.DATABASE_URL as soon as it's evaluated. If dotenv
// were configured inline in index.js *after* its other imports, those
// imports (including db/index.js) would already have run with
// DATABASE_URL unset. Putting the loading logic in its own module and
// importing it first guarantees it runs before anything else does.
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// This service's own .env (PORT, SESSION_SECRET, etc.) takes priority.
dotenv.config();

// Fall back to the main SanjayAIHub app's root .env for anything not set
// above — DATABASE_URL, ALIBABA_API_KEY, ALIBABA_WORKSPACE_ID. The two
// services intentionally share one Postgres DB and one set of provider
// credentials, so this avoids keeping the same values in two files.
// override: false means values already set above always win.
dotenv.config({
  path: path.join(__dirname, '..', '..', '..', '.env'),
  override: false,
});
