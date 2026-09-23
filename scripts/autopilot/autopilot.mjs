#!/usr/bin/env node
// Runway autopilot runner.
// Loops headless Claude Code sessions until the build is done, the budget runs out,
// or something goes wrong three times in a row. Run it from the repo root:
//
//   node scripts/autopilot/autopilot.mjs --budget 75 --max-cycles 40
//
// Flags:
//   --budget <usd>            stop once reported spend passes this (default 75)
//   --max-cycles <n>          stop after this many sessions (default 40)
//   --max-turns <n>           turns inside one session (default 200)
//   --cooldown-min <n>        pause between sessions (default 2)
//   --rate-limit-wait-min <n> pause when the plan says slow down (default 20)
//   --claude <path>           claude binary (default "claude")
//   --settings <path>         permission settings file
//   --bare                    run plan-independent on ANTHROPIC_API_KEY
//   --once                    single session, then exit
//   --dry-run                 print the command and exit
//
// Stop it any time with Ctrl-C, or by creating .autopilot/STOP.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const flags = parseFlags(process.argv.slice(2));
const repo = process.cwd();
const stateDir = path.join(repo, '.autopilot');
const logFile = path.join(repo, 'docs', 'autopilot-log.md');

const cfg = {
  claude: flags.claude ?? 'claude',
  budget: num(flags.budget, 75),
  maxCycles: flags.once ? 1 : num(flags['max-cycles'], 40),
  maxTurns: num(flags['max-turns'], 200),
  cooldownMs: num(flags['cooldown-min'], 2) * 60_000,
  rateLimitWaitMs: num(flags['rate-limit-wait-min'], 20) * 60_000,
  settings: flags.settings ?? 'scripts/autopilot/settings.json',
  bare: Boolean(flags.bare),
  dryRun: Boolean(flags['dry-run']),
};

const PROMPT = `Read CLAUDE.md, then docs/PROGRESS.md, then docs/AUTOPILOT.md, then docs/PHASES.md.

You are running unattended under the rules in docs/AUTOPILOT.md. Nobody can answer
questions or approve prompts, so never ask one and never wait.

Take the next unfinished phase in docs/PHASES.md and work it end to end: plan, build in
small steps, commit after each step with "phase N: <what changed>", and push. Run
lint, typecheck, test, and build before every push. If something is blocked on a
credential or a human click, park it in docs/BLOCKED.md and move to the next phase that
is not blocked.

Before you finish, update docs/PROGRESS.md so the next session can continue with no
memory of this one. If every phase through Phase 8 is complete or parked, write
docs/HANDOFF.md and create the file .autopilot/DONE.`;

mkdirSync(stateDir, { recursive: true });
mkdirSync(path.dirname(logFile), { recursive: true });

if (cfg.dryRun) {
  console.log([cfg.claude, ...claudeArgs()].join(' '));
  process.exit(0);
}

let spent = 0;
let cycle = 0;
let failures = 0;
let stopReason = 'cycle limit reached';

log(`\n## Autopilot run started ${new Date().toISOString()}\n`);
log(`Budget $${cfg.budget}, up to ${cfg.maxCycles} sessions, ${cfg.maxTurns} turns each.\n`);

