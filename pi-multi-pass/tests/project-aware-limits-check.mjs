import assert from "node:assert/strict";

function subProviderName(entry) {
  return `${entry.provider}-${entry.index}`;
}

function normalizeEntries(entries) {
  const byProvider = new Map();
  for (const entry of entries) {
    if (!byProvider.has(entry.provider)) byProvider.set(entry.provider, []);
    byProvider.get(entry.provider).push(entry);
  }

  const normalized = [];
  for (const [provider, list] of byProvider.entries()) {
    const usedIndices = new Set(list.filter((e) => e.index > 0).map((e) => e.index));
    if (list.some((e) => e.index === 0)) {
      let nextIndex = 2;
      while (usedIndices.has(nextIndex)) nextIndex += 1;
      normalized.push({ provider, index: nextIndex });
      usedIndices.add(nextIndex);
    }
    for (const entry of list.filter((e) => e.index > 0).sort((a, b) => a.index - b.index)) {
      normalized.push(entry);
    }
  }
  return normalized;
}

function mergeConfigs(fileConfig, envEntries) {
  const merged = [...fileConfig.subscriptions];
  for (const envEntry of envEntries) {
    const existingCount = merged.filter((s) => s.provider === envEntry.provider).length;
    const envCountForProvider = envEntries.filter((e) => e.provider === envEntry.provider).length;
    if (existingCount < envCountForProvider) {
      const usedIndices = merged
        .filter((s) => s.provider === envEntry.provider)
        .map((s) => s.index);
      let nextIndex = 2;
      while (usedIndices.includes(nextIndex)) nextIndex += 1;
      merged.push({ provider: envEntry.provider, index: nextIndex });
    }
  }
  return merged;
}

function normalizeQuotaAllowedProviderNames(projectConfig) {
  if (!projectConfig?.allowedSubs || projectConfig.allowedSubs.length === 0) return undefined;
  const normalized = [...new Set(projectConfig.allowedSubs.map((value) => value.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : undefined;
}

function collectQuotaProviderNames({ checkers, subscriptions, hasAuth, allowedProviderNames }) {
  const allSubs = normalizeEntries(mergeConfigs({ subscriptions }, []));
  const allowed = allowedProviderNames ? new Set(allowedProviderNames) : undefined;
  const seen = new Set();
  const providerNames = [];

  const push = (providerName) => {
    if (allowed && !allowed.has(providerName)) return;
    if (seen.has(providerName)) return;
    seen.add(providerName);
    providerNames.push(providerName);
  };

  for (const checker of checkers) {
    if (hasAuth(checker.baseProvider)) {
      push(checker.baseProvider);
    }
    for (const entry of allSubs) {
      if (entry.provider !== checker.baseProvider) continue;
      push(subProviderName(entry));
    }
  }

  return providerNames;
}

function runRestrictedExtraSubscriptionCheck() {
  const providerNames = collectQuotaProviderNames({
    checkers: [{ baseProvider: "openai-codex" }],
    subscriptions: [{ provider: "openai-codex", index: 2, label: "mw" }],
    hasAuth: (providerName) => providerName === "openai-codex" || providerName === "openai-codex-2",
    allowedProviderNames: normalizeQuotaAllowedProviderNames({ allowedSubs: ["openai-codex-2"] }),
  });

  assert.deepEqual(providerNames, ["openai-codex-2"]);
}

function runRestrictedBaseProviderCheck() {
  const providerNames = collectQuotaProviderNames({
    checkers: [{ baseProvider: "openai-codex" }],
    subscriptions: [{ provider: "openai-codex", index: 2 }],
    hasAuth: (providerName) => providerName === "openai-codex" || providerName === "openai-codex-2",
    allowedProviderNames: normalizeQuotaAllowedProviderNames({ allowedSubs: ["openai-codex"] }),
  });

  assert.deepEqual(providerNames, ["openai-codex"]);
}

function runUnrestrictedCheck() {
  const providerNames = collectQuotaProviderNames({
    checkers: [{ baseProvider: "openai-codex" }],
    subscriptions: [{ provider: "openai-codex", index: 2 }],
    hasAuth: (providerName) => providerName === "openai-codex" || providerName === "openai-codex-2",
    allowedProviderNames: undefined,
  });

  assert.deepEqual(providerNames, ["openai-codex", "openai-codex-2"]);
}

runRestrictedExtraSubscriptionCheck();
runRestrictedBaseProviderCheck();
runUnrestrictedCheck();
console.log("project-aware limits checks passed");
