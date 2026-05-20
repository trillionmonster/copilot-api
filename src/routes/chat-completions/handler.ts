import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import type { ResponseObject } from "~/routes/responses/types"

import { awaitApproval } from "~/lib/approval"
import {
  shouldRetryWithResponses,
  shouldUseResponsesEndpoint,
} from "~/lib/model-routing"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { isNullish } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"
import { createResponses } from "~/services/copilot/create-responses"

import {
  translateCompletionsPayloadToResponses,
  translateResponseStreamToCompletionStream,
  translateResponseToCompletions,
} from "./responses-fallback"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<ChatCompletionsPayload>()
  consola.debug("Request payload:", JSON.stringify(payload).slice(-400))

  // Find the selected model
  const selectedModel = state.models?.data.find(
    (model) => model.id === payload.model,
  )

  // Calculate and display token count
  try {
    if (selectedModel) {
      const tokenCount = await getTokenCount(payload, selectedModel)
      consola.info("Current token count:", tokenCount)
    } else {
      consola.warn("No model selected, skipping token count calculation")
    }
  } catch (error) {
    consola.warn("Failed to calculate token count:", error)
  }

  if (state.manualApprove) await awaitApproval()

  if (isNullish(payload.max_tokens)) {
    payload = {
      ...payload,
      max_tokens: selectedModel?.capabilities.limits.max_output_tokens,
    }
    consola.debug("Set max_tokens to:", JSON.stringify(payload.max_tokens))
  }

  // Route to /responses endpoint for models that don't support /chat/completions
  if (shouldUseResponsesEndpoint(payload.model)) {
    consola.debug(
      `Model ${payload.model} requires /responses endpoint, translating request`,
    )
    return await handleViaResponses(c, payload)
  }

  let response: Awaited<ReturnType<typeof createChatCompletions>>
  try {
    response = await createChatCompletions(payload)
  } catch (error) {
    if (await shouldRetryWithResponses(error)) {
      consola.debug(
        `Model ${payload.model} rejected /chat/completions, retrying with /responses`,
      )
      return await handleViaResponses(c, payload)
    }

    throw error
  }

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming response:", JSON.stringify(response))
    return c.json(response)
  }

  consola.debug("Streaming response")
  return streamSSE(c, async (stream) => {
    for await (const chunk of response) {
      consola.debug("Streaming chunk:", JSON.stringify(chunk))
      await stream.writeSSE(chunk as SSEMessage)
    }
  })
}

/**
 * Handle a chat/completions request by routing through the /responses endpoint.
 * Translates the payload to Responses format, calls the endpoint, and translates back.
 */
async function handleViaResponses(c: Context, payload: ChatCompletionsPayload) {
  const responsesPayload = translateCompletionsPayloadToResponses(payload)
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
    return c.json(completionsResponse)
  }

  consola.debug("Streaming response from /responses")
  return streamSSE(c, async (stream) => {
    for await (const chunk of translateResponseStreamToCompletionStream(
      response,
    )) {
      consola.debug(
        "Translated streaming chunk:",
        JSON.stringify(chunk).slice(-400),
      )
      await stream.writeSSE(chunk as SSEMessage)
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

const isResponseObject = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponseObject => Object.hasOwn(response, "output")
