import { existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const SECRET_KEY_RE = /(api[_-]?key|token|secret|password|bearer|auth)/i;
const SECRET_VALUE_RE = /(sk-[a-zA-Z0-9_-]{12,}|ghp_[a-zA-Z0-9_]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|Bearer\s+[a-zA-Z0-9._-]{12,})/;
const ENV_REF_RE = /\$\{?([A-Z_][A-Z0-9_]*)\}?/g;
const COMMON_CONFIGS = [
  '.cursor/mcp.json',
  '.mcp.json',
  'mcp.json',
  '.openclaw/mcp.json',
  '.codex/mcp.json',
  '.claude/mcp.json',
  'claude_desktop_config.json',
  'claude-code-mcp.json',
  '.config/Claude/claude_desktop_config.json',
  'Library/Application Support/Claude/claude_desktop_config.json'
];

export function findCandidateConfigs(cwd = process.cwd()) {
  const roots = [cwd, homedir()];
  const seen = new Set();
  const found = [];
  for (const root of roots) {
    for (const rel of COMMON_CONFIGS) {
      const path = resolve(root, rel);
      if (!seen.has(path) && existsSync(path)) {
        seen.add(path);
        found.push(path);
      }
    }
  }
  return found;
}

export function diagnoseFile(path, options = {}) {
  const env = options.env || process.env;
  const pathEnv = options.pathEnv || env.PATH || '';
  const report = { path, ok: true, serverCount: 0, findings: [], servers: [] };
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    add(report, 'error', 'file-not-readable', `Cannot read config: ${error.message}`, `Check the path or permissions for ${path}.`);
    return finish(report);
  }

  const json = parseJson(raw, report);
  if (!json) return finish(report);

  scanRawSecrets(raw, report);
  const servers = normalizeServers(json);
  report.serverCount = servers.length;
  if (!servers.length) {
    add(report, 'warning', 'no-mcp-servers', 'No MCP servers found in mcpServers/servers.', 'Use a config shape like { "mcpServers": { "name": { "command": "node", "args": ["server.js"] } } }.');
  }
  if (servers.length > 20) {
    add(report, 'warning', 'too-many-servers', `${servers.length} servers configured. Large MCP menus often confuse agents and slow startup.`, 'Disable unused servers and keep the active set focused on the current workflow.');
  }

  for (const server of servers) diagnoseServer(server, report, env, pathEnv, path);
  return finish(report);
}

function parseJson(raw, report) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    add(report, 'error', 'invalid-json', `Invalid JSON: ${error.message}`, 'Remove comments/trailing commas or convert JSONC to strict JSON before loading it in MCP clients.');
    return null;
  }
}

function normalizeServers(config) {
  const source = config.mcpServers || config.servers || config.tools || config.mcp_servers;
  if (!source) return [];
  if (Array.isArray(source)) return source.map((value, index) => ({ name: value.name || `server-${index + 1}`, config: value }));
  if (typeof source === 'object') return Object.entries(source).map(([name, value]) => ({ name, config: value || {} }));
  return [];
}

function diagnoseServer(server, report, env, pathEnv, configPath) {
  const cfg = server.config;
  const serverReport = { name: server.name, command: cfg.command || null, findings: [] };
  report.servers.push(serverReport);
  const localAdd = (severity, code, message, fix) => {
    const finding = { severity, code, server: server.name, message, fix };
    report.findings.push(finding);
    serverReport.findings.push(finding);
  };

  if (!cfg || typeof cfg !== 'object') {
    localAdd('error', 'server-config-not-object', 'Server config is not an object.', 'Replace this server entry with an object containing command, args, and env.');
    return;
  }

  if (!cfg.command) {
    localAdd('error', 'missing-command', 'Missing command.', 'Add a command such as "node", "python3", "npx", "uvx", or an absolute executable path.');
  } else if (typeof cfg.command !== 'string') {
    localAdd('error', 'command-not-string', 'Command must be a string.', 'Set command to a string executable name or absolute path.');
  } else {
    checkCommand(cfg.command, localAdd, pathEnv);
    checkRuntimeRisk(cfg.command, cfg.args || [], localAdd, configPath);
  }

  if (cfg.args !== undefined && !Array.isArray(cfg.args)) {
    localAdd('error', 'args-not-array', 'args must be an array.', 'Change args to an array, for example: "args": ["server.js"].');
  }
  if (cfg.env !== undefined && (!cfg.env || typeof cfg.env !== 'object' || Array.isArray(cfg.env))) {
    localAdd('error', 'env-not-object', 'env must be an object.', 'Change env to an object of KEY/value pairs.');
  }

  checkEnvReferences(server.name, cfg, env, localAdd);
  checkSecrets(server.name, cfg, localAdd);
  checkStdioPollution(cfg, localAdd);
  checkToolHints(cfg, localAdd);
}

