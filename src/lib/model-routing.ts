import { HTTPError } from "./error"
import { state } from "./state"

/**
 * Check if a model should use the /responses endpoint instead of /chat/completions.
 * Models whose capabilities.type is not "chat" require the /responses endpoint
 * (e.g. gpt-5.4, o3, and other newer models).
 */
export function shouldUseResponsesEndpoint(modelId: string): boolean {
  if (isKnownResponsesOnlyModel(modelId)) return true

  const model = state.models?.data.find((m) => m.id === modelId)
  if (!model) return false

  return model.capabilities.type !== "chat"
}

function isKnownResponsesOnlyModel(modelId: string): boolean {
  return /^(gpt-5|o1|o3|o4)(-|\.|$)/i.test(modelId)
}

export async function shouldRetryWithResponses(error: unknown): Promise<boolean> {
  if (!(error instanceof HTTPError)) return false

  const errorText = await error.response.clone().text()
  return /unsupported_api_for_model|not accessible via the \/chat\/completions endpoint/i.test(
    errorText,
  )
}
