#!/usr/bin/env node
import { diagnoseFile, findCandidateConfigs, formatTextReport } from '../src/doctor.mjs';

const args = process.argv.slice(2);
const help = args.includes('-h') || args.includes('--help');
if (help) {
  console.log(`mcp-doctor — diagnose MCP config issues\n\nUsage:\n  mcp-doctor [path/to/mcp.json ...]\n  mcp-doctor --json [path/to/mcp.json ...]\n  mcp-doctor --find\n\nChecks:\n  JSON validity, command existence, env var references, unsafe secrets,\n  stdio pollution hints, Node/Python/package path problems, startup risk,\n  excessive tool/server count, and exact fix suggestions.`);
  process.exit(0);
}

const json = args.includes('--json');
const find = args.includes('--find');
const paths = args.filter((arg) => !arg.startsWith('-'));

if (find) {
  const candidates = findCandidateConfigs();
  if (json) console.log(JSON.stringify(candidates, null, 2));
  else console.log(candidates.length ? candidates.join('\n') : 'No common MCP config files found.');
  process.exit(0);
}

const targets = paths.length ? paths : findCandidateConfigs();
if (!targets.length) {
  console.error('No config path provided and no common MCP config files found. Run: mcp-doctor --help');
  process.exit(2);
}

const reports = targets.map((target) => diagnoseFile(target));
if (json) console.log(JSON.stringify(reports, null, 2));
else console.log(reports.map(formatTextReport).join('\n\n'));

const hasErrors = reports.some((report) => report.findings.some((finding) => finding.severity === 'error'));
process.exit(hasErrors ? 1 : 0);
