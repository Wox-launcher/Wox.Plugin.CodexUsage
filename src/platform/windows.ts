import { PlatformRuntime } from "./types"
import { createRuntimeSettings } from "./shared"

const DEFAULT_CODEX_EXECUTABLE = "codex"
const DEFAULT_SQLITE_EXECUTABLE = "sqlite3.exe"

export const windowsPlatformRuntime: PlatformRuntime = {
  getRuntimeSettings(requestTimeoutMs) {
    return createRuntimeSettings(DEFAULT_CODEX_EXECUTABLE, DEFAULT_SQLITE_EXECUTABLE, requestTimeoutMs)
  },

  getCodexLaunchSpecs(executable) {
    const candidates = getWindowsCodexCandidates(executable)

    return candidates.map(candidate => {
      return {
        command: candidate.command,
        args: ["app-server"],
        options: {
          stdio: ["pipe", "pipe", "pipe"],
          env: process.env,
          shell: candidate.useShell,
          windowsHide: true
        }
      }
    })
  },

  getSqliteExecutableCandidates(executable) {
    if (hasFileExtension(executable)) {
      return [executable]
    }

    return [executable + ".exe", executable]
  }
}

function getWindowsCodexCandidates(executable: string): Array<{ command: string; useShell: boolean }> {
  if (hasFileExtension(executable)) {
    return [
      {
        command: executable,
        useShell: shouldUseShell(executable)
      }
    ]
  }

  return [
    {
      command: executable + ".exe",
      useShell: false
    },
    {
      command: executable + ".cmd",
      useShell: true
    },
    {
      command: executable,
      useShell: true
    }
  ]
}

function shouldUseShell(command: string): boolean {
  return /\.(cmd|bat)$/i.test(command)
}

function hasFileExtension(command: string): boolean {
  return /\.[^\\/.]+$/i.test(command)
}
