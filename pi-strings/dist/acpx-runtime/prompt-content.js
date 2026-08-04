export class PromptInputValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "PromptInputValidationError";
    }
}
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return value;
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isBase64Data(value) {
    if (value.length === 0 || value.length % 4 !== 0) {
        return false;
    }
    return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}
function isImageMimeType(value) {
    return /^image\/[A-Za-z0-9.+-]+$/i.test(value);
}
function isAudioMimeType(value) {
    return /^audio\/[A-Za-z0-9.+-]+$/i.test(value);
}
function isTextBlock(value) {
    const record = asRecord(value);
    return record?.type === "text" && typeof record.text === "string";
}
function isImageBlock(value) {
    const record = asRecord(value);
    return (record?.type === "image" &&
        isNonEmptyString(record.mimeType) &&
        isImageMimeType(record.mimeType) &&
        typeof record.data === "string" &&
        isBase64Data(record.data));
}
function isAudioBlock(value) {
    const record = asRecord(value);
    return (record?.type === "audio" &&
        isNonEmptyString(record.mimeType) &&
        isAudioMimeType(record.mimeType) &&
        typeof record.data === "string" &&
        isBase64Data(record.data));
}
function isResourceLinkBlock(value) {
    const record = asRecord(value);
    return (record?.type === "resource_link" &&
        isNonEmptyString(record.uri) &&
        (record.title === undefined || typeof record.title === "string") &&
        (record.name === undefined || typeof record.name === "string"));
}
function isResourcePayload(value) {
    const record = asRecord(value);
    if (!record || !isNonEmptyString(record.uri)) {
        return false;
    }
    return record.text === undefined || typeof record.text === "string";
}
function isResourceBlock(value) {
    const record = asRecord(value);
    return record?.type === "resource" && isResourcePayload(record.resource);
}
const CONTENT_BLOCK_VALIDATORS = [
    isTextBlock,
    isImageBlock,
    isAudioBlock,
    isResourceLinkBlock,
    isResourceBlock,
];
function isContentBlock(value) {
    return CONTENT_BLOCK_VALIDATORS.some((validator) => validator(value));
}
const CONTENT_BLOCK_ERROR_VALIDATORS = {
    text: validateTextContentBlock,
    image: validateImageContentBlock,
    audio: validateAudioContentBlock,
    resource_link: validateResourceLinkContentBlock,
    resource: validateResourceContentBlock,
};
function contentBlockErrorValidator(type) {
    return Object.hasOwn(CONTENT_BLOCK_ERROR_VALIDATORS, type)
        ? CONTENT_BLOCK_ERROR_VALIDATORS[type]
        : undefined;
}
function validateTextContentBlock(record, index) {
    return typeof record.text === "string"
        ? undefined
        : `prompt[${index}] text block must include a string text field`;
}
function validateImageContentBlock(record, index) {
    if (!isNonEmptyString(record.mimeType)) {
        return `prompt[${index}] image block must include a non-empty mimeType`;
    }
    if (!isImageMimeType(record.mimeType)) {
        return `prompt[${index}] image block mimeType must start with image/`;
    }
    if (typeof record.data !== "string" || record.data.length === 0) {
        return `prompt[${index}] image block must include non-empty base64 data`;
    }
    return isBase64Data(record.data)
        ? undefined
        : `prompt[${index}] image block data must be valid base64`;
}
function validateAudioContentBlock(record, index) {
    if (!isNonEmptyString(record.mimeType)) {
        return `prompt[${index}] audio block must include a non-empty mimeType`;
    }
    if (!isAudioMimeType(record.mimeType)) {
        return `prompt[${index}] audio block mimeType must start with audio/`;
    }
    if (typeof record.data !== "string" || record.data.length === 0) {
        return `prompt[${index}] audio block must include non-empty base64 data`;
    }
    return isBase64Data(record.data)
        ? undefined
        : `prompt[${index}] audio block data must be valid base64`;
}
function validateResourceLinkContentBlock(record, index) {
    if (!isNonEmptyString(record.uri)) {
        return `prompt[${index}] resource_link block must include a non-empty uri`;
    }
    if (record.title !== undefined && typeof record.title !== "string") {
        return `prompt[${index}] resource_link block title must be a string when present`;
    }
    if (record.name !== undefined && typeof record.name !== "string") {
        return `prompt[${index}] resource_link block name must be a string when present`;
    }
    return undefined;
}
function validateResourceContentBlock(record, index) {
    if (!asRecord(record.resource)) {
        return `prompt[${index}] resource block must include a resource object`;
    }
    return isResourcePayload(record.resource)
        ? undefined
        : `prompt[${index}] resource block resource must include a non-empty uri and optional text`;
}
function getContentBlockValidationError(value, index) {
    const record = asRecord(value);
    if (!record || typeof record.type !== "string") {
        return `prompt[${index}] must be an ACP content block object`;
    }
    const validator = contentBlockErrorValidator(record.type);
    return validator
        ? validator(record, index)
        : `prompt[${index}] has unsupported content block type ${JSON.stringify(record.type)}`;
}
export function isPromptInput(value) {
    return Array.isArray(value) && value.every((entry) => isContentBlock(entry));
}
function promptCapabilityRequirement(block) {
    switch (block.type) {
        case "image":
            return { blockType: "image", capability: "image" };
        case "audio":
            return { blockType: "audio", capability: "audio" };
        case "resource":
            return { blockType: "resource", capability: "embeddedContext" };
        default:
            return undefined;
    }
}
export function getUnsupportedPromptContentMessage(prompt, agentCapabilities) {
    for (const [index, block] of prompt.entries()) {
        const requirement = promptCapabilityRequirement(block);
        if (!requirement) {
            continue;
        }
        if (agentCapabilities?.promptCapabilities?.[requirement.capability] === true) {
            continue;
        }
        return `prompt[${index}] ${requirement.blockType} content requires agentCapabilities.promptCapabilities.${requirement.capability}`;
    }
    return undefined;
}
export function textPrompt(text) {
    return [
        {
            type: "text",
            text,
        },
    ];
}
function parseStructuredPrompt(source) {
    if (!source.startsWith("[")) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(source);
        if (isPromptInput(parsed)) {
            return parsed;
        }
        if (Array.isArray(parsed)) {
            const detail = parsed
                .map((entry, index) => getContentBlockValidationError(entry, index))
                .find((message) => message !== undefined) ??
                "Structured prompt JSON must be an array of valid ACP content blocks";
            throw new PromptInputValidationError(detail);
        }
        return undefined;
    }
    catch (error) {
        if (error instanceof PromptInputValidationError) {
            throw error;
        }
        return undefined;
    }
}
export function parsePromptSource(source) {
    const trimmed = source.trim();
    const structured = parseStructuredPrompt(trimmed);
    if (structured) {
        return structured;
    }
    if (!trimmed) {
        return [];
    }
    return textPrompt(trimmed);
}
export function mergePromptSourceWithText(source, suffixText) {
    const prompt = parsePromptSource(source);
    const appended = suffixText.trim();
    if (!appended) {
        return prompt;
    }
    if (prompt.length === 0) {
        return textPrompt(appended);
    }
    return [...prompt, ...textPrompt(appended)];
}
export function promptToDisplayText(prompt) {
    return prompt
        .map((block) => contentBlockDisplayText(block))
        .filter((entry) => entry.trim().length > 0)
        .join("\n\n")
        .trim();
}
function contentBlockDisplayText(block) {
    switch (block.type) {
        case "text":
            return block.text;
        case "resource_link":
            return block.title ?? block.name ?? block.uri;
        case "resource":
            return resourceBlockDisplayText(block);
        case "image":
            return `[image] ${block.mimeType}`;
        case "audio":
            return `[audio] ${block.mimeType}`;
        default:
            return "";
    }
}
function resourceBlockDisplayText(block) {
    return "text" in block.resource && typeof block.resource.text === "string"
        ? block.resource.text
        : block.resource.uri;
}
