# Westside Union MCP Doctor

A serious, local-first CLI for diagnosing broken MCP configs before you blame the agent.

Designed for OpenClaw, Hermes Agent, Claude Code, Codex, Cursor-style configs, and other stdio MCP clients.

## What it checks

- JSON validity and strict JSON mistakes
- MCP server config shape (`mcpServers`, `servers`, array-style configs)
- command existence on `PATH` or absolute paths
- missing environment variable references like `$API_KEY` or `${API_KEY}`
- literal secrets accidentally stored in config
- token-looking values in args/config text
- stdio pollution hints that can break MCP handshakes
- Node/Python script path risks
- `npx` prompt/startup timeout risk
- package install during startup
- too many servers or too many tools
- exact fix suggestions for each finding

## Install / run locally

```bash
npm install -g @westsideunion/mcp-doctor
mcp-doctor ~/.cursor/mcp.json
```

Until published, run from this repo:

```bash
node bin/mcp-doctor.mjs path/to/mcp.json
node bin/mcp-doctor.mjs --json path/to/mcp.json
node bin/mcp-doctor.mjs --find
```

## Example config shape

```json
{
  "mcpServers": {
    "example": {
      "command": "node",
      "args": ["/absolute/path/to/server.js"],
      "env": {
        "API_KEY": "$API_KEY"
      }
    }
  }
}
```

## Example output

```text
MCP Doctor: ./mcp.json
Status: NEEDS FIX (1 errors, 2 warnings, 0 info)
Servers: 1
- ERROR command-not-found [crm]: Command not found on PATH: uvx
  Fix: Install uvx, use an absolute path, or launch the MCP client with the PATH that contains it.
```

## Why this matters

Most MCP failures are boring setup failures:

- the JSON has a trailing comma
- the client starts with a different `PATH`
- `npx` prompts and hangs
- the server prints logs to stdout before the MCP handshake
- a required env var only exists in the terminal, not the GUI-launched client
- a config file accidentally contains a secret

MCP Doctor makes those failures explicit and fixable.

## Tests

```bash
npm test
npm run check
```
