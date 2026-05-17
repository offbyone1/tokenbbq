import type { ClaudeUsageResponse, LocalUsageSummary } from "./types";

export interface UsageIssue {
  source: "claude" | "local";
  title: string;
  message: string;
  compactText: string | null;
  stale: boolean;
}

export const EMPTY_CLAUDE_USAGE: ClaudeUsageResponse = {
  five_hour: null,
  seven_day: null,
  extra_usage: null,
};

export function usageForRender(
  lastGood: ClaudeUsageResponse | null,
): ClaudeUsageResponse {
  return lastGood ?? EMPTY_CLAUDE_USAGE;
}

export function keepLastGoodOnClaudeFailure(
  lastGood: ClaudeUsageResponse | null,
): ClaudeUsageResponse | null {
  return lastGood;
}

export function keepLastGoodOnLocalFailure(
  lastGood: LocalUsageSummary | null,
): LocalUsageSummary | null {
  return lastGood;
}

export function formatOptionalUtilization(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}%`
    : "--";
}

export function hasUtilization(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function describeClaudeFailure(
  _error: unknown,
  _lastGood: ClaudeUsageResponse | null,
): UsageIssue | null {
  return null;
}

export function describeLocalFailure(
  error: unknown,
  lastGood: LocalUsageSummary | null,
): UsageIssue {
  return {
    source: "local",
    title: lastGood ? "Showing last local values" : "Local usage unavailable",
    message: normalizeErrorMessage(error),
    compactText: null,
    stale: lastGood !== null,
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = String(error || "").trim();
  return message || "Refresh failed.";
}
