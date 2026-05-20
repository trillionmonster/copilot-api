import { randomUUID } from "node:crypto"

import type { ChatCompletionResponse } from "~/services/copilot/create-chat-completions"

import type {
  ResponseObject,
  ResponseOutputFunctionCall,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponsesPayload,
} from "./types"

/**
 * Translate a non-streaming Chat Completions response into an OpenAI Responses API response.
 */
export function translateCompletionsToResponse(
  response: ChatCompletionResponse,
  payload: ResponsesPayload,
): ResponseObject {
  const output: Array<ResponseOutputItem> = []

  const choice = response.choices[0]
  if (!choice) {
    return buildResponseObject(response, payload, output)
  }

  const { message } = choice

  // Text content → message output
  if (message.content) {
    const msgItem: ResponseOutputMessage = {
      type: "message",
      id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: message.content,
          annotations: [],
        },
      ],
    }
    output.push(msgItem)
  }

  // Tool calls → function_call outputs
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      const fcItem: ResponseOutputFunctionCall = {
        type: "function_call",
        id: `fc_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        call_id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
        status: "completed",
      }
      output.push(fcItem)
    }
  }

  return buildResponseObject(response, payload, output)
}

function buildResponseObject(
  response: ChatCompletionResponse,
  payload: ResponsesPayload,
  output: Array<ResponseOutputItem>,
): ResponseObject {
  return {
    id: `resp_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "response",
    created_at: response.created,
    model: response.model,
    output,
    status: "completed",
    usage: response.usage
      ? {
          input_tokens: response.usage.prompt_tokens,
          output_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
          input_tokens_details: response.usage.prompt_tokens_details
            ? { cached_tokens: response.usage.prompt_tokens_details.cached_tokens }
            : undefined,
        }
      : null,
    temperature: payload.temperature,
    top_p: payload.top_p,
    max_output_tokens: payload.max_output_tokens,
    tool_choice: payload.tool_choice,
    tools: payload.tools,
    text: payload.text,
    metadata: payload.metadata,
    error: null,
  }
}
