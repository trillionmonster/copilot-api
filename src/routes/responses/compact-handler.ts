import type { Context } from "hono"

import consola from "consola"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { state } from "~/lib/state"
import { createResponses } from "~/services/copilot/create-responses"

import {
  encodeLocalCompactionSummary,
  extractCompactionSummary,
} from "./compaction"
import type { ResponsesPayload } from "./types"

interface CompactPayload {
  model: string
  input?: Array<Record<string, unknown>>
  instructions?: string
  tools?: Array<Record<string, unknown>>
  parallel_tool_calls?: boolean
  reasoning?: ResponsesPayload["reasoning"]
  text?: ResponsesPayload["text"]
  [key: string]: unknown
}

interface CompactResponse {
  output: Array<Record<string, unknown>>
}

interface CompactMessageItem {
  type: "message"
  role: "user" | "developer"
  content: Array<Record<string, unknown>>
}

interface CompactionItem {
  type: "compaction"
  encrypted_content: string
}

export async function handleCompact(c: Context) {
  const payload = await c.req.json<CompactPayload>()
  consola.debug("Compact request payload:", JSON.stringify(payload).slice(-400))

  if (!state.copilotToken) throw new Error("Copilot token not found")

  // Try to forward to Copilot's /responses/compact endpoint
  const response = await fetch(`${copilotBaseUrl(state)}/responses/compact`, {
    method: "POST",
    headers: copilotHeaders(state),
    body: JSON.stringify(payload),
  })

  if (response.ok) {
    const result = (await response.json()) as CompactResponse
    consola.debug("Compact response:", JSON.stringify(result).slice(-400))
    return c.json(result)
  }

  consola.debug(
    `Copilot /responses/compact returned ${response.status}, using local compaction`,
  )

  const transcript = stringifyHistory(payload.input ?? [])
  if (!transcript) {
    return c.json({ output: [] })
  }

  const summaryResponse = await createResponses({
    model: payload.model,
    stream: false,
    store: false,
    reasoning: payload.reasoning,
    max_output_tokens: 900,
    text: { format: { type: "text" } },
    input: [
      {
        type: "message",
        role: "developer",
        content: [
          {
            type: "input_text",
            text: buildCompactionInstructions(payload.instructions),
          },
        ],
      },
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: transcript,
          },
        ],
      },
    ],
  })

  if (Symbol.asyncIterator in summaryResponse) {
    throw new Error("Unexpected streaming response for compaction")
  }

  const summary = extractOutputText(summaryResponse.output).trim()
  const preservedHistory = extractPreservedHistory(payload.input ?? [])
  const compactedOutput = buildCompactedOutput(preservedHistory, summary)

  consola.debug(
    "Local compact output:",
    JSON.stringify({ output: compactedOutput }).slice(-400),
  )

  return c.json({ output: compactedOutput })
}

function buildCompactionInstructions(originalInstructions?: string): string {
  const baseInstructions = [
    "You are compacting conversation history for a coding agent.",
    "Produce a dense continuation summary in plain text.",
    "Preserve: current user goal, constraints, files, code changes, tool results, errors, decisions, and next steps.",
    "Omit filler and repeated detail.",
    "Prefer short bullet points.",
    "Do not invent facts.",
  ].join(" ")

  return originalInstructions ? `${baseInstructions}\n\n${originalInstructions}` : baseInstructions
}

function stringifyHistory(items: Array<Record<string, unknown>>): string {
  const lines = items
    .map(stringifyHistoryItem)
    .filter((line): line is string => Boolean(line))

  if (lines.length === 0) {
    return ""
  }

  return ["Conversation history to compact:", ...lines].join("\n")
}

function stringifyHistoryItem(item: Record<string, unknown>): string | null {
  const type = typeof item.type === "string" ? item.type : "other"

  if (type === "message") {
    const role = typeof item.role === "string" ? item.role : "unknown"
    const text = stringifyContent(item.content)
    return text ? `${role}: ${text}` : null
  }

  if (type === "reasoning") {
    const summary = stringifyReasoning(item.summary)
    return summary ? `reasoning: ${summary}` : null
  }

  if (type === "function_call") {
    const name = typeof item.name === "string" ? item.name : "unknown"
    const args = typeof item.arguments === "string" ? item.arguments : ""
    return `function_call ${name}: ${args}`
  }

  if (
    type === "function_call_output"
    || type === "custom_tool_call_output"
    || type === "mcp_tool_call_output"
  ) {
    const output = stringifyOutput(item.output)
    return output ? `${type}: ${output}` : type
  }

  if (type === "custom_tool_call") {
    const name = typeof item.name === "string" ? item.name : "unknown"
    const args = typeof item.input === "string" ? item.input : ""
    return `custom_tool_call ${name}: ${args}`
  }

  if (type === "compaction" || type === "compaction_summary") {
    const summary = extractCompactionSummary(item.encrypted_content)
    return summary ? `prior_compaction_summary: ${summary}` : "prior_compaction_summary present"
  }

  return JSON.stringify(item)
}

function extractPreservedHistory(
  items: Array<Record<string, unknown>>,
): Array<CompactMessageItem> {
  return items.flatMap((item) => {
    if (item.type !== "message") {
      return []
    }

    const role = item.role
    if (role !== "user" && role !== "developer") {
      return []
    }

    if (!Array.isArray(item.content)) {
      return []
    }

    const content = item.content.filter(
      (part): part is Record<string, unknown> => Boolean(part) && typeof part === "object",
    )

    if (content.length === 0) {
      return []
    }

    return [
      {
        type: "message",
        role,
        content,
      },
    ]
  })
}

function buildCompactedOutput(
  preservedHistory: Array<CompactMessageItem>,
  summary: string,
): Array<CompactMessageItem | CompactionItem> {
  if (!summary) {
    return preservedHistory
  }

  return [
    ...preservedHistory,
    {
      type: "compaction",
      encrypted_content: encodeLocalCompactionSummary(summary),
    },
  ]
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return ""
      }

      const record = part as Record<string, unknown>
      if (typeof record.text === "string") {
        return record.text
      }
      if (record.type === "input_image") {
        return "[image]"
      }
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function stringifyReasoning(summary: unknown): string {
  if (!Array.isArray(summary)) {
    return ""
  }

  return summary
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return ""
      }
      const record = entry as Record<string, unknown>
      return typeof record.text === "string" ? record.text : ""
    })
    .filter(Boolean)
    .join("\n")
}

function stringifyOutput(output: unknown): string {
  if (typeof output === "string") {
    return output
  }

  if (Array.isArray(output)) {
    return output
      .map((part) => {
        if (!part || typeof part !== "object") {
          return ""
        }
        const record = part as Record<string, unknown>
        return typeof record.text === "string" ? record.text : ""
      })
      .filter(Boolean)
      .join("\n")
  }

  if (output && typeof output === "object") {
    return JSON.stringify(output)
  }

  return ""
}

function extractOutputText(output: Array<Record<string, unknown>>): string {
  return output
    .flatMap((item) => {
      if (item.type !== "message" || !Array.isArray(item.content)) {
        return []
      }

      return item.content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return ""
          }

          const record = part as Record<string, unknown>
          return typeof record.text === "string" ? record.text : ""
        })
        .filter(Boolean)
    })
    .join("\n")
}
