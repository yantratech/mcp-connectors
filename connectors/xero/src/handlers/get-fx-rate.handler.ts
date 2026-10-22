import axios from "axios";

interface FxRateInput {
  from: string;
  to: string;
  date: string;
}

interface FxRateResult {
  from: string;
  to: string;
  rate: number;
  date: string;
  source: string;
}

interface FxRateResponse {
  result: FxRateResult | null;
  isError: boolean;
  error: string | null;
}

// date is interpolated into the request path on two fixed CDN hosts and
// from/to into the query string, so validate their format before building any
// URL to prevent path/query injection (e.g. '../', '?', '#', '@version').
const DATE_RE = /^(\d{4}-\d{2}-\d{2}|latest)$/;
const CURRENCY_RE = /^[A-Za-z]{3}$/;

function validateFxInput({ from, to, date }: FxRateInput): void {
  if (!DATE_RE.test(date)) {
    throw new Error(
      `Invalid date '${date}'. Use YYYY-MM-DD or 'latest'.`,
    );
  }
  if (!CURRENCY_RE.test(from)) {
    throw new Error(
      `Invalid source currency '${from}'. Use a 3-letter ISO code (e.g. 'GBP').`,
    );
  }
  if (!CURRENCY_RE.test(to)) {
    throw new Error(
      `Invalid target currency '${to}'. Use a 3-letter ISO code (e.g. 'USD').`,
    );
  }
}

/**
 * Primary: frankfurter.app (ECB reference rates, free, no key)
 */
async function fetchFromFrankfurter(
  from: string,
  to: string,
  date: string,
): Promise<FxRateResult> {
  const url = `https://api.frankfurter.app/${date}?from=${from}&to=${to}`;
  const response = await axios.get(url, { timeout: 10000 });
  const data = response.data;

  const rate = data.rates?.[to];
  if (rate === undefined) {
    throw new Error(`Rate for ${to} not found in frankfurter response`);
  }

  return {
    from: data.base,
    to,
    rate,
    date: data.date,
    source: "ECB via frankfurter.app",
  };
}

/**
 * Fallback: fawazahmed0/currency-api via jsDelivr CDN
 */
async function fetchFromFawazahmed(
  from: string,
  to: string,
  date: string,
): Promise<FxRateResult> {
  const fromLower = from.toLowerCase();
  const toLower = to.toLowerCase();
  const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/${fromLower}.json`;
  const response = await axios.get(url, { timeout: 10000 });
  const data = response.data;

  const rate = data[fromLower]?.[toLower];
  if (rate === undefined) {
    throw new Error(`Rate for ${toLower} not found in fawazahmed0 response`);
  }

  return {
    from: from.toUpperCase(),
    to: to.toUpperCase(),
    rate,
    date: data.date,
    source: "fawazahmed0/currency-api (CDN)",
  };
}

export async function getFxRate(input: FxRateInput): Promise<FxRateResponse> {
  const from = input.from.toUpperCase();
  const to = input.to.toUpperCase();
  const { date } = input;

  try {
    validateFxInput({ from, to, date });
  } catch (validationError) {
    return {
      result: null,
      isError: true,
      error:
        validationError instanceof Error
          ? validationError.message
          : String(validationError),
    };
  }

  // Primary: frankfurter.app
  try {
    const result = await fetchFromFrankfurter(from, to, date);
    return { result, isError: false, error: null };
  } catch (primaryError) {
    console.error(
      "[get_fx_rate] frankfurter failed, trying fallback:",
      primaryError instanceof Error ? primaryError.message : primaryError,
    );
  }

  // Fallback: fawazahmed0
  try {
    const result = await fetchFromFawazahmed(from, to, date);
    return { result, isError: false, error: null };
  } catch (fallbackError) {
    const msg =
      fallbackError instanceof Error
        ? fallbackError.message
        : String(fallbackError);
    return {
      result: null,
      isError: true,
      error: `Both FX rate sources failed. Last error: ${msg}`,
    };
  }
}
