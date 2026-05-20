import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { Hono } from "hono"

export const playgroundRoute = new Hono()

let cachedHtml: string | null = null

playgroundRoute.get("/", async (c) => {
  try {
    if (!cachedHtml) {
      const htmlPath = join(process.cwd(), "public", "playground.html")
      cachedHtml = await readFile(htmlPath, "utf-8")
    }
    return c.html(cachedHtml)
  } catch {
    return c.text("Playground HTML not found. Place playground.html in public/", 404)
  }
})