while (cycle < cfg.maxCycles) {
  if (existsSync(path.join(stateDir, 'DONE'))) { stopReason = 'the build reported DONE'; break; }
  if (existsSync(path.join(stateDir, 'STOP'))) { stopReason = 'STOP file found'; break; }
  if (spent >= cfg.budget) { stopReason = `budget reached ($${spent.toFixed(2)})`; break; }

  cycle += 1;
  const started = Date.now();
  process.stdout.write(`\n[cycle ${cycle}] starting, spent so far $${spent.toFixed(2)}\n`);

  const run = await runClaude();
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  writeFileSync(path.join(stateDir, `cycle-${cycle}.json`), run.raw || '');

  if (run.rateLimited) {
    const wait = cfg.rateLimitWaitMs;
    log(`- cycle ${cycle}: rate limited after ${minutes} min. Waiting ${wait / 60_000} min and retrying.`);
    process.stdout.write(`[cycle ${cycle}] rate limited, waiting ${wait / 60_000} min\n`);
    cycle -= 1;
    await sleep(wait);
    continue;
  }

  if (run.authFailed && process.env.ANTHROPIC_API_KEY && !cfg.bare) {
    cfg.bare = true;
    log(`- cycle ${cycle}: plan login failed. Switching to API key billing (--bare) and retrying.`);
    process.stdout.write(`[cycle ${cycle}] plan login failed, switching to API key billing\n`);
    cycle -= 1;
    continue;
  }

  spent += run.cost;
  const summary = (run.summary || '').replace(/\s+/g, ' ').slice(0, 400);

  if (run.ok) {
    failures = 0;
    log(`- cycle ${cycle}: ok, ${minutes} min, $${run.cost.toFixed(2)} (total $${spent.toFixed(2)}). ${summary}`);
  } else {
    failures += 1;
    log(`- cycle ${cycle}: FAILED (${failures} in a row), ${minutes} min, $${run.cost.toFixed(2)}. ${summary}`);
    if (failures >= 3) { stopReason = 'three failed sessions in a row'; break; }
  }

  writeFileSync(path.join(stateDir, 'status.json'), JSON.stringify({
    cycle, spentUsd: Number(spent.toFixed(2)), lastOk: run.ok, lastSummary: summary,
    updatedAt: new Date().toISOString(),
  }, null, 2));

  if (existsSync(path.join(stateDir, 'DONE'))) { stopReason = 'the build reported DONE'; break; }
  await sleep(cfg.cooldownMs);
}

log(`\nRun stopped: ${stopReason}. ${cycle} sessions, $${spent.toFixed(2)} reported spend.\n`);
process.stdout.write(`\nStopped: ${stopReason}. ${cycle} sessions, $${spent.toFixed(2)}.\n`);
process.stdout.write(`Read docs/autopilot-log.md, docs/PROGRESS.md, docs/BLOCKED.md, and docs/HANDOFF.md.\n`);

function claudeArgs() {
  const args = ['-p', PROMPT, '--output-format', 'json', '--permission-mode', 'auto',
    '--permission-prompts', 'none', '--max-turns', String(cfg.maxTurns)];
  if (existsSync(path.join(repo, cfg.settings))) args.push('--settings', cfg.settings);
  if (cfg.bare) args.push('--bare');
  return args;
}

function runClaude() {
  return new Promise((resolve) => {
    const child = spawn(cfg.claude, claudeArgs(), { cwd: repo, shell: process.platform === 'win32' });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; process.stderr.write(d); });
    child.on('error', (e) => resolve({ ok: false, cost: 0, summary: `runner could not start claude: ${e.message}`, raw: '' }));
    child.on('close', (code) => {
      const parsed = parseResult(out);
      const text = `${parsed.text} ${err}`;
      resolve({
        ok: code === 0 && !parsed.isError,
        cost: parsed.cost,
        summary: parsed.text || err || `exit code ${code}`,
        raw: out,
        rateLimited: /rate[_ ]?limit|usage limit|429|overloaded/i.test(text),
        authFailed: /authentication_failed|invalid api key|credit balance|subscription|oauth/i.test(text),
      });
    });
  });
}

function parseResult(stdout) {
  const fallback = { cost: 0, isError: true, text: stdout.slice(0, 400) };
  if (!stdout.trim()) return fallback;
  const candidates = [stdout, ...stdout.trim().split('\n').reverse()];
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === 'object') {
        return {
          cost: Number(obj.total_cost_usd ?? 0),
          isError: Boolean(obj.is_error),
          text: typeof obj.result === 'string' ? obj.result : JSON.stringify(obj).slice(0, 400),
        };
      }
    } catch { /* keep looking */ }
  }
  return fallback;
}

function log(line) {
  appendFileSync(logFile, `${line}\n`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i += 1; } else { out[key] = true; }
  }
  return out;
}
