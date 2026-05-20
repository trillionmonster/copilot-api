import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import {
  shouldRetryWithResponses,
  shouldUseResponsesEndpoint,
} from "~/lib/model-routing"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { isNullish } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"
import { createResponses } from "~/services/copilot/create-responses"

import type { ResponseObject, ResponsesPayload } from "./types"

import { normalizeResponsesPayloadCompaction } from "./compaction"
import { translateResponsesPayloadToCompletions } from "./request-translation"
import { translateCompletionsToResponse } from "./response-translation"
import {
  createStreamState,
  translateChunkToResponseEvents,
} from "./stream-translation"

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  const originalPayload = await c.req.json<ResponsesPayload>()
  const payload = normalizeResponsesPayloadCompaction(originalPayload)
  consola.debug(
    "Responses API request payload:",
    JSON.stringify(payload).slice(-400),
  )

  if (payload !== originalPayload) {
    consola.debug("Expanded compaction items into summary messages before upstream call")
  }

  if (state.manualApprove) await awaitApproval()

  // Route directly to /responses endpoint for models that don't support /chat/completions
  if (shouldUseResponsesEndpoint(payload.model)) {
    consola.debug(
      `Model ${payload.model} requires /responses endpoint, calling directly`,
    )
    return await handleDirectResponses(c, payload)
  }

  const completionsPayload = translateResponsesPayloadToCompletions(payload)
  consola.debug(
    "Translated Chat Completions payload:",
    JSON.stringify(completionsPayload).slice(-400),
  )

  // Find the selected model and set max_tokens if not provided
  const selectedModel = state.models?.data.find(
    (model) => model.id === completionsPayload.model,
  )

  if (isNullish(completionsPayload.max_tokens)) {
    completionsPayload.max_tokens =
      selectedModel?.capabilities.limits.max_output_tokens
    consola.debug(
      "Set max_tokens to:",
      JSON.stringify(completionsPayload.max_tokens),
    )
  }

  let response: Awaited<ReturnType<typeof createChatCompletions>>
  try {
    response = await createChatCompletions(completionsPayload)
  } catch (error) {
    if (await shouldRetryWithResponses(error)) {
      consola.debug(
        `Model ${payload.model} rejected /chat/completions, retrying with /responses`,
      )
      return await handleDirectResponses(c, payload)
    }

    throw error
  }

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const responsesResult = translateCompletionsToResponse(response, payload)
    consola.debug(
      "Translated Responses API response:",
      JSON.stringify(responsesResult).slice(-400),
    )
    return c.json(responsesResult)
  }

  consola.debug("Streaming response from Copilot")
  return streamSSE(c, async (stream) => {
    const streamState = createStreamState(payload)

    for await (const rawEvent of response) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      const events = translateChunkToResponseEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Responses API event:", JSON.stringify(event))
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }
  })
}

/**
 * Handle a responses request by calling the /responses endpoint directly.
 * No translation needed since the payload is already in the correct format.
 */
async function handleDirectResponses(
  c: Context,
  originalPayload: ResponsesPayload,
) {
  // Set max_output_tokens from model limits if not provided
  const selectedModel = state.models?.data.find(
    (model) => model.id === originalPayload.model,
  )

  const payload: ResponsesPayload =
    isNullish(originalPayload.max_output_tokens) ?
      {
        ...originalPayload,
        max_output_tokens: selectedModel?.capabilities.limits.max_output_tokens,
      }
    : originalPayload

  consola.debug(
    "Set max_output_tokens to:",
    JSON.stringify(payload.max_output_tokens),
  )

  const response = await createResponses(payload)

  if (isResponseObject(response)) {
    consola.debug(
      "Non-streaming response from /responses:",
      JSON.stringify(response).slice(-400),
    )
    return c.json(response)
  }

  consola.debug("Streaming response from /responses")
  return streamSSE(c, async (stream) => {
    for await (const rawEvent of response) {
      consola.debug("Responses raw stream event:", JSON.stringify(rawEvent))
      if (!rawEvent.data || rawEvent.data === "[DONE]") {
        continue
      }

      let event: Record<string, unknown>
      try {
        event = JSON.parse(rawEvent.data) as Record<string, unknown>
      } catch {
        continue
      }

      await stream.writeSSE({
        event: event.type as string,
        data: JSON.stringify(event),
      })
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

const isResponseObject = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponseObject => Object.hasOwn(response, "output")
