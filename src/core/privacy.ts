// Privacy filter: redact sensitive words from text

import type { AllMemConfig } from "./types";

/**
 * Redact sensitive words from text based on privacy config.
 * Applied before sending to LLM and before storing memories.
 */
export function redactSensitive(text: string, config: AllMemConfig): string {
  if (!config.privacy?.enabled || !config.privacy.sensitiveWords?.length) {
    return text;
  }

  let result = text;
  const replacement = config.privacy.replacement || "[***]";

  for (const word of config.privacy.sensitiveWords) {
    if (!word.trim()) continue;
    // Case-insensitive global replace
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), replacement);
  }

  return result;
}
