# SkillSpector adaptation notes for MCP Doctor

Source reviewed: NVIDIA/SkillSpector v2.8.1, Apache-2.0.

## Fit

SkillSpector is broader than MCP Doctor: it scans agent skills/repositories for malicious or risky behavior. MCP Doctor is narrower and intentionally local-first: diagnose MCP client config problems without starting untrusted servers or doing network calls by default.

The best path is not to import SkillSpector wholesale. Instead, adapt a few design ideas and reimplement small MCP-relevant checks in MCP Doctor's dependency-light Node style.

## Ideas worth adapting

### 1. Structured finding model

SkillSpector findings include:

- rule id
- category
- severity
- confidence
- file/location
- explanation
- remediation
- tags

MCP Doctor currently has severity, code, server, message, and fix. A light enhancement could add optional `category`, `confidence`, `location`, and `evidence` fields while keeping the current human-readable output stable.

### 2. MCP least-privilege checks

SkillSpector has an MCP least-privilege analyzer that compares declared permissions/tools against detected behavior categories such as shell, network, file read/write, env access, and MCP client access.

MCP Doctor adaptation:

- For config-level diagnosis, map command/args/env to capability hints.
- Warn when a server command implies broad shell/network/file/env power.
- Warn when config declares a very broad tool surface or wildcard-like permission metadata if present.
- Do not inspect or run remote packages by default.

Potential rules:

- `broad-command-capability`
- `env-access-capability`
- `network-capability`
- `file-system-capability`
- `wildcard-tool-scope`

### 3. Tool-poisoning metadata checks

SkillSpector checks for hidden instructions, comments, zero-width characters, data URIs, base64 blobs, confusable Unicode identifiers, and overly long parameter descriptions.

MCP Doctor adaptation:

- Scan server names, descriptions, tool names, and any metadata fields present in config.
- Flag zero-width characters and Unicode confusables in server/tool names.
- Flag hidden HTML/Markdown comments in config strings.
- Flag huge descriptions or base64/data URI payloads in metadata.

Potential rules:

- `hidden-metadata-instruction`
- `confusable-server-name`
- `zero-width-metadata`
- `encoded-metadata-payload`
- `oversized-tool-description`

### 4. Rug-pull / unpinned package checks

SkillSpector's MCP rug-pull analyzer flags unpinned `npx`, `uvx`, `pip install`, and Docker references.

MCP Doctor already warns about `npx` prompting and startup install risk. It should add explicit version-pinning guidance:

- `npx @scope/server` without `@version`
- `uvx package` without `==version` or comparable pin
- `pip install package` without `==version`
- `docker run image` without tag or digest, especially `latest`

Potential rules:

- `unpinned-npx-server`
- `unpinned-uvx-server`
- `unpinned-pip-server`
- `unpinned-docker-image`

### 5. Inspection completeness

SkillSpector reports what was fully inspected, skipped, partially inspected, or disabled. MCP Doctor can add a lightweight equivalent:

- config parsed or not
- server count inspected
- servers skipped because shape was invalid
- checks disabled by flags
- files/configs found via `--find`

This helps users trust the report and notice blind spots.

### 6. Baselines / suppression

SkillSpector supports baselines for known findings. MCP Doctor could later add a small `.mcp-doctor-baseline.json` with exact finding suppressions by `code + server + message/evidence`.

Not first priority, but useful once the tool has more security-oriented warnings.

## Code/licensing note

SkillSpector is Apache-2.0. MCP Doctor is MIT. Directly copying code would require preserving Apache notices and being careful with license compatibility/documentation. Prefer reimplementing the small ideas above instead of copying source.

## Recommended implementation order

1. Add structured optional finding fields without changing existing CLI output.
2. Add unpinned package/image checks — high value, simple, fits current config-only mission.
3. Add Unicode/hidden metadata checks for server names and config string values.
4. Add inspection completeness in JSON output and a short text footer only when there are skipped/partial checks.
5. Consider baseline suppression later.

## Implemented 2026-08-10

- Added optional structured finding fields: `category`, `confidence`, `location`, and `evidence`.
- Added JSON `inspection` summary with config read/parse status and server inspected/skipped counts.
- Added unpinned runtime checks for `npx`, `uvx`, `pip install`, and `docker run` image references.
- Added metadata checks for zero-width/bidi characters, selected Unicode confusables in name-like fields, hidden comment markers, data/base64 payloads, and oversized descriptions.
- Added regression tests for the adapted checks. Normal text output remains stable, with a short inspection footer only when invalid server shapes were skipped; structured details are available in `--json` output.

## Non-goals

- Do not start MCP servers during default diagnosis.
- Do not add network calls to the default diagnostic path.
- Do not add Python/LangGraph/YARA dependencies to MCP Doctor.
- Do not expose a server mode by default.
