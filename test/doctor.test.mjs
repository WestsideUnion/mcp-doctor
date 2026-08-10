import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diagnoseFile, formatTextReport } from '../src/doctor.mjs';

test('reports invalid JSON with exact fix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-doctor-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, '{ "mcpServers": { trailing: }');
  const report = diagnoseFile(path);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0].code, 'invalid-json');
  assert.match(report.findings[0].fix, /trailing commas|JSONC/);
});

test('detects missing commands, env vars, secrets, npx prompt, and too many tools', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-doctor-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({
    mcpServers: {
      broken: {
        command: 'definitely-not-a-real-command',
        args: ['--token', 'sk-testtoken1234567890'],
        env: { API_KEY: 'literal-secret' },
        expectedTools: 41
      },
      package: {
        command: 'npx',
        args: ['some-mcp-server', '--key=${MISSING_KEY}']
      }
    }
  }, null, 2));
  const report = diagnoseFile(path, { env: { PATH: process.env.PATH }, pathEnv: process.env.PATH });
  const codes = report.findings.map((finding) => finding.code);
  assert.equal(report.ok, false);
  assert.ok(codes.includes('command-not-found'));
  assert.ok(codes.includes('missing-env-var'));
  assert.ok(codes.includes('literal-secret-in-config'));
  assert.ok(codes.includes('secret-looking-arg'));
  assert.ok(codes.includes('npx-may-prompt'));
  assert.ok(codes.includes('too-many-tools'));
});

test('formats human-readable report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-doctor-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: { ok: { command: process.execPath, args: ['server.js'] } } }));
  const report = diagnoseFile(path, { env: process.env, pathEnv: process.env.PATH });
  const text = formatTextReport(report);
  assert.match(text, /MCP Doctor:/);
  assert.match(text, /Servers: 1/);
});

test('detects unpinned package and docker MCP server references', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-doctor-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({
    mcpServers: {
      npxServer: { command: 'npx', args: ['-y', '@scope/mcp-server'] },
      uvxServer: { command: 'uvx', args: ['mcp-server'] },
      dockerServer: { command: 'docker', args: ['run', '--rm', 'example/mcp-server'] },
      pipServer: { command: 'python3', args: ['-m', 'pip', 'install', 'mcp-server'] }
    }
  }));
  const report = diagnoseFile(path, { env: process.env, pathEnv: process.env.PATH });
  const codes = report.findings.map((finding) => finding.code);
  assert.ok(codes.includes('unpinned-npx-server'));
  assert.ok(codes.includes('unpinned-uvx-server'));
  assert.ok(codes.includes('unpinned-docker-image'));
  assert.ok(codes.includes('unpinned-pip-server'));
  assert.ok(report.findings.find((finding) => finding.code === 'unpinned-npx-server').category);
});

test('detects hidden and encoded metadata payloads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-doctor-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({
    mcpServers: {
      'safe\u200bname': {
        command: process.execPath,
        description: '<!-- hidden instruction -->',
        tools: [{ name: 't\u043Eol', description: 'data:text/plain;base64,SGVsbG8=' }]
      }
    }
  }));
  const report = diagnoseFile(path, { env: process.env, pathEnv: process.env.PATH });
  const codes = report.findings.map((finding) => finding.code);
  assert.ok(codes.includes('zero-width-metadata'));
  assert.ok(codes.includes('confusable-server-name'));
  assert.ok(codes.includes('hidden-metadata-instruction'));
  assert.ok(codes.includes('encoded-metadata-payload'));
});

test('reports inspection completeness and skipped server shapes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-doctor-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: { ok: { command: process.execPath }, bad: 'not an object' } }));
  const report = diagnoseFile(path, { env: process.env, pathEnv: process.env.PATH });
  assert.equal(report.inspection.configRead, true);
  assert.equal(report.inspection.jsonParsed, true);
  assert.equal(report.inspection.serversFound, 2);
  assert.equal(report.inspection.serversInspected, 1);
  assert.equal(report.inspection.serversSkipped, 1);
  assert.ok(report.findings.some((finding) => finding.code === 'server-config-not-object'));
  assert.match(formatTextReport(report), /Inspection: parsed config, inspected 1\/2 servers, skipped 1 invalid server shape/);
});
