# AWS Cost Explorer — read-only setup

`yantra-spend` uses three Cost Explorer read actions. The policy in [aws-readonly-policy.json](./aws-readonly-policy.json) covers this adapter; it grants no Budgets access.

| IAM action | Used by |
|---|---|
| `ce:GetCostAndUsage` | `spend_summary`, `spend_by_source`, `top_movers`, and the `health` probe |
| `ce:GetCostForecast` | `forecast_month_end` |
| `ce:GetAnomalies` | `anomalies` |

Cost Explorer uses the `us-east-1` endpoint. Leave `AWS_REGION` unset or set it to `us-east-1`. Cost Explorer requests can incur charges, including pagination and comparisons with prior periods.

## Use an IAM Identity Center or role profile

Have the account administrator assign the read policy to the intended permission set or role. Configure a named profile using the standard AWS CLI configuration. For an IAM Identity Center profile:

```fish
aws configure sso --profile spend-readonly
aws sso login --profile spend-readonly
aws sts get-caller-identity --profile spend-readonly
```

Confirm that the returned account and role are the intended billing reader. Set `AWS_PROFILE=spend-readonly` in the MCP client's environment or the connector's `.env`. Remove static `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN` entries from both locations when using a profile. The Node.js AWS SDK uses its normal credential chain and refreshes temporary role credentials where the configured provider supports it. The connector does not start an interactive sign-in; log in again when the SSO session expires, then retry the tool.

An explicitly configured profile enables AWS even before credentials resolve. An invalid profile or expired session produces a tool error or a failed health probe, rather than silently omitting AWS. With neither a profile nor a complete environment access-key pair, AWS is unavailable and skipped.

Existing environment-key configurations remain supported: provide `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, plus `AWS_SESSION_TOKEN` when using temporary credentials. Prefer the profile path for human-operated local sessions; do not create a long-lived key just to configure this connector.

## Multi-account organisations

For management-account roll-ups, use a permission set or role in the management account and pass `group_by: "account"` to `spend_by_source`. The connector maps this to Cost Explorer's `LINKED_ACCOUNT` dimension.

## Verify operation

After checking the profile identity, run the connector's `health` tool and `spend_by_source` with `source: "aws"` and a recent date range. Verify `forecast_month_end` and `anomalies` as well; a forecast requires sufficient Cost Explorer history. A successful identity check alone does not establish Cost Explorer permissions.