function checkCommand(command, addFinding, pathEnv) {
  if (isAbsolute(command)) {
    if (!existsSync(command)) addFinding('error', 'command-not-found', `Command path does not exist: ${command}`, 'Install the executable or update the config to the correct absolute path.');
    else if (!isExecutable(command)) addFinding('warning', 'command-not-executable', `Command exists but may not be executable: ${command}`, `Run chmod +x ${command} or point to the interpreter plus script path.`);
    return;
  }
  if (!which(command, pathEnv)) {
    addFinding('error', 'command-not-found', `Command not found on PATH: ${command}`, `Install ${command}, use an absolute path, or launch the MCP client with the PATH that contains it.`);
  }
}

function checkRuntimeRisk(command, args, addFinding, configPath) {
  const joined = args.join(' ');
  if ((command === 'npx' || command.endsWith('/npx')) && !args.includes('-y') && !args.includes('--yes')) {
    addFinding('warning', 'npx-may-prompt', 'npx may prompt on first install and hang MCP startup.', 'Add -y/--yes, pin the package version, or install the server package ahead of time.');
  }
  if (/^(python|python3)$/.test(command) && args[0] && !existsSync(resolve(dirname(configPath), args[0])) && !existsSync(args[0])) {
    addFinding('warning', 'python-script-path-risk', `Python script path may not resolve from the MCP client working directory: ${args[0]}`, 'Use an absolute script path or set cwd if your client supports it.');
  }
  if (/^(node)$/.test(command) && args[0] && args[0].endsWith('.js') && !existsSync(resolve(dirname(configPath), args[0])) && !existsSync(args[0])) {
    addFinding('warning', 'node-script-path-risk', `Node script path may not resolve from the MCP client working directory: ${args[0]}`, 'Use an absolute script path or package bin command.');
  }
  if (/install|pip\s+install|npm\s+install/.test(joined)) {
    addFinding('warning', 'startup-install-risk', 'Server args appear to install packages during startup.', 'Install dependencies before launching MCP; startup should only run the server.');
  }
  if (joined.length > 300) {
    addFinding('info', 'long-command', 'Command args are long and may hide path/env mistakes.', 'Move complex setup into a checked-in script and call that script from MCP config.');
  }
}

function dirname(path) {
  const normalized = path.replace(/\\/g, '/');
  return normalized.slice(0, normalized.lastIndexOf('/')) || '.';
}

function checkEnvReferences(serverName, cfg, env, addFinding) {
  const values = [...(cfg.args || []), ...Object.values(cfg.env || {})].filter((value) => typeof value === 'string');
  for (const value of values) {
    for (const name of extractEnvRefs(value)) {
      if (!env[name]) addFinding('error', 'missing-env-var', `Referenced environment variable is not set: ${name}`, `Export ${name} before launching the MCP client or set it in this server's env block.`);
    }
  }
  for (const [key, value] of Object.entries(cfg.env || {})) {
    if ((value === '' || value === undefined || value === null) && SECRET_KEY_RE.test(key)) {
      addFinding('error', 'empty-secret-env', `Secret-like env var ${key} is empty.`, `Set ${key} securely outside committed config.`);
    }
  }
}

