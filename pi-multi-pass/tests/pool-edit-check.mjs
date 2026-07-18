import assert from "node:assert/strict";

function createPoolValidationMessage(members) {
  if (members.length < 1) {
    return "Pool needs at least 1 member.";
  }
  return null;
}

function renamePoolReferences(chains, previousName, nextName) {
  let updatedEntries = 0;
  for (const chain of chains) {
    for (const entry of chain.entries) {
      if (entry.pool !== previousName) continue;
      entry.pool = nextName;
      updatedEntries += 1;
    }
  }
  return updatedEntries;
}

function runPoolValidationChecks() {
  assert.equal(createPoolValidationMessage([]), "Pool needs at least 1 member.");
  assert.equal(createPoolValidationMessage(["openai-codex"]), null);
}

function pruneRemovedPoolReferences(chains, poolName) {
  let removedEntries = 0;
  let removedChains = 0;

  for (const chain of chains) {
    const beforeCount = chain.entries.length;
    chain.entries = chain.entries.filter((entry) => entry.pool !== poolName);
    removedEntries += beforeCount - chain.entries.length;
  }

  const remainingChains = chains.filter((chain) => {
    if (chain.entries.length > 0) return true;
    removedChains += 1;
    return false;
  });

  return { remainingChains, removedEntries, removedChains };
}

function runRenamePoolReferenceChecks() {
  const chains = [
    {
      name: "primary",
      entries: [
        { pool: "work", model: "gpt-5-mini", enabled: true },
        { pool: "backup", model: "gpt-5-mini", enabled: true },
      ],
    },
    {
      name: "secondary",
      entries: [
        { pool: "work", model: "claude-sonnet-4", enabled: true },
      ],
    },
  ];

  const updatedEntries = renamePoolReferences(chains, "work", "office");

  assert.equal(updatedEntries, 2);
  assert.equal(chains[0].entries[0].pool, "office");
  assert.equal(chains[0].entries[1].pool, "backup");
  assert.equal(chains[1].entries[0].pool, "office");
}

function runRemovePoolReferenceChecks() {
  const chains = [
    {
      name: "primary",
      entries: [
        { pool: "work", model: "gpt-5-mini", enabled: true },
        { pool: "backup", model: "gpt-5-mini", enabled: true },
      ],
    },
    {
      name: "secondary",
      entries: [
        { pool: "work", model: "claude-sonnet-4", enabled: true },
      ],
    },
  ];

  const result = pruneRemovedPoolReferences(chains, "work");

  assert.equal(result.removedEntries, 2);
  assert.equal(result.removedChains, 1);
  assert.equal(result.remainingChains.length, 1);
  assert.equal(result.remainingChains[0].name, "primary");
  assert.deepEqual(result.remainingChains[0].entries, [
    { pool: "backup", model: "gpt-5-mini", enabled: true },
  ]);
}

runPoolValidationChecks();
runRenamePoolReferenceChecks();
runRemovePoolReferenceChecks();
console.log("pool edit checks passed");
