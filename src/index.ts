import { Context, Plugin, PluginInitParams, PublicAPI, Query, Result, ResultAction, ResultTail } from "@wox-launcher/wox-plugin"

import { CachedCodexUsageProvider, CodexUsageSnapshot, RateLimitWindowInfo, UsageProvider } from "./codex-usage"

const ICON = {
  ImageType: "relative" as const,
  ImageData: "images/app.svg"
}

interface LocaleStrings {
  subtitleNoLiveData: string
  subtitleFallback: string
  subtitleResetIn: string
  windowPrimary: string
  windowSecondary: string
  summaryLine: string
  summaryWarnings: string
  timeUnknown: string
  timeSoon: string
  unitDayShort: string
  unitHourShort: string
  unitMinuteShort: string
  durationJoiner: string
}

const DEFAULT_LOCALE_STRINGS: LocaleStrings = {
  subtitleNoLiveData: "No live rate limit data",
  subtitleFallback: "fallback",
  subtitleResetIn: "%s reset in %s",
  windowPrimary: "5H",
  windowSecondary: "Week",
  summaryLine: "%s left %s, reset in %s",
  summaryWarnings: "Warnings: %s",
  timeUnknown: "unknown",
  timeSoon: "soon",
  unitDayShort: "d",
  unitHourShort: "h",
  unitMinuteShort: "m",
  durationJoiner: " "
}

export class CodexUsagePlugin implements Plugin {
  private api: PublicAPI | null = null
  private provider: UsageProvider

  constructor(provider?: UsageProvider) {
    this.provider = provider || new CachedCodexUsageProvider()
    this.init = this.init.bind(this)
    this.query = this.query.bind(this)
  }

  async init(ctx: Context, initParams: PluginInitParams): Promise<void> {
    this.api = initParams.API
    await this.provider.start(ctx, this.api)
    await safeLog(this.api, ctx, "Info", "Codex Usage plugin initialized")
  }

  async query(ctx: Context, query: Query): Promise<Result[]> {
    if (this.api === null) {
      throw new Error("Plugin has not been initialized")
    }

    const forceRefresh = shouldForceRefresh(query.Search)

    try {
      const snapshot = forceRefresh ? await this.provider.refresh(ctx, this.api) : await this.provider.getSnapshot(ctx, this.api)
      return await buildResults(snapshot, this.api, ctx, this.provider)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await safeLog(this.api, ctx, "Error", "Failed to read Codex usage: " + message)
      return [buildErrorResult(message, this.api, ctx, this.provider)]
    }
  }
}

export const plugin: Plugin = new CodexUsagePlugin()

export function shouldForceRefresh(search: string): boolean {
  const normalized = search.trim().toLowerCase()
  return normalized === "refresh" || normalized === "reload"
}

export async function buildResults(snapshot: CodexUsageSnapshot, api: PublicAPI, ctx: Context, provider: UsageProvider): Promise<Result[]> {
  const strings = await readLocaleStrings(api, ctx)
  const subtitle = buildOverviewSubtitle(snapshot, strings)
  const summaryText = buildSummaryText(snapshot, strings, subtitle)
  const rawText = JSON.stringify(snapshot, null, 2)
  const commonActions = buildCommonActions(summaryText, rawText, api, ctx, provider)

  return [
    {
      Id: "codex-usage-overview",
      Title: "i18n:result_title",
      SubTitle: subtitle,
      Icon: ICON,
      Score: 100,
      Tails: buildOverviewTails(snapshot, strings),
      Actions: commonActions
    }
  ]
}

function buildOverviewSubtitle(snapshot: CodexUsageSnapshot, strings: LocaleStrings): string {
  const parts: string[] = []

  if (snapshot.rateLimits !== null && snapshot.rateLimits.primary !== null) {
    parts.push(formatTemplate(strings.subtitleResetIn, strings.windowPrimary, formatRelativeReset(snapshot.rateLimits.primary, strings)))
  }

  if (snapshot.rateLimits !== null && snapshot.rateLimits.secondary !== null) {
    parts.push(formatTemplate(strings.subtitleResetIn, strings.windowSecondary, formatRelativeReset(snapshot.rateLimits.secondary, strings)))
  }

  if (parts.length === 0) {
    parts.push(strings.subtitleNoLiveData)
  }

  if (snapshot.warnings.length > 0) {
    parts.push(strings.subtitleFallback)
  }

  return parts.join(" | ")
}

function buildOverviewTails(snapshot: CodexUsageSnapshot, strings: LocaleStrings): ResultTail[] {
  return [
    buildProgressTail(strings.windowPrimary, snapshot.rateLimits !== null ? snapshot.rateLimits.primary : null),
    buildProgressTail(strings.windowSecondary, snapshot.rateLimits !== null ? snapshot.rateLimits.secondary : null)
  ]
}

