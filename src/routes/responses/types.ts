// OpenAI Responses API types
// https://platform.openai.com/docs/api-reference/responses

// ─── Request Types ───

export interface ResponsesPayload {
  model: string
  input: ResponseInput
  instructions?: string | null
  tools?: Array<ResponseTool> | null
  tool_choice?: "auto" | "none" | "required" | ResponseToolChoice | null
  temperature?: number | null
  top_p?: number | null
  max_output_tokens?: number | null
  stream?: boolean | null
  metadata?: Record<string, string> | null
  parallel_tool_calls?: boolean | null
  previous_response_id?: string | null
  reasoning?: { effort?: "low" | "medium" | "high" } | null
  store?: boolean | null
  truncation?: "auto" | "disabled" | null
  user?: string | null
  text?: ResponseTextConfig | null
}

export interface ResponseTextConfig {
  format?:
    | { type: "text" }
    | { type: "json_object" }
    | { type: "json_schema"; json_schema: Record<string, unknown> }
    | null
}

export type ResponseInput = string | Array<ResponseInputItem>

export type ResponseInputItem =
  | ResponseInputMessageItem
  | ResponseInputFunctionCallItem
  | ResponseInputFunctionCallOutputItem
  | ResponseInputCompactionItem
  | ResponseInputItemReference

export interface ResponseInputMessageItem {
  type?: "message"
  role: "user" | "assistant" | "system" | "developer"
  content: string | Array<ResponseInputContentPart>
}

export type ResponseInputContentPart =
  | ResponseInputTextPart
  | ResponseInputImagePart

export interface ResponseInputTextPart {
  type: "input_text"
  text: string
}

export interface ResponseInputImagePart {
  type: "input_image"
  image_url?: string
  detail?: "low" | "high" | "auto"
}

export interface ResponseInputFunctionCallItem {
  type: "function_call"
  id?: string
  call_id: string
  name: string
  arguments: string
}

export interface ResponseInputFunctionCallOutputItem {
  type: "function_call_output"
  call_id: string
  output: string
}

export interface ResponseInputCompactionItem {
  type: "compaction" | "compaction_summary"
  encrypted_content: string
}

export interface ResponseInputItemReference {
  type: "item_reference"
  id: string
}

export interface ResponseTool {
  type: "function"
  name: string
  description?: string
  parameters?: Record<string, unknown>
  strict?: boolean
}

export interface ResponseToolChoice {
  type: "function"
  name: string
}

// ─── Response Types ───

export interface ResponseObject {
  id: string
  object: "response"
  created_at: number
  model: string
  output: Array<ResponseOutputItem>
  status: "completed" | "failed" | "in_progress" | "incomplete"
  usage: ResponseUsage | null
  metadata?: Record<string, string> | null
  temperature?: number | null
  top_p?: number | null
  max_output_tokens?: number | null
  truncation?: "auto" | "disabled" | null
  tool_choice?: "auto" | "none" | "required" | ResponseToolChoice | null
  tools?: Array<ResponseTool> | null
  text?: ResponseTextConfig | null
  error?: {
    code: string
    message: string
  } | null
}

export type ResponseOutputItem =
  | ResponseOutputMessage
  | ResponseOutputFunctionCall

export interface ResponseOutputMessage {
  type: "message"
  id: string
  role: "assistant"
  status: "completed" | "in_progress"
  content: Array<ResponseOutputContentPart>
}

export type ResponseOutputContentPart = ResponseOutputText

export interface ResponseOutputText {
  type: "output_text"
  text: string
  annotations?: Array<unknown>
}

export interface ResponseOutputFunctionCall {
  type: "function_call"
  id: string
  call_id: string
  name: string
  arguments: string
  status: "completed" | "in_progress"
}

export interface ResponseUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  input_tokens_details?: {
    cached_tokens?: number
  }
  output_tokens_details?: {
    reasoning_tokens?: number
  }
}

// ─── Streaming Event Types ───

export type ResponseStreamEvent =
  | ResponseCreatedEvent
  | ResponseInProgressEvent
  | ResponseCompletedEvent
  | ResponseOutputItemAddedEvent
  | ResponseOutputItemDoneEvent
  | ResponseContentPartAddedEvent
  | ResponseContentPartDoneEvent
  | ResponseOutputTextDeltaEvent
  | ResponseOutputTextDoneEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent

export interface ResponseCreatedEvent {
  type: "response.created"
  response: ResponseObject
}

export interface ResponseInProgressEvent {
  type: "response.in_progress"
  response: ResponseObject
}

export interface ResponseCompletedEvent {
  type: "response.completed"
  response: ResponseObject
}

export interface ResponseOutputItemAddedEvent {
  type: "response.output_item.added"
  output_index: number
  item: ResponseOutputItem
}

export interface ResponseOutputItemDoneEvent {
  type: "response.output_item.done"
  output_index: number
  item: ResponseOutputItem
}

export interface ResponseContentPartAddedEvent {
  type: "response.content_part.added"
  item_id: string
  output_index: number
  content_index: number
  part: ResponseOutputContentPart
}

export interface ResponseContentPartDoneEvent {
  type: "response.content_part.done"
  item_id: string
  output_index: number
  content_index: number
  part: ResponseOutputContentPart
}

export interface ResponseOutputTextDeltaEvent {
  type: "response.output_text.delta"
  item_id: string
  output_index: number
  content_index: number
  delta: string
}

export interface ResponseOutputTextDoneEvent {
  type: "response.output_text.done"
  item_id: string
  output_index: number
  content_index: number
  text: string
}

export interface ResponseFunctionCallArgumentsDeltaEvent {
  type: "response.function_call_arguments.delta"
  item_id: string
  output_index: number
  call_id: string
  delta: string
}

export interface ResponseFunctionCallArgumentsDoneEvent {
  type: "response.function_call_arguments.done"
  item_id: string
  output_index: number
  call_id: string
  name: string
  arguments: string
}
