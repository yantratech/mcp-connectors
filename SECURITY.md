# Security Policy

Yantra Applied Technologies Limited is committed to the security of its systems
and products, including the MCP servers in this repository.

## Reporting a vulnerability

Please report security vulnerabilities to **security@yantratech.com**.

Reports are received and triaged by the Yantra Security Committee and the
Security Incident Response Team. To help us reproduce and assess the issue,
please include where you can:

- A description of the vulnerability and its potential impact
- Steps to reproduce it
- Any relevant technical details (screenshots, logs, proof of concept)

Please do **not** open a public GitHub issue for security vulnerabilities.

## What we commit to

When you report a vulnerability in good faith, we will:

- Acknowledge receipt within **2 business days**
- Provide an initial assessment within **5 business days**
- Work to remediate confirmed vulnerabilities in a timely manner
- Keep you informed of progress where you have provided contact details
- **Not take legal action** against reporters who act in good faith and in
  compliance with this policy

## What we ask of reporters

- Provide sufficient detail for us to reproduce and verify the vulnerability
- Allow reasonable time for remediation before any public disclosure
- Do not access, modify, or delete data belonging to others
- Do not exploit a vulnerability beyond what is necessary to demonstrate it
- Do not perform denial-of-service attacks or social engineering against
  company personnel

## Scope

This policy covers the code in this repository, Yantra's public-facing systems
and websites, and products and applications developed and operated by Yantra.

## A note on these MCP servers specifically

The connectors in this repository are **local, single-user stdio servers**.
They execute with the permissions of the user who runs them and with whatever
API credentials are provided via environment variables. Treat tool access as
equivalent to handing your API keys to the calling agent: scope credentials to
the minimum permissions you need, and review tool annotations (read-only /
destructive) before enabling write access in an agent that processes untrusted
input.