function buildProgressTail(label: string, window: RateLimitWindowInfo | null): ResultTail {
  const remaining = getRemainingPercent(window)
  const svg = renderProgressSvg(label, remaining)

  return {
    Type: "image",
    Image: {
      ImageType: "svg",
      ImageData: svg
    },
    ImageWidth: 96,
    ImageHeight: 18
  }
}

function renderProgressSvg(label: string, remaining: number | null): string {
  const percentText = remaining === null ? "--" : String(remaining) + "%"
  const safeRemaining = remaining === null ? 0 : clamp(remaining, 0, 100)
  const fillColor = getProgressFillColor(remaining)
  const width = 96
  const radius = 9
  const fillWidth = Math.round(((width - 2) * safeRemaining) / 100)

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="18" viewBox="0 0 96 18">',
    '<rect x="0.5" y="0.5" width="95" height="17" rx="' + radius + '" fill="#ffffff" stroke="#687084"/>',
    '<rect x="1" y="1" width="' + fillWidth + '" height="16" rx="' + (radius - 1) + '" fill="' + fillColor + '"/>',
    '<text x="48" y="12.4" text-anchor="middle" font-family="Arial, sans-serif" font-size="9.5" fill="#1f2937">' + escapeXml(label + " " + percentText) + "</text>",
    "</svg>"
  ].join("")
}

function getProgressFillColor(remaining: number | null): string {
  if (remaining !== null && remaining < 10) {
    return "#d95c5c"
  }

  if (remaining !== null && remaining < 30) {
    return "#d8b24c"
  }

  return "#9bc27d"
}

