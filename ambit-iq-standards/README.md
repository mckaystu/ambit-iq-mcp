# Ambit.IQ standards

Conventions and AI context for work on **Ambit.IQ** (policy checks, MCP, GRC logging, certificates). Use this folder as its own Cursor project, or copy `.cursor/` and `AGENTS.md` into another repo when you want the same guardrails.

**Related code:** sibling repo [`../ambit-iq-mcp`](../ambit-iq-mcp) (MCP server, Prisma, Vercel).

## Contents

| Item | Purpose |
|------|---------|
| `AGENTS.md` | Instructions for coding agents working in the Ambit.IQ ecosystem |
| `.cursor/rules/` | Cursor rules loaded automatically for this workspace |

## Human workflow

1. Open this directory in Cursor when authoring standards or reviewing agent behavior.
2. When implementing MCP or policy changes, work in `ambit-iq-mcp` and keep this repo’s `AGENTS.md` / rules aligned with real behavior.
