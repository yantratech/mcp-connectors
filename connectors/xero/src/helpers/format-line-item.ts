import { LineItem, LineItemItem, LineItemTracking } from "xero-node";

const formatItem = (item: LineItemItem | undefined): string => {
  if (!item) {
    return "None";
  }
  return [item.code, item.name].filter(Boolean).join(" - ") || "None";
};

const formatTracking = (
  tracking: Array<LineItemTracking> | undefined,
): string => {
  if (!tracking || tracking.length === 0) {
    return "None";
  }
  return tracking
    .map((category) => `${category.name}: ${category.option}`)
    .join(", ");
};

export const formatLineItem = (lineItem: LineItem): string => {
  // Absent fields are omitted rather than rendered as a literal "undefined";
  // numeric fields keep legitimate zeros.
  return [
    `Item: ${formatItem(lineItem.item)}`,
    lineItem.itemCode ? `Item Code: ${lineItem.itemCode}` : null,
    lineItem.description ? `Description: ${lineItem.description}` : null,
    lineItem.quantity !== undefined ? `Quantity: ${lineItem.quantity}` : null,
    lineItem.unitAmount !== undefined
      ? `Unit Amount: ${lineItem.unitAmount}`
      : null,
    lineItem.accountCode ? `Account Code: ${lineItem.accountCode}` : null,
    lineItem.taxType ? `Tax Type: ${lineItem.taxType}` : null,
    `Tracking: ${formatTracking(lineItem.tracking)}`,
    lineItem.lineAmount !== undefined
      ? `Line Amount: ${lineItem.lineAmount}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
};
