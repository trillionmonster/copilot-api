import type {
  ChatCompletionsPayload,
  Message,
  Tool,
} from "~/services/copilot/create-chat-completions"

import type {
  ResponseInputContentPart,
  ResponseInputFunctionCallItem,
  ResponseInputFunctionCallOutputItem,
  ResponseInputItem,
  ResponseInputMessageItem,
  ResponsesPayload,
  ResponseTool,
  ResponseToolChoice,
} from "./types"

/**
 * Translate an OpenAI Responses API payload into a Chat Completions payload
 * so it can be forwarded to the Copilot backend.
 */
export function translateResponsesPayloadToCompletions(
  payload: ResponsesPayload,
): ChatCompletionsPayload {
  const messages = buildMessages(payload)

  return {
    model: payload.model,
    messages,
    max_tokens: payload.max_output_tokens ?? undefined,
    temperature: payload.temperature,
    top_p: payload.top_p,
    stream: payload.stream,
    tools: translateTools(payload.tools),
    tool_choice: translateToolChoice(payload.tool_choice),
    user: payload.user,
    parallel_tool_calls: payload.parallel_tool_calls,
    response_format: translateTextFormat(payload.text),
  }
}

// ─── Message Building ───

function buildMessages(payload: ResponsesPayload): Array<Message> {
  const messages: Array<Message> = []

  // Add instructions as a developer/system message
  if (payload.instructions) {
    messages.push({
      role: "developer",
      content: payload.instructions,
    })
  }

  // Convert input
  if (typeof payload.input === "string") {
    messages.push({ role: "user", content: payload.input })
  } else if (Array.isArray(payload.input)) {
    messages.push(...translateInputItems(payload.input))
  }

  return messages
}

function translateInputItems(items: Array<ResponseInputItem>): Array<Message> {
  const messages: Array<Message> = []

  // Track function_call items to group them into a single assistant message with tool_calls
  let pendingToolCalls: Array<ResponseInputFunctionCallItem> = []

  for (const item of items) {
    if (isMessageItem(item)) {
      // Flush any pending tool calls before a new message
      if (pendingToolCalls.length > 0) {
        messages.push(buildAssistantToolCallMessage(pendingToolCalls))
        pendingToolCalls = []
      }
      messages.push(translateMessageItem(item))
    } else if (isFunctionCallItem(item)) {
      pendingToolCalls.push(item)
    } else if (isFunctionCallOutputItem(item)) {
      // Flush pending tool calls before tool results
      if (pendingToolCalls.length > 0) {
        messages.push(buildAssistantToolCallMessage(pendingToolCalls))
        pendingToolCalls = []
      }
      messages.push({
        role: "tool",
        content: item.output,
        tool_call_id: item.call_id,
      })
    }
    // item_reference items are ignored (we don't support them)
  }

  // Flush remaining
  if (pendingToolCalls.length > 0) {
    messages.push(buildAssistantToolCallMessage(pendingToolCalls))
  }

  return messages
}

function buildAssistantToolCallMessage(
  calls: Array<ResponseInputFunctionCallItem>,
): Message {
  return {
    role: "assistant",
    content: null,
    tool_calls: calls.map((call) => ({
      id: call.call_id,
      type: "function" as const,
      function: {
        name: call.name,
        arguments: call.arguments,
      },
    })),
  }
}

function translateMessageItem(item: ResponseInputMessageItem): Message {
  const role = item.role === "system" ? "system" : item.role

  if (typeof item.content === "string") {
    return { role, content: item.content }
  }

  // Array content
  const contentParts = item.content.map(translateContentPart)
  // If all parts are text, collapse to a single string
  if (contentParts.every((p) => p.type === "text")) {
    return {
      role,
      content: contentParts.map((p) => (p as { text: string }).text).join(""),
    }
  }

  return { role, content: contentParts }
}

function translateContentPart(
  part: ResponseInputContentPart,
): { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } } {
  if (part.type === "input_text") {
    return { type: "text", text: part.text }
  }
  // input_image
  return {
    type: "image_url",
    image_url: {
      url: part.image_url ?? "",
      detail: part.detail,
    },
  }
}

// ─── Type Guards ───

function isMessageItem(
  item: ResponseInputItem,
): item is ResponseInputMessageItem {
  return (
    item.type === "message"
    || (!("type" in item) || item.type === undefined)
    && "role" in item
  )
}

function isFunctionCallItem(
  item: ResponseInputItem,
): item is ResponseInputFunctionCallItem {
  return item.type === "function_call"
}

function isFunctionCallOutputItem(
  item: ResponseInputItem,
): item is ResponseInputFunctionCallOutputItem {
  return item.type === "function_call_output"
}

// ─── Tool Translation ───

function translateTools(
  tools: Array<ResponseTool> | null | undefined,
): Array<Tool> | undefined {
  if (!tools || tools.length === 0) return undefined

  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? {},
      ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
    },
  }))
}

function translateToolChoice(
  choice: "auto" | "none" | "required" | ResponseToolChoice | null | undefined,
):
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } }
  | undefined {
  if (!choice) return undefined
  if (typeof choice === "string") return choice
  return {
    type: "function",
    function: { name: choice.name },
  }
}

function translateTextFormat(
  text: ResponsesPayload["text"],
): { type: "json_object" } | undefined {
  if (!text?.format) return undefined
  if (text.format.type === "json_object") {
    return { type: "json_object" }
  }
  return undefined
}
