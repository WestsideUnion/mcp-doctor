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
