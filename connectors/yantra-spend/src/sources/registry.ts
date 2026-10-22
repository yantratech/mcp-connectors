import { Source } from "../types/cost-line.js";
import { SourceModule } from "./source-module.js";
import { AwsSource } from "./aws.source.js";
import { GcpSource } from "./gcp.source.js";
import { AzureSource } from "./azure.source.js";
import { AnthropicSource } from "./anthropic.source.js";
import { OpenAiSource } from "./openai.source.js";
import { CursorSource } from "./cursor.source.js";

let registry: ReadonlyArray<SourceModule> | null = null;

export function allSources(): ReadonlyArray<SourceModule> {
  if (registry === null) {
    registry = [
      new AwsSource(),
      new GcpSource(),
      new AzureSource(),
      new AnthropicSource(),
      new OpenAiSource(),
      new CursorSource(),
    ];
  }
  return registry;
}

export function findSource(name: Source): SourceModule | undefined {
  return allSources().find((source) => source.name === name);
}

/**
 * Replace the registry — tests only. Pass null to restore the default set on
 * next `allSources()` call.
 */
export function _setRegistryForTests(
  override: ReadonlyArray<SourceModule> | null,
): void {
  registry = override;
}
