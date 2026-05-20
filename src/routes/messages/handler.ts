import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import type { ResponseObject } from "~/routes/responses/types"

import { awaitApproval } from "~/lib/approval"
import {
  shouldRetryWithResponses,
  shouldUseResponsesEndpoint,
} from "~/lib/model-routing"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  translateCompletionsPayloadToResponses,
  translateResponseStreamToCompletionStream,
  translateResponseToCompletions,
} from "~/routes/chat-completions/responses-fallback"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"
import { createResponses } from "~/services/copilot/create-responses"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateChunkToAnthropicEvents } from "./stream-translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
  consola.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

  const openAIPayload = translateToOpenAI(anthropicPayload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  // Route through /responses endpoint for models that don't support /chat/completions
  if (shouldUseResponsesEndpoint(openAIPayload.model)) {
    consola.debug(
      `Model ${openAIPayload.model} requires /responses endpoint, translating request`,
    )
    return await handleViaResponses(c, openAIPayload, anthropicPayload)
  }

  let response: Awaited<ReturnType<typeof createChatCompletions>>
  try {
    response = await createChatCompletions(openAIPayload)
  } catch (error) {
    if (await shouldRetryWithResponses(error)) {
      consola.debug(
        `Model ${openAIPayload.model} rejected /chat/completions, retrying with /responses`,
      )
      return await handleViaResponses(c, openAIPayload, anthropicPayload)
    }

    throw error
  }

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const anthropicResponse = translateToAnthropic(response)
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
    return c.json(anthropicResponse)
  }

  consola.debug("Streaming response from Copilot")
  return streamSSE(c, async (stream) => {
    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      toolCalls: {},
    }

    for await (const rawEvent of response) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      const events = translateChunkToAnthropicEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Anthropic event:", JSON.stringify(event))
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }
  })
}

/**
 * Handle an Anthropic messages request by routing through the /responses endpoint.
 * Chain: Anthropic → ChatCompletions → Responses → (API) → Responses → ChatCompletions → Anthropic
 */
async function handleViaResponses(
  c: Context,
  openAIPayload: ReturnType<typeof translateToOpenAI>,
  _anthropicPayload: AnthropicMessagesPayload,
) {
  const responsesPayload = translateCompletionsPayloadToResponses(openAIPayload)
  consola.debug(
    "Translated Responses payload:",
    JSON.stringify(responsesPayload).slice(-400),
  )

  const response = await createResponses(responsesPayload)

  if (isResponseObject(response)) {
    consola.debug(
      "Non-streaming response from /responses:",
      JSON.stringify(response).slice(-400),
    )
    const completionsResponse = translateResponseToCompletions(response)
    const anthropicResponse = translateToAnthropic(completionsResponse)
    return c.json(anthropicResponse)
  }

  consola.debug("Streaming response from /responses (via Anthropic)")
  return streamSSE(c, async (stream) => {
    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      toolCalls: {},
    }

    // Convert responses stream → chat completion chunks → anthropic events
    for await (const sseChunk of translateResponseStreamToCompletionStream(
      response,
    )) {
      if (sseChunk.data === "[DONE]") {
        break
      }

      const chunk = JSON.parse(sseChunk.data) as ChatCompletionChunk
      const events = translateChunkToAnthropicEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Anthropic event:", JSON.stringify(event))
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

const isResponseObject = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponseObject => Object.hasOwn(response, "output")
