# Azure Cost Management — service principal setup

`yantra-spend` uses the Azure Cost Management `Query` and `Forecast` APIs via
the `@azure/arm-costmanagement` SDK, and calls nothing else in Azure. It needs a
tenant-scoped service principal (SP) with read access to cost data on each
subscription you want to include: either the built-in **Cost Management
Reader** role, which is the simplest option, or the narrower custom role
described under [Stricter least privilege](#stricter-least-privilege-a-custom-role).

## Create the service principal

```bash
TENANT_ID=$(az account show --query tenantId -o tsv)
SUBSCRIPTION_IDS=( sub-1-id sub-2-id sub-3-id )   # enumerate everything you want covered

# 1. Create the SP with Cost Management Reader on the listed subscriptions.
SP_JSON=$(az ad sp create-for-rbac \
  --name yantra-spend-readonly \
  --role "Cost Management Reader" \
  --scopes $(printf "/subscriptions/%s " "${SUBSCRIPTION_IDS[@]}") \
  --years 1)

echo "$SP_JSON"
# {
#   "appId": "...",       <- AZURE_CLIENT_ID
#   "displayName": "yantra-spend-readonly",
#   "password": "...",    <- AZURE_CLIENT_SECRET (only shown here, save now)
#   "tenant": "..."       <- AZURE_TENANT_ID
# }
```

If you create the SP without `--role` and `--scopes` (it then has no role
assignment), assign a role afterwards:

```bash
APP_ID=...
for SUB in "${SUBSCRIPTION_IDS[@]}"; do
  az role assignment create \
    --assignee "$APP_ID" \
    --role "Cost Management Reader" \
    --scope "/subscriptions/$SUB"
done
```

## What Cost Management Reader grants

**Cost Management Reader** (built-in role definition ID
`72fafb9e-0641-4937-9268-a91bfd8191a3`) is the narrowest built-in role that
allows the Query and Forecast APIs, but it grants more than the connector
uses. Its actions, per
[Microsoft's published definition](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/management-and-governance#cost-management-reader),
are:

- `Microsoft.Consumption/*/read`
- `Microsoft.CostManagement/*/read`
- `Microsoft.Billing/billingPeriods/read`
- `Microsoft.Billing/billingProperty/read`
- `Microsoft.Resources/subscriptions/read`
- `Microsoft.Resources/subscriptions/resourceGroups/read`
- `Microsoft.Management/managementGroups/read`
- `Microsoft.Advisor/configurations/read`
- `Microsoft.Advisor/recommendations/read`
- `Microsoft.Support/*`

So besides cost data, the role can read consumption, billing and Advisor
data, and `Microsoft.Support/*` lets it create and manage support requests.
It is still much narrower than the general **Reader** role, which can read
every resource in the subscription.

## Stricter least privilege: a custom role

To grant only what the connector calls, define a custom role and assign it in
place of Cost Management Reader. List each subscription in
`AssignableScopes`:

```bash
az role definition create --role-definition '{
  "Name": "Yantra Spend Cost Reader",
  "Description": "Read cost data through the Cost Management Query and Forecast APIs.",
  "Actions": [
    "Microsoft.CostManagement/query/*",
    "Microsoft.CostManagement/forecast/*"
  ],
  "AssignableScopes": [
    "/subscriptions/sub-1-id",
    "/subscriptions/sub-2-id",
    "/subscriptions/sub-3-id"
  ]
}'
```

Create the SP without `--role` and `--scopes`, then run the role-assignment
loop above with `--role "Yantra Spend Cost Reader"`. The two wildcards cover
the read and action forms Azure defines for each API
(`Microsoft.CostManagement/query/read`, `.../query/action`,
`.../forecast/read`, `.../forecast/action`). Run the sanity check below as
the service principal to confirm the role works in your tenant before you
rely on it.

## Configure the connector

In the connector's `.env` (or your MCP client's `env` block):

```
AZURE_TENANT_ID=<tenant id from SP_JSON.tenant>
AZURE_CLIENT_ID=<appId from SP_JSON.appId>
AZURE_CLIENT_SECRET=<password from SP_JSON.password>
AZURE_SUBSCRIPTION_IDS=sub-1-id,sub-2-id,sub-3-id
```

The connector fans out across `AZURE_SUBSCRIPTION_IDS` (comma-separated) in
parallel and concatenates results. If the SP cannot read one of the listed
subscriptions, the whole Azure query fails for that call: `spend_by_source`
returns an error, while `spend_summary`, `top_movers` and
`forecast_month_end` report Azure in `warnings` and still return the other
sources.

## Sanity check

```bash
# --allow-no-subscriptions keeps the login from failing if the SP cannot list
# any subscription (the custom role does not grant
# Microsoft.Resources/subscriptions/read).
az login --service-principal \
  --username "$AZURE_CLIENT_ID" \
  --password "$AZURE_CLIENT_SECRET" \
  --tenant "$AZURE_TENANT_ID" \
  --allow-no-subscriptions

# GNU date (Linux) first; the -v-7d form is the macOS/BSD fallback.
FROM=$(date -u -d '7 days ago' +%FT%TZ 2>/dev/null || date -u -v-7d +%FT%TZ)

# Issues a query against Cost Management for the last 7 days. If this
# returns a non-empty `properties.rows`, the connector will too.
az costmanagement query \
  --type ActualCost \
  --timeframe Custom \
  --time-period from="$FROM" to="$(date -u +%FT%TZ)" \
  --dataset-aggregation '{"totalCost":{"name":"PreTaxCost","function":"Sum"}}' \
  --dataset-granularity Daily \
  --scope "/subscriptions/<sub-id>"
```
