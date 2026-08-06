// lib/fileContext.js
//
// aider works much better when it's told which files matter for a task
// instead of relying purely on its own repo-map guess — especially for
// "add X to the Y module" style tasks where the file isn't named in the
// prompt. This gives two ways to get files in front of it:
//
//   1. Manual: the user (or an external caller/LLM) picks files explicitly
//      — see sanitizeRelFiles(), used to validate whatever list comes in.
//   2. Automatic: suggestFiles() scores every file in the repo against the
//      task text and returns the best matches, used as a fallback when no
//      explicit files were given, and exposed via POST
//      /api/agent/suggest-files so a caller (UI or LLM) can preview/adjust
//      the guess before running aider.
import fs from 'fs';
import path from 'path';
import { buildTree } from './fileTree.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for',
  'with', 'is', 'are', 'be', 'this', 'that', 'it', 'as', 'at', 'by',
  'from', 'into', 'add', 'make', 'please', 'need', 'needs', 'want',
  'should', 'when', 'where', 'which', 'file', 'files', 'code', 'fix',
  'update', 'change', 'also', 'not', 'can', 'you', 'i', 'we', 'so',
]);

// Only these are worth grepping for content matches — binary/lockfiles/
// build output would just waste time and never be something you'd want
// aider editing anyway.
const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.html', '.css', '.scss', '.json', '.yml', '.yaml', '.md', '.sql',
  '.sh', '.env.example', '.txt',
]);

// Cap how much content-grepping we do so a huge repo/task can't make this
// hang — filename/path scoring below still runs over every file, this cap
// only limits the (more expensive) per-file content read+scan.
const MAX_FILES_TO_GREP = 300;
const MAX_FILE_SIZE_FOR_GREP = 200 * 1024; // 200KB

function flattenFiles(tree, out = []) {
  for (const item of tree) {
    if (item.type === 'file') {
      out.push(item.path);
    } else if (item.children) {
      flattenFiles(item.children, out);
    }
  }
  return out;
}

function extractKeywords(task) {
  const tokens = (task.toLowerCase().match(/[a-z0-9_./-]{3,}/g) || [])
    .filter(t => !STOPWORDS.has(t));
  // Keep both the raw tokens (may include path-like fragments e.g.
  // "routes/auth.js") and their split-up words, so "auth.js" in the task
  // matches a file named auth.js AND scores routes/auth.js on "auth".
  const words = new Set();
  for (const t of tokens) {
    words.add(t);
    for (const part of t.split(/[/._-]/)) {
      if (part.length >= 3 && !STOPWORDS.has(part)) words.add(part);
    }
  }
  return [...words];
}

/**
 * Score and rank repo files by relevance to a task description.
 * Returns up to `limit` { path, score, reason } entries, highest first.
 */
export function suggestFiles({ workDir, task, limit = 8 }) {
  if (!task || !task.trim()) return [];

  const keywords = extractKeywords(task);
  if (keywords.length === 0) return [];

  const allFiles = flattenFiles(buildTree(workDir));
  const scored = [];

  for (const relPath of allFiles) {
    const lowerPath = relPath.toLowerCase();
    const baseName = path.basename(lowerPath, path.extname(lowerPath));
    let score = 0;
    let reason = null;

    for (const kw of keywords) {
      if (baseName === kw) {
        score += 10;
        reason = reason || 'filename match';
      } else if (lowerPath.includes(kw)) {
        score += 4;
        reason = reason || 'path match';
      }
    }

    if (score > 0) {
      scored.push({ path: relPath, score, reason });
    }
  }

  // Content grep pass — only for the strongest path/filename candidates
  // plus a slice of the remaining files, capped so this stays fast.
  scored.sort((a, b) => b.score - a.score);
  const grepCandidates = scored.length < MAX_FILES_TO_GREP
    ? allFiles
    : scored.slice(0, MAX_FILES_TO_GREP).map(s => s.path);

  for (const relPath of grepCandidates) {
    const ext = path.extname(relPath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;

    const fullPath = path.join(workDir, relPath);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_FILE_SIZE_FOR_GREP) continue;
      const content = fs.readFileSync(fullPath, 'utf-8').toLowerCase();

      let contentHits = 0;
      for (const kw of keywords) {
        if (kw.length >= 4 && content.includes(kw)) contentHits += 1;
      }
      if (contentHits > 0) {
        const existing = scored.find(s => s.path === relPath);
        if (existing) {
          existing.score += contentHits * 2;
          existing.reason = existing.reason || 'content match';
        } else {
          scored.push({ path: relPath, score: contentHits * 2, reason: 'content match' });
        }
      }
    } catch {
      // Unreadable/binary/race with a delete — skip, not fatal.
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Validate a list of caller-supplied relative file paths against a repo
 * root. Used for both the manual "attach files" UI and any explicit list
 * an LLM/automation passes in — rejects anything that would escape workDir
 * (e.g. '../../etc/passwd', an absolute path) before it ever reaches the
 * aider CLI args. New files that don't exist yet are allowed through
 * (aider legitimately creates new files when asked to), but the resolved
 * path must still stay inside workDir.
 */
export function sanitizeRelFiles(workDir, relFiles) {
  const root = path.resolve(workDir);
  const clean = [];
  const rejected = [];

  for (const relPath of relFiles || []) {
    if (typeof relPath !== 'string' || !relPath.trim()) continue;
    const resolved = path.resolve(root, relPath);
    if (resolved === root || !resolved.startsWith(root + path.sep)) {
      rejected.push(relPath);
      continue;
    }
    clean.push(path.relative(root, resolved));
  }

  return { files: clean, rejected };
}