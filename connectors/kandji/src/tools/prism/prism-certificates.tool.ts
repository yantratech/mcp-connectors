import { makePrismTool } from "./_shared.js";

const PrismCertificatesTool = makePrismTool(
  "prism_certificates",
  "certificates",
  "Get installed certificate inventory across the fleet via Prism: subject, issuer, expiry, trust settings. Critical for PKI rotation and detecting stale or rogue trust anchors.",
);

export default PrismCertificatesTool;
