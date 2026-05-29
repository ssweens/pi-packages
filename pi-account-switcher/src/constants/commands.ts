export const COMMANDS = {
  accounts: {
    add: {
      name: "accounts:add",
      description: "Add a new provider account from inside Pi",
    },
    list: {
      name: "accounts:list",
      description: "List configured accounts and activate the selected account",
    },
    edit: {
      name: "accounts:edit",
      description: "Edit a configured account",
    },
    remove: {
      name: "accounts:remove",
      description: "Remove a configured account",
    },
    switch: {
      name: "accounts:switch",
      description: "Switch to another account within the current provider",
    },
    oauth: {
      name: "accounts:oauth",
      description: "Import Pi /login OAuth credentials as a switchable account",
    },
    verify: {
      name: "accounts:verify",
      description:
        "Verify secrets for one or all accounts without activating them (pass 'all'; add 'ping' to send a test request)",
    },
  },
  providers: {
    add: {
      name: "providers:add",
      description: "Add a reusable custom provider",
    },
    edit: {
      name: "providers:edit",
      description: "Edit a configured custom provider",
    },
    list: {
      name: "providers:list",
      description: "List configured custom providers",
    },
    remove: {
      name: "providers:remove",
      description: "Remove a configured custom provider",
    },
  },
  models: {
    list: {
      name: "models:list",
      description: "List all available models and switch to the selected one",
    },
    add: {
      name: "models:add",
      description: "Add a custom model config to the current provider",
    },
    remove: {
      name: "models:remove",
      description: "Remove a custom model config from the current provider",
    },
  },
  system: {
    reset: {
      name: "system:reset",
      description: "Reset all extension data (accounts, providers, state) to factory defaults",
    },
    export: {
      name: "system:export",
      description: "Export all extension data (accounts, providers, state) to a JSON file",
    },
    import: {
      name: "system:import",
      description: "Import extension data (accounts, providers, state) from a JSON file",
    },
  },
} as const;