function buildCommonActions(summaryText: string, rawText: string, api: PublicAPI, ctx: Context, provider: UsageProvider): ResultAction[] {
  return [
    {
      Id: "refresh",
      Name: "i18n:action_refresh",
      Icon: {
        ImageType: "svg",
        ImageData: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="#0c4cf0" d="M12 20q-3.35 0-5.675-2.325T4 12t2.325-5.675T12 4q1.725 0 3.3.712T18 6.75V4h2v7h-7V9h4.2q-.8-1.4-2.187-2.2T12 6Q9.5 6 7.75 7.75T6 12t1.75 4.25T12 18q1.925 0 3.475-1.1T17.65 14h2.1q-.7 2.65-2.85 4.325T12 20"/></svg>`
      },
      PreventHideAfterAction: true,
      Action: async actionCtx => {
        await safeLog(api, ctx, "Info", "Refreshing Codex usage")
        try {
          await provider.refresh(ctx, api)
        } catch (error) {
          await safeLog(api, ctx, "Warning", "Manual Codex usage refresh failed: " + (error instanceof Error ? error.message : String(error)))
        }
        if (typeof api.RefreshQuery === "function") {
          await api.RefreshQuery(actionCtx, {
            PreserveSelectedIndex: true
          })
        }
      }
    }
  ]
}

function buildErrorResult(message: string, api: PublicAPI, ctx: Context, provider: UsageProvider): Result {
  return {
    Id: "codex-usage-error",
    Title: "i18n:error_title",
    SubTitle: message,
    Icon: ICON,
    Score: 100,
    Actions: [
      {
        Id: "copy-error",
        Name: "i18n:action_copy_error",
        IsDefault: true,
        Action: async actionCtx => {
          await api.Copy(actionCtx, {
            type: "text",
            text: message
          })
        }
      },
      {
        Id: "refresh-error",
        Name: "i18n:action_retry",
        PreventHideAfterAction: true,
        Action: async actionCtx => {
          await safeLog(api, ctx, "Warning", "Retrying Codex usage fetch after error")
          try {
            await provider.refresh(ctx, api)
          } catch (error) {
            await safeLog(api, ctx, "Warning", "Codex usage retry failed: " + (error instanceof Error ? error.message : String(error)))
          }
          if (typeof api.RefreshQuery === "function") {
            await api.RefreshQuery(actionCtx, {
              PreserveSelectedIndex: false
            })
          }
        }
      }
    ]
  }
}

function buildSummaryText(snapshot: CodexUsageSnapshot, strings: LocaleStrings, subtitle: string): string {
  const lines: string[] = []

  lines.push("Codex Usage")
  lines.push(subtitle)

  if (snapshot.rateLimits !== null && snapshot.rateLimits.primary !== null) {
    lines.push(buildDetailedWindowLine(strings.windowPrimary, snapshot.rateLimits.primary, strings))
  }

  if (snapshot.rateLimits !== null && snapshot.rateLimits.secondary !== null) {
    lines.push(buildDetailedWindowLine(strings.windowSecondary, snapshot.rateLimits.secondary, strings))
  }

  if (snapshot.warnings.length > 0) {
    lines.push(formatTemplate(strings.summaryWarnings, snapshot.warnings.join(" | ")))
  }

  return lines.join("\n")
}

function buildDetailedWindowLine(label: string, window: RateLimitWindowInfo, strings: LocaleStrings): string {
  return formatTemplate(strings.summaryLine, label, formatRemainingPercent(window), formatRelativeReset(window, strings))
}

function formatRelativeReset(window: RateLimitWindowInfo | null, strings: LocaleStrings): string {
  if (window === null || window.resetsAt === null) {
    return strings.timeUnknown
  }

  const diffMs = window.resetsAt * 1000 - Date.now()
  if (diffMs <= 0) {
    return strings.timeSoon
  }

  const totalMinutes = Math.floor(diffMs / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []

  if (days > 0) {
    parts.push(String(days) + strings.unitDayShort)
  }

  if (hours > 0 && parts.length < 2) {
    parts.push(String(hours) + strings.unitHourShort)
  }

  if (minutes > 0 && parts.length < 2) {
    parts.push(String(minutes) + strings.unitMinuteShort)
  }

  if (parts.length === 0) {
    return strings.timeSoon
  }

  return parts.join(strings.durationJoiner)
}

function formatRemainingPercent(window: RateLimitWindowInfo | null): string {
  const remaining = getRemainingPercent(window)
  return remaining === null ? "--" : String(remaining) + "%"
}

function getRemainingPercent(window: RateLimitWindowInfo | null): number | null {
  if (window === null) {
    return null
  }

  return Math.max(0, 100 - window.usedPercent)
}

async function readLocaleStrings(api: PublicAPI, ctx: Context): Promise<LocaleStrings> {
  return {
    subtitleNoLiveData: await translate(api, ctx, "subtitle_no_live_data", DEFAULT_LOCALE_STRINGS.subtitleNoLiveData),
    subtitleFallback: await translate(api, ctx, "subtitle_fallback", DEFAULT_LOCALE_STRINGS.subtitleFallback),
    subtitleResetIn: await translate(api, ctx, "subtitle_reset_in", DEFAULT_LOCALE_STRINGS.subtitleResetIn),
    windowPrimary: await translate(api, ctx, "window_primary", DEFAULT_LOCALE_STRINGS.windowPrimary),
    windowSecondary: await translate(api, ctx, "window_secondary", DEFAULT_LOCALE_STRINGS.windowSecondary),
    summaryLine: await translate(api, ctx, "summary_line", DEFAULT_LOCALE_STRINGS.summaryLine),
    summaryWarnings: await translate(api, ctx, "summary_warnings", DEFAULT_LOCALE_STRINGS.summaryWarnings),
    timeUnknown: await translate(api, ctx, "time_unknown", DEFAULT_LOCALE_STRINGS.timeUnknown),
    timeSoon: await translate(api, ctx, "time_soon", DEFAULT_LOCALE_STRINGS.timeSoon),
    unitDayShort: await translate(api, ctx, "unit_day_short", DEFAULT_LOCALE_STRINGS.unitDayShort),
    unitHourShort: await translate(api, ctx, "unit_hour_short", DEFAULT_LOCALE_STRINGS.unitHourShort),
    unitMinuteShort: await translate(api, ctx, "unit_minute_short", DEFAULT_LOCALE_STRINGS.unitMinuteShort),
    durationJoiner: await translate(api, ctx, "duration_joiner", DEFAULT_LOCALE_STRINGS.durationJoiner)
  }
}

async function translate(api: PublicAPI, ctx: Context, key: string, fallback: string): Promise<string> {
  if (typeof api.GetTranslation !== "function") {
    return fallback
  }

  try {
    const value = await api.GetTranslation(ctx, key)
    if (typeof value === "string" && value.length > 0) {
      return value
    }
  } catch {
    return fallback
  }

  return fallback
}

function formatTemplate(template: string, ...values: string[]): string {
  let result = template

  for (let index = 0; index < values.length; index += 1) {
    result = result.replace("%s", values[index])
  }

  return result
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

async function safeLog(api: PublicAPI, ctx: Context, level: "Info" | "Warning" | "Error" | "Debug", message: string): Promise<void> {
  if (typeof api.Log !== "function") {
    return
  }

  try {
    await api.Log(ctx, level, message)
  } catch {
    return
  }
}
