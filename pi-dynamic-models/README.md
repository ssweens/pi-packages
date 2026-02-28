# pi-dynamic-models

Dynamic model discovery for Pi coding agent.

Reads a config file at startup, calls `GET /models` on each configured server, and registers every discovered model — no manual model list maintenance required. Supports any Pi API type: OpenAI-compatible, Anthropic, Google, and custom proxies.

## Setup

### 1. Install the package

Add to your Pi agent settings (`~/.pi/agent/settings.json`):

```json
{
  "packages": [
    "local:/path/to/playbook/packages/pi-dynamic-models"
  ]
}
```

### 2. Create the config file

Create `~/.pi/agent/settings/pi-dynamic-models.json`:

```json
[
  {
    "provider": "local-llm",
    "baseUrl": "http://192.168.1.51:9999/v1",
    "apiKey": "MY_API_KEY",
    "api": "openai-completions",
    "compat": {
      "supportsUsageInStreaming": true,
      "maxTokensField": "max_tokens"
    }
  },
  {
    "provider": "my-proxy",
    "baseUrl": "http://localhost:8082",
    "apiKey": "secret",
    "api": "anthropic-messages"
  }
]
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `provider` | ✓ | Name shown in the model selector |
| `baseUrl` | ✓ | Server URL, including `/v1` if needed |
| `api` | | Pi API type (default: `openai-completions`). See below. |
| `apiKey` | | Literal key, env var name, or `!shell-command` — same resolution as `models.json`. Omit for open servers. |
| `compat` | | OpenAI compat overrides applied to every model. See below. |
| `models` | | Per-model metadata keyed by model ID. Overrides defaults for discovered models. Models listed here but not returned by the server are still registered. |

#### `models` override fields (all optional)

| Field | Type | Default |
|-------|------|---------|
| `name` | string | model ID |
| `reasoning` | boolean | `false` |
| `input` | `["text"]` \| `["text","image"]` | `["text"]` |
| `contextWindow` | number | `128000` |
| `maxTokens` | number | `16384` |

If the server is unreachable at startup, only models explicitly listed in `models` are registered.

### Supported API types

Any Pi `KnownApi` value:

| Value | Use for |
|-------|---------|
| `openai-completions` | Ollama, vLLM, LM Studio, llama.cpp, most local servers |
| `openai-responses` | OpenAI Responses API compatible servers |
| `anthropic-messages` | Anthropic-compatible proxies |
| `google-generative-ai` | Google AI compatible servers |
| `azure-openai-responses` | Azure OpenAI |

### `compat` fields (openai-completions only)

| Field | Type | Description |
|-------|------|-------------|
| `supportsStore` | boolean | Whether the server supports the `store` field |
| `supportsDeveloperRole` | boolean | Whether to use `developer` role instead of `system` |
| `supportsReasoningEffort` | boolean | Whether the server supports `reasoning_effort` |
| `supportsUsageInStreaming` | boolean | Whether `stream_options: {include_usage: true}` works |
| `maxTokensField` | `"max_tokens"` \| `"max_completion_tokens"` | Which field to use for max output tokens |
| `requiresToolResultName` | boolean | Whether tool results require the `name` field |
| `requiresAssistantAfterToolResult` | boolean | Whether an assistant message is required between tool result and next user message |
| `requiresThinkingAsText` | boolean | Whether thinking blocks must be converted to `<thinking>` text |
| `requiresMistralToolIds` | boolean | Whether tool call IDs must be normalized to Mistral format |
| `thinkingFormat` | `"openai"` \| `"zai"` \| `"qwen"` | Format for reasoning/thinking parameter |
| `supportsStrictMode` | boolean | Whether the `strict` field in tool definitions is supported |

## Overriding model metadata

Discovered models use conservative defaults (`contextWindow: 128000`, `maxTokens: 16384`, `reasoning: false`, `input: ["text"]`). Override them directly in the config file using the `models` dict:

```json
{
  "provider": "local-llm",
  "baseUrl": "http://192.168.1.51:9999/v1",
  "models": {
    "my-model-id": {
      "name": "My Model",
      "reasoning": true,
      "input": ["text", "image"],
      "contextWindow": 200000,
      "maxTokens": 32000
    }
  }
}
```

## Troubleshooting

**No models appear**: Check that the config file exists at `~/.pi/agent/settings/pi-dynamic-models.json` and the server is reachable.

**Wrong API behavior**: Set the correct `api` field for your server type.

**Token counting or field errors**: Add the appropriate `compat` settings for your server.
