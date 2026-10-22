export interface ArtifactSourceInput {
  fileBase64?: string;
  url?: string;
  ticketUrl?: string;
}

export function countArtifactSources(input: ArtifactSourceInput): number {
  return [input.fileBase64, input.url, input.ticketUrl].filter(
    (value) => value !== undefined && value !== "",
  ).length;
}

export function hasArtifactSource(input: ArtifactSourceInput): boolean {
  return countArtifactSources(input) > 0;
}

export function validateExactlyOneArtifactSource(
  input: ArtifactSourceInput,
): string | null {
  return countArtifactSources(input) === 1
    ? null
    : "Provide exactly one of fileBase64, url, or ticketUrl.";
}

export function validateArtifactMetadata(input: {
  fileBase64?: string;
  url?: string;
  ticketUrl?: string;
  ownerId?: number;
  filedAt?: string;
  renewalScheduleType?: string;
  renewalDate?: string;
}): string | null {
  if (!hasArtifactSource(input)) return null;
  if (input.ownerId === undefined) {
    return "ownerId is required when fileBase64, url, or ticketUrl is provided.";
  }
  if (!input.filedAt) {
    return "filedAt is required when fileBase64, url, or ticketUrl is provided.";
  }
  if (!input.renewalScheduleType) {
    return "renewalScheduleType is required when fileBase64, url, or ticketUrl is provided.";
  }
  if (input.renewalScheduleType === "CUSTOM" && !input.renewalDate) {
    return "renewalDate is required when renewalScheduleType is CUSTOM.";
  }
  if (input.renewalScheduleType !== "CUSTOM" && input.renewalDate) {
    return "renewalDate is only allowed when renewalScheduleType is CUSTOM.";
  }
  return null;
}
