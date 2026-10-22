# Security Policy

Yantra Applied Technologies Limited is committed to the security of its systems
and products, including the MCP servers in this repository.

## Reporting a vulnerability

To report a vulnerability in the code in this repository, either:

- email **security@yantratech.com**, or
- use GitHub's private vulnerability reporting:
  [report a vulnerability](https://github.com/yantratech/mcp-connectors/security/advisories/new).

Reports are triaged by Yantra's security team. To help us reproduce and assess
the issue, please include where you can:

- A description of the vulnerability and its potential impact
- Steps to reproduce it
- Any relevant technical details (screenshots, logs, proof of concept)

Please do **not** open a public GitHub issue for security vulnerabilities.

## Policy, scope and response times

We handle reports under Yantra's
[Responsible Disclosure Policy](https://yantratech.com/legal/), which sets the
safe harbour, what is in and out of scope, and our response targets: we aim to
reply within 5 working days and to assess valid reports within 10 working
days. If this file and that policy differ, the policy applies.

Vulnerabilities in the third-party services these connectors call are out of
scope; please report those to the vendor concerned.

## A note on these MCP servers specifically

The connectors in this repository are **local, single-user stdio servers**.
They execute with the permissions of the user who runs them and with whatever
API credentials are provided via environment variables. Treat tool access as
equivalent to handing your API keys to the calling agent: scope credentials to
the minimum permissions you need, and review tool annotations (read-only /
destructive) before enabling write access in an agent that processes untrusted
input.
