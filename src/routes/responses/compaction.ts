import type {
  ResponseInput,
  ResponseInputCompactionItem,
  ResponseInputItem,
  ResponseInputMessageItem,
  ResponsesPayload,
} from "./types"

const LOCAL_COMPACTION_PREFIX = "local-summary-v1:"

export function normalizeResponsesPayloadCompaction(
  payload: ResponsesPayload,
): ResponsesPayload {
  const input = normalizeResponseInputCompaction(payload.input)
  if (input === payload.input) {
    return payload
  }

  return {
    ...payload,
    input,
  }
}

export function normalizeResponseInputCompaction(
  input: ResponseInput,
): ResponseInput {
  if (typeof input === "string") {
    return input
  }

  let changed = false
  const normalized: Array<ResponseInputItem> = []

  for (const item of input) {
    if (isCompactionItem(item)) {
      const summary = extractCompactionSummary(item.encrypted_content)
      if (summary) {
        changed = true
        normalized.push(createSummaryMessage(summary))
      } else {
        normalized.push(item)
      }
      continue
    }

    normalized.push(item)
  }

  return changed ? normalized : input
}

export function extractCompactionSummary(
  encryptedContent: unknown,
): string | null {
  if (typeof encryptedContent !== "string") {
    return null
  }

  const compacted = encryptedContent.trim()
  if (!compacted) {
    return null
  }

  if (compacted.startsWith(LOCAL_COMPACTION_PREFIX)) {
    const encoded = compacted.slice(LOCAL_COMPACTION_PREFIX.length)
    try {
      const summary = Buffer.from(encoded, "base64").toString("utf8").trim()
      return summary || null
    } catch {
      return null
    }
  }

  return looksLikePlaintextSummary(compacted) ? compacted : null
}

export function encodeLocalCompactionSummary(summary: string): string {
  return `${LOCAL_COMPACTION_PREFIX}${Buffer.from(summary, "utf8").toString("base64")}`
}

function createSummaryMessage(summary: string): ResponseInputMessageItem {
  return {
    type: "message",
    role: "user",
    content: [
      {
        type: "input_text",
        text: summary,
      },
    ],
  }
}

function isCompactionItem(
  item: ResponseInputItem,
): item is ResponseInputCompactionItem {
  return item.type === "compaction" || item.type === "compaction_summary"
}

function looksLikePlaintextSummary(value: string): boolean {
  return /\s/.test(value) || value.startsWith("- ") || value.includes("Conversation so far")
}