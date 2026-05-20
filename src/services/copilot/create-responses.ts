import consola from "consola"
import { events } from "fetch-event-stream"

import type { ResponseObject, ResponsesPayload } from "~/routes/responses/types"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import { sanitizeUserIdentifier } from "~/lib/utils"

export type ResponsesStreamEvent = {
  event?: string
  data?: string
  id?: string
}

export const createResponses = async (
  payload: ResponsesPayload,
): Promise<ResponseObject | AsyncIterable<ResponsesStreamEvent>> => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const normalizedPayload = {
    ...payload,
    user: sanitizeUserIdentifier(payload.user),
  }

  const headers: Record<string, string> = {
    ...copilotHeaders(state),
  }

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(normalizedPayload),
  })

  if (!response.ok) {
    consola.error("Failed to create responses", response)
    throw new HTTPError("Failed to create responses", response)
  }

  if (normalizedPayload.stream) {
    return events(response)
  }

  return (await response.json()) as ResponseObject
}
