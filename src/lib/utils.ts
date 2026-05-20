import { createHash } from "node:crypto"

import consola from "consola"

import { getModels } from "~/services/copilot/get-models"
import { getVSCodeVersion } from "~/services/get-vscode-version"

import { state } from "./state"

export const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const isNullish = (value: unknown): value is null | undefined =>
  value === null || value === undefined

export function sanitizeUserIdentifier(user?: string | null): string | undefined {
  if (!user) return undefined
  if (user.length <= 64) return user

  const hash = createHash("sha256").update(user).digest("hex").slice(0, 12)
  return `${user.slice(0, 51)}-${hash}`
}

export async function cacheModels(): Promise<void> {
  const models = await getModels()
  state.models = models
}

export const cacheVSCodeVersion = async () => {
  const response = await getVSCodeVersion()
  state.vsCodeVersion = response

  consola.info(`Using VSCode version: ${response}`)
}