function extractEnvRefs(value) {
  const refs = [];
  ENV_REF_RE.lastIndex = 0;
  let match;
  while ((match = ENV_REF_RE.exec(value))) refs.push(match[1]);
  return refs;
}

function checkSecrets(serverName, cfg, addFinding) {
  for (const [key, value] of Object.entries(cfg.env || {})) {
    if (SECRET_KEY_RE.test(key) && typeof value === 'string' && value && !value.includes('$')) {
      addFinding('warning', 'literal-secret-in-config', `Secret-like env var ${key} has a literal value in config.`, `Move ${key} to your shell, keychain, or uncommitted .env and reference it as $${key}.`);
    }
  }
  for (const arg of cfg.args || []) {
    if (typeof arg === 'string' && SECRET_VALUE_RE.test(arg)) {
      addFinding('warning', 'secret-looking-arg', 'An argument looks like it contains a token or API key.', 'Move secrets out of args and into environment variables or a secret manager.');
    }
  }
}

function scanRawSecrets(raw, report) {
  if (SECRET_VALUE_RE.test(raw)) {
    add(report, 'warning', 'secret-looking-config', 'Config text contains a token-shaped value.', 'Rotate the exposed token if committed, then replace it with an environment variable reference.');
  }
}

function checkStdioPollution(cfg, addFinding) {
  const args = cfg.args || [];
  const joined = args.join(' ');
  if (/console\.log|print\(|echo\s+/.test(joined)) {
    addFinding('warning', 'stdio-pollution-risk', 'Startup command hints at printing to stdout before MCP protocol messages.', 'Write diagnostics to stderr, or remove startup prints before using stdio MCP.');
  }
  if (cfg.env && /debug|trace/i.test(String(cfg.env.DEBUG || cfg.env.LOG_LEVEL || ''))) {
    addFinding('info', 'debug-logging-risk', 'Debug logging may pollute stdio for stdio MCP servers.', 'Send logs to stderr/file or disable debug logging during MCP startup.');
  }
}

function checkToolHints(cfg, addFinding) {
  const declared = cfg.tools || cfg.toolCount || cfg.expectedTools;
  const count = Array.isArray(declared) ? declared.length : Number(declared);
  if (Number.isFinite(count) && count > 40) {
    addFinding('warning', 'too-many-tools', `${count} tools declared/expected. Agents often degrade with very large tool menus.`, 'Split this server into smaller task-specific servers or disable tools unrelated to the current workflow.');
  }
}

function which(command, pathEnv) {
  for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, command);
    if (existsSync(candidate) && isExecutable(candidate)) return candidate;
  }
  return null;
}

function isExecutable(path) {
  try {
    const mode = statSync(path).mode;
    return Boolean(mode & 0o111);
  } catch {
    return false;
  }
}

function add(report, severity, code, message, fix) {
  report.findings.push({ severity, code, message, fix });
}

function finish(report) {
  report.ok = !report.findings.some((finding) => finding.severity === 'error');
  report.summary = summarize(report.findings);
  return report;
}

function summarize(findings) {
  return findings.reduce((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] || 0) + 1;
    return acc;
  }, { error: 0, warning: 0, info: 0 });
}

export function formatTextReport(report) {
  const lines = [];
  lines.push(`MCP Doctor: ${report.path}`);
  lines.push(`Status: ${report.ok ? 'OK' : 'NEEDS FIX'} (${report.summary.error} errors, ${report.summary.warning} warnings, ${report.summary.info} info)`);
  lines.push(`Servers: ${report.serverCount}`);
  if (!report.findings.length) {
    lines.push('No issues found.');
    return lines.join('\n');
  }
  for (const finding of report.findings) {
    const scope = finding.server ? ` [${finding.server}]` : '';
    lines.push(`- ${finding.severity.toUpperCase()} ${finding.code}${scope}: ${finding.message}`);
    lines.push(`  Fix: ${finding.fix}`);
  }
  return lines.join('\n');
}
