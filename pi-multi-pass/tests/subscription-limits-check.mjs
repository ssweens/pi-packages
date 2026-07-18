import assert from "node:assert/strict";

function normalizeCodexUsageWindow(window) {
  if (!window || typeof window !== "object" || Array.isArray(window)) return undefined;
  return {
    usedPercent: typeof window.used_percent === "number" ? window.used_percent : 0,
    windowSeconds: typeof window.limit_window_seconds === "number" ? window.limit_window_seconds : 0,
    resetAt: typeof window.reset_at === "number" ? window.reset_at : undefined,
  };
}

function matchesUsageWindow(window, expectedSeconds) {
  if (!window) return false;
  return Math.abs(window.windowSeconds - expectedSeconds) <= 120;
}

function parseCodexUsageSnapshot(data) {
  const rateLimit = data?.rate_limit || {};
  const windows = [
    normalizeCodexUsageWindow(rateLimit.primary_window),
    normalizeCodexUsageWindow(rateLimit.secondary_window),
  ].filter(Boolean);
  return {
    planType: typeof data?.plan_type === "string" ? data.plan_type : "unknown",
    email: typeof data?.email === "string" ? data.email : "",
    fiveHour: windows.find((window) => matchesUsageWindow(window, 5 * 60 * 60)),
    weekly: windows.find((window) => matchesUsageWindow(window, 7 * 24 * 60 * 60)),
  };
}

function getCodexWindowRemaining(window) {
  if (!window) return undefined;
  return Math.max(0, Math.min(100, 100 - window.usedPercent));
}

function classifyCodexQuotaKind(snapshot) {
  const values = [getCodexWindowRemaining(snapshot.fiveHour), getCodexWindowRemaining(snapshot.weekly)]
    .filter((value) => value !== undefined);
  if (values.length === 0) return { kind: "error", score: 0 };
  const bottleneck = Math.min(...values);
  if (bottleneck <= 5) return { kind: "blocked", score: bottleneck };
  if (bottleneck <= 15) return { kind: "low", score: bottleneck };
  if (bottleneck <= 30) return { kind: "watch", score: bottleneck };
  return { kind: "ready", score: bottleneck };
}

function normalizeGoogleRemainingPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function parseIsoTimestampSeconds(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.floor(parsed / 1000);
}

function updateGoogleQuotaModel(modelsByName, model, remainingPercent, resetAt) {
  const existing = modelsByName.get(model);
  if (!existing) {
    modelsByName.set(model, { model, remainingPercent, resetAt });
    return;
  }

  let next = existing;
  if (remainingPercent !== undefined) {
    if (existing.remainingPercent === undefined || remainingPercent < existing.remainingPercent) {
      next = { ...next, remainingPercent };
    }
  }
  if (resetAt !== undefined) {
    if (next.resetAt === undefined || resetAt < next.resetAt) {
      next = { ...next, resetAt };
    }
  }
  if (next !== existing) {
    modelsByName.set(model, next);
  }
}

function buildGoogleQuotaSnapshot(endpoint, projectId, modelsByName) {
  const models = [...modelsByName.values()];
  const remainingPercents = models
    .map((model) => model.remainingPercent)
    .filter((value) => value !== undefined);
  const worstRemainingPercent = remainingPercents.length > 0
    ? Math.min(...remainingPercents)
    : undefined;

  return { endpoint, projectId, models, worstRemainingPercent };
}

function getGoogleGeminiModelLabel(modelId) {
  if (!modelId) return "unknown";
  const normalized = modelId.toLowerCase();
  if (normalized.includes("pro")) return "Pro";
  if (normalized.includes("flash")) return "Flash";
  return modelId;
}

function parseGoogleGeminiQuotaSnapshot(data, projectId) {
  const buckets = Array.isArray(data?.buckets) ? data.buckets : [];
  const modelsByName = new Map();

  for (const bucket of buckets) {
    const model = getGoogleGeminiModelLabel(typeof bucket?.modelId === "string" ? bucket.modelId : undefined);
    const remainingPercent = normalizeGoogleRemainingPercent(bucket?.remainingFraction);
    const resetAt = typeof bucket?.resetTime === "string"
      ? parseIsoTimestampSeconds(bucket.resetTime)
      : undefined;
    if (remainingPercent === undefined && resetAt === undefined) continue;
    updateGoogleQuotaModel(modelsByName, model, remainingPercent, resetAt);
  }

  return buildGoogleQuotaSnapshot(
    "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
    projectId,
    modelsByName,
  );
}

