import { expect, test } from "bun:test"

import {
  encodeLocalCompactionSummary,
  extractCompactionSummary,
  normalizeResponseInputCompaction,
} from "../src/routes/responses/compaction"

test("normalizeResponseInputCompaction converts compaction items into user summary messages", () => {
  const input = [
    {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "dev rules" }],
    },
    {
      type: "compaction",
      encrypted_content: encodeLocalCompactionSummary(
        "summary line one\nsummary line two",
      ),
    },
  ] as const

  const normalized = normalizeResponseInputCompaction([...input])

  expect(Array.isArray(normalized)).toBe(true)
  expect(normalized).toEqual([
    {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "dev rules" }],
    },
    {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: "summary line one\nsummary line two",
        },
      ],
    },
  ])
})

test("extractCompactionSummary trims empty content to null", () => {
  expect(extractCompactionSummary("  \n  ")).toBeNull()
  expect(extractCompactionSummary("  local summary text  ")).toBe(
    "local summary text",
  )
})

test("normalizeResponseInputCompaction preserves unknown encrypted compaction items", () => {
  const input = [
    {
      type: "compaction",
      encrypted_content: "ENCRYPTED_REMOTE_BLOB_WITHOUT_WHITESPACE",
    },
  ] as const

  const normalized = normalizeResponseInputCompaction([...input])

  expect(normalized).toEqual([...input])
})