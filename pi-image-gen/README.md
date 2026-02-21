# pi-image-gen

Provider-agnostic image generation [Pi package](https://shittycodingagent.ai/packages). Mirrors Pi's text model architecture — built-in models discovered at build time, custom models via config, API keys resolved through Pi's ModelRegistry.

## Built-in Providers & Models

Models are auto-generated from the same sources Pi uses (OpenRouter API, static catalogs). Run `npm run generate-models` to refresh.

| Provider | Models | API Key | API Type |
|----------|--------|---------|----------|
| **openai** | `gpt-image-1`, `dall-e-3`, `dall-e-2` | `OPENAI_API_KEY` | `/v1/images/generations` |
| **google** | `gemini-2.0-flash-preview-image-generation`, `imagen-3.0-generate-002` | `GEMINI_API_KEY` | Gemini `generateContent` |
| **openrouter** | `openai/gpt-5-image`, `openai/gpt-5-image-mini`, `google/gemini-2.5-flash-image`, `google/gemini-3-pro-image-preview` | `OPENROUTER_API_KEY` | Chat completions |

## Install

```bash
pi install npm:pi-image-gen
# or
pi install /path/to/pi-image-gen
```

## Usage

```
> Generate an image of a sunset over mountains

> Create a 16:9 wallpaper of a cyberpunk city using dall-e-3
```

### Choosing a Model

Use `/image-model` — works in both Pi terminal and Minapi:

```
/image-model                              # Interactive picker (all models)
/image-model openai/gpt-image-1           # Direct selection
/image-model openrouter/openai/gpt-5-image  # OpenRouter model
```

Selection persists in the session and shows in the status bar as `🎨 provider/model`.

### Resolution Order

1. **Tool params** — `model` or `provider` in the tool call
2. **Session selection** — `/image-model` command
3. **Settings files** — `defaultProvider` / `defaultModel` in `pi-image-gen.json`
4. **Default** — `openai/gpt-image-1`

## Custom Models via Settings

Define image providers in `~/.pi/agent/settings/pi-image-gen.json` (global) or `<project>/.pi/settings/pi-image-gen.json` (project-local, overrides global):

```json
{
  "defaultProvider": "local-llm",
  "defaultModel": "my-local-image-model",
  "providers": {
    "local-llm": {
      "baseUrl": "http://192.168.1.51:9999/v1",
      "apiKey": "MY_API_KEY",
      "api": "openai-images",
      "models": [
        {
          "id": "my-local-image-model",
          "name": "My Local Image Model",
          "cost": 0
        }
      ]
    }
  }
}
```

Supported image API types:
- `openai-images` — `POST /v1/images/generations`
- `openai-chat-image` — `POST /v1/chat/completions` with `modalities: ["image"]`
- `google-generative-ai-image` — Gemini `generateContent`

Model-level `api` overrides provider-level `api`.

### Legacy: `models.json` providers with `output: ["image"]`

`pi-image-gen` still reads `providers.<name>.models[]` entries in `~/.pi/agent/models.json` that are tagged with `output: ["image"]`. This is lower priority than the settings file.

## Pi Integration

- **API keys** — Resolved via `ctx.modelRegistry.getApiKeyForProvider()` (env vars, auth.json, OAuth)
- **Base URLs** — From `models.json` provider config or generated model data
- **Custom providers** — Define image providers in `~/.pi/agent/settings/pi-image-gen.json`

## Architecture

Mirrors Pi's text model pipeline:

| Layer | Pi (text) | pi-image-gen |
|-------|-----------|--------------|
| Build-time discovery | `generate-models.ts` → `models.generated.ts` | `generate-image-models.ts` → `image-models.generated.ts` |
| **Runtime discovery** | None | OpenRouter `/v1/models` on startup (24h cache) |
| Sources | models.dev, OpenRouter, AI Gateway | OpenRouter (`output_modalities: ["image"]`), static catalog |
| Custom models | `models.json` providers | `settings/pi-image-gen.json providers` (preferred) + legacy `models.json output: ["image"]` |
| API key resolution | `ModelRegistry.getApiKeyForProvider()` | Same |
| Model selection | Ctrl+P / model selector | `/image-model` command |
| Session persistence | `sessionManager` model change entry | `pi.appendEntry()` custom entry |

### Model Priority (lowest → highest)

1. **Built-in generated** — `image-models.generated.ts` (baked into package)
2. **Runtime discovered** — OpenRouter API fetch, cached at `~/.pi/agent/cache/pi-image-gen-discovered.json` (24h TTL)
3. **Legacy `models.json`** — `providers.<name>.models[]` entries with `output: ["image"]`
4. **Settings providers** — `providers` in `pi-image-gen.json` settings file
5. **Session selection** — `/image-model` command or tool params

## API Types

| Type | Used By | Endpoint |
|------|---------|----------|
| `openai-images` | OpenAI direct | `POST /v1/images/generations` |
| `openai-chat-image` | OpenRouter | `POST /v1/chat/completions` (requested with `modalities: ["image"]`, image in response) |
| `google-generative-ai-image` | Google Gemini | `POST /models/{id}:generateContent` |

## Adding Providers

1. Add static models to `scripts/generate-image-models.ts`
2. Or add a new dynamic fetch function (like `fetchOpenRouterImageModels`)
3. Run `npm run generate-models`
4. Add generation logic in `image-gen.ts` if a new API type is needed

## Save Modes

| Mode | Location |
|------|----------|
| `none` | Don't save (default) |
| `project` | `<repo>/.pi/generated-images/` |
| `global` | `~/.pi/agent/generated-images/` |
| `custom` | `saveDir` param or `PI_IMAGE_SAVE_DIR` |
