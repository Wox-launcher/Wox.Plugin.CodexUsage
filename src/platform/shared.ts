import { homedir } from "os"
import { join } from "path"

import { RuntimeSettings } from "./types"

export function createRuntimeSettings(codexExecutable: string, sqliteExecutable: string, requestTimeoutMs: number): RuntimeSettings {
  return {
    codexExecutable: codexExecutable,
    codexHome: join(homedir(), ".codex"),
    sqliteExecutable: sqliteExecutable,
    requestTimeoutMs: requestTimeoutMs
  }
}
