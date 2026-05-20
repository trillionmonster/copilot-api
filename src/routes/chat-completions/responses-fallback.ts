/**
 * Translation utilities for routing chat/completions requests through the /responses endpoint.
 * Used when a model (e.g. gpt-5.4) is only accessible via the Responses API.
 */

import type {
  ResponseInputContentPart,
  ResponseInputItem,
  ResponseObject,
  ResponsesPayload,
  ResponseStreamEvent,
  ResponseTool,
} from "~/routes/responses/types"
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Message,
  ToolCall,
} from "~/services/copilot/create-chat-completions"

// ─── Request Translation: ChatCompletions → Responses ───

function extractTextFromContent(
  content: string | Array<ContentPart> | null,
): string {
  if (typeof content === "string") return content
  if (!content) return ""
  return content.map((c) => (c.type === "text" ? c.text : "")).join("")
}

function translateContentToResponseFormat(
  content: string | Array<ContentPart> | null,
): string | Array<ResponseInputContentPart> {
  if (typeof content === "string") return content
  if (!content) return ""
  return content.map((c): ResponseInputContentPart => {
    if (c.type === "text") return { type: "input_text", text: c.text }
    return {
      type: "input_image",
      image_url: c.image_url.url,
      detail: c.image_url.detail,
    }
  })
}

function toResponseFunctionCallId(id: string): string {
  if (id.startsWith("fc_")) return id
  if (id.startsWith("fc")) return id
  return `fc_${id}`
}

function translateMessageToInputItems(msg: Message): Array<ResponseInputItem> {
  const items: Array<ResponseInputItem> = []

  switch (msg.role) {
    case "user": {
      items.push({
        type: "message",
        role: "user",
        content: translateContentToResponseFormat(msg.content),
      })

      break
    }
    case "assistant": {
      if (msg.content) {
        items.push({
          type: "message",
          role: "assistant",
          content: extractTextFromContent(msg.content),
        })
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          items.push({
            type: "function_call",
            id: toResponseFunctionCallId(tc.id),
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          })
        }
      }

      break
    }
    case "tool": {
      items.push({
        type: "function_call_output",
        call_id: msg.tool_call_id ?? "",
        output: extractTextFromContent(msg.content),
      })

      break
    }
    // No default
  }

  return items
}

function translateToolChoice(
  toolChoice: ChatCompletionsPayload["tool_choice"],
): ResponsesPayload["tool_choice"] {
  if (toolChoice === undefined || toolChoice === null) return undefined
  // { type: "function", function: { name: "..." } } → { type: "function", name: "..." }
  return typeof toolChoice === "string" ? toolChoice : (
      { type: "function", name: toolChoice.function.name }
    )
}

/**
 * Translate a Chat Completions payload into a Responses API payload.
 */
export function translateCompletionsPayloadToResponses(
  payload: ChatCompletionsPayload,
): ResponsesPayload {
  const input: Array<ResponseInputItem> = []
  let instructions: string | undefined

  for (const msg of payload.messages) {
    if (msg.role === "system" || msg.role === "developer") {
      const text = extractTextFromContent(msg.content)
      instructions = instructions ? `${instructions}\n${text}` : text
    } else {
      input.push(...translateMessageToInputItems(msg))
    }
  }

  const tools: Array<ResponseTool> | undefined = payload.tools?.map((t) => ({
    type: "function" as const,
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }))

  return {
    model: payload.model,
    input,
    instructions,
    max_output_tokens: payload.max_tokens,
    temperature: payload.temperature,
    top_p: payload.top_p,
    stream: payload.stream,
    tools: tools?.length ? tools : undefined,
    tool_choice: translateToolChoice(payload.tool_choice),
    user: payload.user,
    parallel_tool_calls: payload.parallel_tool_calls,
    text:
      payload.response_format ? { format: payload.response_format } : undefined,
  }
}

// ─── Response Translation: Responses → ChatCompletions (non-streaming) ───

/**
 * Translate a non-streaming Responses API response back to Chat Completions format.
 */
export function translateResponseToCompletions(
  response: ResponseObject,
): ChatCompletionResponse {
  let content: string | null = null
  const toolCalls: Array<ToolCall> = []

  for (const item of response.output) {
    if (item.type === "message") {
      content = item.content.map((c) => c.text).join("")
    } else {
      toolCalls.push({
        id: item.call_id,
        type: "function",
        function: {
          name: item.name,
          arguments: item.arguments,
        },
      })
    }
  }

  return {
    id: response.id,
    object: "chat.completion",
    created: response.created_at,
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        logprobs: null,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
      },
    ],
    usage:
      response.usage ?
        {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.total_tokens,
        }
      : undefined,
  }
}