const GOOGLE_ANTIGRAVITY_HIDDEN_MODELS = new Set(["tab_flash_lite_preview"]);

function parseGoogleAntigravityQuotaSnapshot(data, endpoint, projectId) {
  const rawModels = data?.models && typeof data.models === "object" ? data.models : {};
  const modelsByName = new Map();

  for (const [modelKey, modelValue] of Object.entries(rawModels)) {
    if (modelValue?.isInternal === true) continue;
    if (GOOGLE_ANTIGRAVITY_HIDDEN_MODELS.has(modelKey.toLowerCase())) continue;

    const displayName = typeof modelValue?.displayName === "string" && modelValue.displayName.length > 0
      ? modelValue.displayName
      : typeof modelValue?.model === "string" && modelValue.model.length > 0
        ? modelValue.model
        : modelKey;

    if (GOOGLE_ANTIGRAVITY_HIDDEN_MODELS.has(displayName.toLowerCase())) continue;

    const quotaInfo = modelValue?.quotaInfo || {};
    const remainingPercent = normalizeGoogleRemainingPercent(quotaInfo.remainingFraction);
    const resetAt = typeof quotaInfo.resetTime === "string"
      ? parseIsoTimestampSeconds(quotaInfo.resetTime)
      : undefined;
    if (remainingPercent === undefined && resetAt === undefined) continue;
    updateGoogleQuotaModel(modelsByName, displayName, remainingPercent, resetAt);
  }

  return buildGoogleQuotaSnapshot(endpoint, projectId, modelsByName);
}

function classifyGoogleQuotaKind(snapshot) {
  const bottleneck = snapshot.worstRemainingPercent;
  if (bottleneck === undefined) return { kind: "error", score: 0 };
  if (bottleneck <= 5) return { kind: "blocked", score: bottleneck };
  if (bottleneck <= 15) return { kind: "low", score: bottleneck };
  if (bottleneck <= 30) return { kind: "watch", score: bottleneck };
  return { kind: "ready", score: bottleneck };
}

function subDisplayName(entry) {
  const providerNames = {
    "openai-codex": "ChatGPT Plus/Pro (Codex)",
    anthropic: "Anthropic (Claude Pro/Max)",
  };
  const providerName = `${providerNames[entry.provider] || entry.provider} #${entry.index}`;
  if (!entry.label) return providerName;
  return `${entry.label} — ${providerName}`;
}

function runWindowClassificationChecks() {
  const resetAt = Math.floor(Date.now() / 1000) + 3600;
  const snapshot = parseCodexUsageSnapshot({
    plan_type: "pro",
    email: "test@example.com",
    rate_limit: {
      // Intentionally reversed from the human-friendly order.
      primary_window: {
        used_percent: 35,
        limit_window_seconds: 7 * 24 * 60 * 60,
        reset_at: resetAt + 6 * 24 * 60 * 60,
      },
      secondary_window: {
        used_percent: 10,
        limit_window_seconds: 5 * 60 * 60,
        reset_at: resetAt,
      },
    },
  });

  assert.equal(snapshot.planType, "pro");
  assert.equal(snapshot.email, "test@example.com");
  assert.equal(snapshot.fiveHour.windowSeconds, 5 * 60 * 60);
  assert.equal(snapshot.weekly.windowSeconds, 7 * 24 * 60 * 60);
  assert.equal(getCodexWindowRemaining(snapshot.fiveHour), 90);
  assert.equal(getCodexWindowRemaining(snapshot.weekly), 65);
}

function runSeverityChecks() {
  assert.equal(
    classifyCodexQuotaKind({ fiveHour: { usedPercent: 20 }, weekly: { usedPercent: 40 } }).kind,
    "ready",
  );
  assert.equal(
    classifyCodexQuotaKind({ fiveHour: { usedPercent: 75 }, weekly: { usedPercent: 20 } }).kind,
    "watch",
  );
  assert.equal(
    classifyCodexQuotaKind({ fiveHour: { usedPercent: 88 }, weekly: { usedPercent: 15 } }).kind,
    "low",
  );
  assert.equal(
    classifyCodexQuotaKind({ fiveHour: { usedPercent: 97 }, weekly: { usedPercent: 10 } }).kind,
    "blocked",
  );
  assert.equal(classifyCodexQuotaKind({}).kind, "error");
}

