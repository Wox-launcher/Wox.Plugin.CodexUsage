import { PlatformRuntime } from "./types"
import { unixPlatformRuntime } from "./unix"
import { windowsPlatformRuntime } from "./windows"

export function getPlatformRuntime(): PlatformRuntime {
  return process.platform === "win32" ? windowsPlatformRuntime : unixPlatformRuntime
}