// ─── Streaming Translation: Responses stream → ChatCompletions chunks ───

interface StreamTranslationState {
  model: string
  responseId: string
  created: number
  functionCalls: Record<
    number,
    { id: string; name: string; toolCallIndex: number }
  >
  nextToolCallIndex: number
}

function createStreamTranslationState(): StreamTranslationState {
  return {
    model: "",
    responseId: "",
    created: Math.floor(Date.now() / 1000),
    functionCalls: {},
    nextToolCallIndex: 0,
  }
}

interface ChunkOptions {
  delta: ChatCompletionChunk["choices"][0]["delta"]
  finishReason: ChatCompletionChunk["choices"][0]["finish_reason"]
  usage?: ChatCompletionChunk["usage"]
}

function buildChunk(
  st: StreamTranslationState,
  opts: ChunkOptions,
): ChatCompletionChunk {
  return {
    id: st.responseId,
    object: "chat.completion.chunk",
    created: st.created,
    model: st.model,
    choices: [
      {
        index: 0,
        delta: opts.delta,
        finish_reason: opts.finishReason,
        logprobs: null,
      },
    ],
    ...(opts.usage ? { usage: opts.usage } : {}),
  }
}

function handleStreamEvent(
  event: ResponseStreamEvent,
  st: StreamTranslationState,
): Array<{ data: string }> {
  switch (event.type) {
    case "response.created":
    case "response.in_progress": {
      st.model = event.response.model
      st.responseId = event.response.id
      st.created = event.response.created_at
      return []
    }

    case "response.output_text.delta": {
      return [
        {
          data: JSON.stringify(
            buildChunk(st, {
              delta: { content: event.delta },
              finishReason: null,
            }),
          ),
        },
      ]
    }

    case "response.output_item.added": {
      if (event.item.type !== "function_call") return []

      const tcIdx = st.nextToolCallIndex++
      st.functionCalls[event.output_index] = {
        id: event.item.call_id,
        name: event.item.name,
        toolCallIndex: tcIdx,
      }
      const delta = {
        tool_calls: [
          {
            index: tcIdx,
            id: event.item.call_id,
            type: "function" as const,
            function: { name: event.item.name, arguments: "" },
          },
        ],
      }
      return [
        { data: JSON.stringify(buildChunk(st, { delta, finishReason: null })) },
      ]
    }

    case "response.function_call_arguments.delta": {
      const fc = Object.values(st.functionCalls).find(
        (f) => f.id === event.call_id,
      )
      if (!fc) return []
      const delta = {
        tool_calls: [
          { index: fc.toolCallIndex, function: { arguments: event.delta } },
        ],
      }
      return [
        { data: JSON.stringify(buildChunk(st, { delta, finishReason: null })) },
      ]
    }

    case "response.completed": {
      const finishReason =
        Object.keys(st.functionCalls).length > 0 ? "tool_calls" : "stop"
      const usage =
        event.response.usage ?
          {
            prompt_tokens: event.response.usage.input_tokens,
            completion_tokens: event.response.usage.output_tokens,
            total_tokens: event.response.usage.total_tokens,
          }
        : undefined
      return [
        {
          data: JSON.stringify(
            buildChunk(st, { delta: {}, finishReason, usage }),
          ),
        },
        { data: "[DONE]" },
      ]
    }

    default: {
      return []
    }
  }
}

/**
 * Parse a Responses API SSE stream and yield Chat Completions SSE messages.
 */
export async function* translateResponseStreamToCompletionStream(
  responseStream: AsyncIterable<{ event?: string; data?: string }>,
): AsyncGenerator<{ event?: string; data: string }> {
  const st = createStreamTranslationState()

  for await (const rawEvent of responseStream) {
    if (!rawEvent.data || rawEvent.data === "[DONE]") {
      continue
    }

    let event: ResponseStreamEvent
    try {
      event = JSON.parse(rawEvent.data) as ResponseStreamEvent
    } catch {
      continue
    }

    for (const result of handleStreamEvent(event, st)) {
      yield result
    }
  }
}