function runGoogleGeminiQuotaParsingChecks() {
  const snapshot = parseGoogleGeminiQuotaSnapshot({
    buckets: [
      {
        modelId: "Gemini 2.5 Pro",
        remainingFraction: 0.82,
        resetTime: "2026-03-21T12:00:00Z",
      },
      {
        modelId: "Gemini 2.5 Flash",
        remainingFraction: 0.25,
        resetTime: "2026-03-20T18:30:00Z",
      },
      {
        modelId: "Gemini 2.5 Pro",
        remainingFraction: 0.61,
      },
    ],
  }, "project-123");

  assert.equal(snapshot.projectId, "project-123");
  assert.equal(snapshot.endpoint, "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota");
  assert.equal(snapshot.models.length, 2);
  assert.equal(snapshot.models.find((model) => model.model === "Pro")?.remainingPercent, 61);
  assert.equal(snapshot.models.find((model) => model.model === "Flash")?.remainingPercent, 25);
  assert.ok(snapshot.models.find((model) => model.model === "Pro")?.resetAt > 0);
  assert.equal(snapshot.worstRemainingPercent, 25);
}

function runGoogleAntigravityQuotaParsingChecks() {
  const snapshot = parseGoogleAntigravityQuotaSnapshot({
    models: {
      "gemini-3-pro-high": {
        displayName: "G3 Pro",
        quotaInfo: {
          remainingFraction: 0.7,
          resetTime: "2026-03-21T10:00:00Z",
        },
      },
      duplicate: {
        displayName: "G3 Pro",
        quotaInfo: {
          remainingFraction: 0.42,
        },
      },
      hidden: {
        displayName: "tab_flash_lite_preview",
        quotaInfo: { remainingFraction: 0.99 },
      },
      internal: {
        displayName: "Internal",
        isInternal: true,
        quotaInfo: { remainingFraction: 0.01 },
      },
      flash: {
        model: "G3 Flash",
        quotaInfo: {
          remainingFraction: 0.88,
          resetTime: "2026-03-20T18:30:00Z",
        },
      },
    },
  }, "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels", "project-456");

  assert.equal(snapshot.projectId, "project-456");
  assert.equal(snapshot.models.length, 2);
  assert.equal(snapshot.models.find((model) => model.model === "G3 Pro")?.remainingPercent, 42);
  assert.equal(snapshot.models.find((model) => model.model === "G3 Flash")?.remainingPercent, 88);
  assert.ok(snapshot.models.find((model) => model.model === "G3 Flash")?.resetAt > 0);
  assert.equal(snapshot.worstRemainingPercent, 42);
}

function runGoogleClassificationChecks() {
  assert.equal(classifyGoogleQuotaKind({ worstRemainingPercent: 80 }).kind, "ready");
  assert.equal(classifyGoogleQuotaKind({ worstRemainingPercent: 25 }).kind, "watch");
  assert.equal(classifyGoogleQuotaKind({ worstRemainingPercent: 10 }).kind, "low");
  assert.equal(classifyGoogleQuotaKind({ worstRemainingPercent: 3 }).kind, "blocked");
  assert.equal(classifyGoogleQuotaKind({ worstRemainingPercent: undefined }).kind, "error");
}

function runDisplayNameChecks() {
  assert.equal(
    subDisplayName({ provider: "openai-codex", index: 2 }),
    "ChatGPT Plus/Pro (Codex) #2",
  );
  assert.equal(
    subDisplayName({ provider: "openai-codex", index: 3, label: "Outlook" }),
    "Outlook — ChatGPT Plus/Pro (Codex) #3",
  );
}

runWindowClassificationChecks();
runSeverityChecks();
runGoogleGeminiQuotaParsingChecks();
runGoogleAntigravityQuotaParsingChecks();
runGoogleClassificationChecks();
runDisplayNameChecks();
console.log("subscription limit checks passed");
