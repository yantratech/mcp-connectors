# AWS Cost Explorer — read-only setup

`yantra-spend` uses the AWS Cost Explorer API for `aws.source`. The policy in
[`aws-readonly-policy.json`](./aws-readonly-policy.json) grants exactly the
three Cost Explorer read actions the connector calls, and nothing else:

| IAM action | Used by |
|---|---|
| `ce:GetCostAndUsage` | `spend_summary`, `spend_by_source`, `top_movers`, and the `health` probe |
| `ce:GetCostForecast` | `forecast_month_end` |
| `ce:GetAnomalies` | `anomalies` |

Cost Explorer is a single-region service hosted in `us-east-1` even when your
workloads run elsewhere. The connector passes `AWS_REGION` (default
`us-east-1`) to the AWS SDK, which sends Cost Explorer calls to the
`us-east-1` endpoint from any commercial region, so an existing `AWS_REGION`
setting does not need to change. CE charges per request — at time of writing, the
public price is **$0.01 per request** for the standard `Get*` calls. Each AWS
query is one request, plus one more for each extra page when Cost Explorer
paginates a large result. `spend_summary` and `top_movers` query both the
requested window and the equal-length prior window, so they typically make two
requests; the other tools make one.

## Create a least-privilege IAM user

Run these from the root of the repository checkout:

```bash
aws iam create-user --user-name yantra-spend-readonly

aws iam put-user-policy \
  --user-name yantra-spend-readonly \
  --policy-name YantraSpendReadOnly \
  --policy-document file://connectors/yantra-spend/docs/iam/aws-readonly-policy.json

aws iam create-access-key --user-name yantra-spend-readonly
```

Plug the resulting `AccessKeyId` and `SecretAccessKey` into the connector's
`.env` (or your MCP client's `env` block) as `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY`. `AWS_REGION` can remain `us-east-1` (the default).

## Multi-account organisations

For Organisations / management-account roll-ups, attach the policy to a role
(or user) in the management account and pass `group_by: "account"` to
`spend_by_source`; the connector maps it to Cost Explorer's `LINKED_ACCOUNT`
dimension and fans results out by member account.

## Sanity check

```bash
# GNU date (Linux) first; the -v-7d form is the macOS/BSD fallback.
SEVEN_DAYS_AGO=$(date -u -d '7 days ago' +%F 2>/dev/null || date -u -v-7d +%F)

aws ce get-cost-and-usage \
  --time-period Start="$SEVEN_DAYS_AGO",End="$(date -u +%F)" \
  --granularity DAILY \
  --metrics UnblendedCost \
  --region us-east-1
```

If this returns `ResultsByTime`, the credentials work. The connector's
`spend_by_source` tool with `source: "aws"` exercises the same call.
