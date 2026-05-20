import { randomUUID } from "node:crypto"

import type { ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

import type {
  ResponseObject,
  ResponseOutputFunctionCall,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseOutputText,
  ResponsesPayload,
  ResponseStreamEvent,
} from "./types"

/**
 * Mutable state tracked as we process the streaming chunks from Chat Completions
 * and translate them into Responses API stream events.
 */
export interface ResponseStreamState {
  responseId: string
  createdAt: number
  model: string

  /** Whether we've emitted `response.created` */
  started: boolean

  /** All output items accumulated so far */
  outputItems: Array<ResponseOutputItem>

  /** Index of the current message output item (if any) */
  currentMessageIndex: number | null
  currentMessageId: string | null

  /** Accumulated text for the current message */
  accumulatedText: string

  /** Tracked function calls by OpenAI tool_call index */
  functionCalls: Record<
    number,
    {
      outputIndex: number
      itemId: string
      callId: string
      name: string
      arguments: string
    }
  >

  /** Usage info from the final chunk */
  usage: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  } | null

  payload: ResponsesPayload
}

export function createStreamState(payload: ResponsesPayload): ResponseStreamState {
  return {
    responseId: `resp_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    createdAt: Math.floor(Date.now() / 1000),
    model: payload.model,
    started: false,
    outputItems: [],
    currentMessageIndex: null,
    currentMessageId: null,
    accumulatedText: "",
    functionCalls: {},
    usage: null,
    payload,
  }
}

/**
 * Translate a single Chat Completions streaming chunk into Responses API stream events.
 */
// eslint-disable-next-line complexity, max-lines-per-function
export function translateChunkToResponseEvents(
  chunk: ChatCompletionChunk,
  state: ResponseStreamState,
): Array<ResponseStreamEvent> {
  const events: Array<ResponseStreamEvent> = []

  // Track model from the chunk
  if (chunk.model) {
    state.model = chunk.model
  }

  // Track usage
  if (chunk.usage) {
    state.usage = {
      input_tokens: chunk.usage.prompt_tokens,
      output_tokens: chunk.usage.completion_tokens,
      total_tokens: chunk.usage.total_tokens,
    }
  }

  // Emit response.created and response.in_progress on first chunk
  if (!state.started) {
    state.createdAt = chunk.created
    const responseObj = buildInProgressResponse(state)
    events.push({ type: "response.created", response: responseObj })
    events.push({ type: "response.in_progress", response: responseObj })
    state.started = true
  }

  if (chunk.choices.length === 0) {
    return events
  }

  const choice = chunk.choices[0]
  const { delta } = choice

  // ─── Text Content ───
  if (delta.content) {
    // Start a new message output item if we haven't yet
    if (state.currentMessageIndex === null) {
      const msgId = `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`
      const outputIndex = state.outputItems.length
      const msgItem: ResponseOutputMessage = {
        type: "message",
        id: msgId,
        role: "assistant",
        status: "in_progress",
        content: [],
      }
      state.outputItems.push(msgItem)
      state.currentMessageIndex = outputIndex
      state.currentMessageId = msgId

      // Emit output_item.added
      events.push({
        type: "response.output_item.added",
        output_index: outputIndex,
        item: msgItem,
      })

      // Emit content_part.added
      const emptyTextPart: ResponseOutputText = {
        type: "output_text",
        text: "",
        annotations: [],
      }
      events.push({
        type: "response.content_part.added",
        item_id: msgId,
        output_index: outputIndex,
        content_index: 0,
        part: emptyTextPart,
      })
    }

    state.accumulatedText += delta.content

    events.push({
      type: "response.output_text.delta",
      item_id: state.currentMessageId!,
      output_index: state.currentMessageIndex!,
      content_index: 0,
      delta: delta.content,
    })
  }

  // ─── Tool Calls ───
  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      const tcIndex = tc.index

      if (tc.id && tc.function?.name) {
        // New function call starting
        const itemId = `fc_${randomUUID().replace(/-/g, "").slice(0, 24)}`
        const outputIndex = state.outputItems.length
        const callId = tc.id

        state.functionCalls[tcIndex] = {
          outputIndex,
          itemId,
          callId,
          name: tc.function.name,
          arguments: "",
        }

        const fcItem: ResponseOutputFunctionCall = {
          type: "function_call",
          id: itemId,
          call_id: callId,
          name: tc.function.name,
          arguments: "",
          status: "in_progress",
        }
        state.outputItems.push(fcItem)

        events.push({
          type: "response.output_item.added",
          output_index: outputIndex,
          item: fcItem,
        })
      }

      // Argument delta
      if (tc.function?.arguments && state.functionCalls[tcIndex]) {
        const fcState = state.functionCalls[tcIndex]
        fcState.arguments += tc.function.arguments

        events.push({
          type: "response.function_call_arguments.delta",
          item_id: fcState.itemId,
          output_index: fcState.outputIndex,
          call_id: fcState.callId,
          delta: tc.function.arguments,
        })
      }
    }
  }

  // ─── Finish ───
  if (choice.finish_reason) {
    // Close text content
    if (state.currentMessageIndex !== null && state.currentMessageId) {
      const textPart: ResponseOutputText = {
        type: "output_text",
        text: state.accumulatedText,
        annotations: [],
      }

      events.push({
        type: "response.output_text.done",
        item_id: state.currentMessageId,
        output_index: state.currentMessageIndex,
        content_index: 0,
        text: state.accumulatedText,
      })

      events.push({
        type: "response.content_part.done",
        item_id: state.currentMessageId,
        output_index: state.currentMessageIndex,
        content_index: 0,
        part: textPart,
      })

      // Update the message item to completed
      const msgItem = state.outputItems[state.currentMessageIndex] as ResponseOutputMessage
      msgItem.status = "completed"
      msgItem.content = [textPart]

      events.push({
        type: "response.output_item.done",
        output_index: state.currentMessageIndex,
        item: msgItem,
      })
    }

    // Close function calls
    for (const [, fcState] of Object.entries(state.functionCalls)) {
      events.push({
        type: "response.function_call_arguments.done",
        item_id: fcState.itemId,
        output_index: fcState.outputIndex,
        call_id: fcState.callId,
        name: fcState.name,
        arguments: fcState.arguments,
      })

      const fcItem = state.outputItems[fcState.outputIndex] as ResponseOutputFunctionCall
      fcItem.status = "completed"
      fcItem.arguments = fcState.arguments

      events.push({
        type: "response.output_item.done",
        output_index: fcState.outputIndex,
        item: fcItem,
      })
    }

    // Emit response.completed
    const completedResponse = buildCompletedResponse(state)
    events.push({
      type: "response.completed",
      response: completedResponse,
    })
  }

  return events
}

function buildInProgressResponse(state: ResponseStreamState): ResponseObject {
  return {
    id: state.responseId,
    object: "response",
    created_at: state.createdAt,
    model: state.model,
    output: [],
    status: "in_progress",
    usage: null,
    temperature: state.payload.temperature,
    top_p: state.payload.top_p,
    max_output_tokens: state.payload.max_output_tokens,
    tool_choice: state.payload.tool_choice,
    tools: state.payload.tools,
    text: state.payload.text,
    metadata: state.payload.metadata,
    error: null,
  }
}

function buildCompletedResponse(state: ResponseStreamState): ResponseObject {
  return {
    id: state.responseId,
    object: "response",
    created_at: state.createdAt,
    model: state.model,
    output: state.outputItems,
    status: "completed",
    usage: state.usage
      ? {
          input_tokens: state.usage.input_tokens,
          output_tokens: state.usage.output_tokens,
          total_tokens: state.usage.total_tokens,
        }
      : null,
    temperature: state.payload.temperature,
    top_p: state.payload.top_p,
    max_output_tokens: state.payload.max_output_tokens,
    tool_choice: state.payload.tool_choice,
    tools: state.payload.tools,
    text: state.payload.text,
    metadata: state.payload.metadata,
    error: null,
  }
}
