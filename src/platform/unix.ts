import { PlatformRuntime } from "./types"
import { createRuntimeSettings } from "./shared"

const DEFAULT_CODEX_EXECUTABLE = "codex"
const DEFAULT_SQLITE_EXECUTABLE = "sqlite3"

export const unixPlatformRuntime: PlatformRuntime = {
  getRuntimeSettings(requestTimeoutMs) {
    return createRuntimeSettings(DEFAULT_CODEX_EXECUTABLE, DEFAULT_SQLITE_EXECUTABLE, requestTimeoutMs)
  },

  getCodexLaunchSpecs(executable) {
    return [
      {
        command: executable,
        args: ["app-server"],
        options: {
          stdio: ["pipe", "pipe", "pipe"],
          env: process.env
        }
      }
    ]
  },

  getSqliteExecutableCandidates(executable) {
    return [executable]
  }
}
