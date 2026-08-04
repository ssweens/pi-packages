import fs from "node:fs/promises";
import path from "node:path";
import { PermissionDeniedError, PermissionPromptUnavailableError } from "./errors.js";
import { promptForPermission } from "./permission-prompt.js";
const WRITE_PREVIEW_MAX_LINES = 16;
const WRITE_PREVIEW_MAX_CHARS = 1_200;
function nowIso() {
    return new Date().toISOString();
}
function isWithinRoot(rootDir, targetPath) {
    const relative = path.relative(rootDir, targetPath);
    return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function toWritePreview(content) {
    const normalized = content.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const visibleLines = lines.slice(0, WRITE_PREVIEW_MAX_LINES);
    let preview = visibleLines.join("\n");
    if (lines.length > visibleLines.length) {
        preview += `\n... (${lines.length - visibleLines.length} more lines)`;
    }
    if (preview.length > WRITE_PREVIEW_MAX_CHARS) {
        preview = `${preview.slice(0, WRITE_PREVIEW_MAX_CHARS - 3)}...`;
    }
    return preview;
}
async function defaultConfirmWrite(filePath, preview) {
    return await promptForPermission({
        header: `[permission] Allow write to ${filePath}?`,
        details: preview,
        prompt: "Allow write? (y/N) ",
    });
}
function canPromptForPermission() {
    return process.stdin.isTTY && process.stderr.isTTY;
}
export class FileSystemHandlers {
    rootDir;
    permissionMode;
    nonInteractivePermissions;
    onOperation;
    usesDefaultConfirmWrite;
    confirmWrite;
    constructor(options) {
        this.rootDir = path.resolve(options.cwd);
        this.permissionMode = options.permissionMode;
        this.nonInteractivePermissions = options.nonInteractivePermissions ?? "deny";
        this.onOperation = options.onOperation;
        this.usesDefaultConfirmWrite = options.confirmWrite == null;
        this.confirmWrite = options.confirmWrite ?? defaultConfirmWrite;
    }
    updatePermissionPolicy(permissionMode, nonInteractivePermissions) {
        this.permissionMode = permissionMode;
        this.nonInteractivePermissions = nonInteractivePermissions ?? "deny";
    }
    async readTextFile(params) {
        const filePath = this.resolvePathWithinRoot(params.path);
        const summary = `read_text_file: ${filePath}`;
        this.emitOperation({
            method: "fs/read_text_file",
            status: "running",
            summary,
            details: this.readWindowDetails(params.line, params.limit),
            timestamp: nowIso(),
        });
        try {
            if (this.permissionMode === "deny-all") {
                throw new PermissionDeniedError("Permission denied for fs/read_text_file (--deny-all)");
            }
            const content = await fs.readFile(filePath, "utf8");
            const sliced = this.sliceContent(content, params.line, params.limit);
            this.emitOperation({
                method: "fs/read_text_file",
                status: "completed",
                summary,
                details: this.readWindowDetails(params.line, params.limit),
                timestamp: nowIso(),
            });
            return { content: sliced };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.emitOperation({
                method: "fs/read_text_file",
                status: "failed",
                summary,
                details: message,
                timestamp: nowIso(),
            });
            throw error;
        }
    }
    async writeTextFile(params) {
        const filePath = this.resolvePathWithinRoot(params.path);
        const preview = toWritePreview(params.content);
        const summary = `write_text_file: ${filePath}`;
        this.emitOperation({
            method: "fs/write_text_file",
            status: "running",
            summary,
            details: preview,
            timestamp: nowIso(),
        });
        try {
            if (!(await this.isWriteApproved(filePath, preview))) {
                throw new PermissionDeniedError("Permission denied for fs/write_text_file");
            }
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, params.content, "utf8");
            this.emitOperation({
                method: "fs/write_text_file",
                status: "completed",
                summary,
                details: preview,
                timestamp: nowIso(),
            });
            return {};
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.emitOperation({
                method: "fs/write_text_file",
                status: "failed",
                summary,
                details: message,
                timestamp: nowIso(),
            });
            throw error;
        }
    }
    async isWriteApproved(filePath, preview) {
        if (this.permissionMode === "approve-all") {
            return true;
        }
        if (this.permissionMode === "deny-all") {
            return false;
        }
        if (this.usesDefaultConfirmWrite &&
            this.nonInteractivePermissions === "fail" &&
            !canPromptForPermission()) {
            throw new PermissionPromptUnavailableError();
        }
        return await this.confirmWrite(filePath, preview);
    }
    resolvePathWithinRoot(rawPath) {
        if (!path.isAbsolute(rawPath)) {
            throw new Error(`Path must be absolute: ${rawPath}`);
        }
        const resolved = path.resolve(rawPath);
        if (!isWithinRoot(this.rootDir, resolved)) {
            throw new Error(`Path is outside allowed cwd subtree: ${resolved}`);
        }
        return resolved;
    }
    sliceContent(content, line, limit) {
        if (line == null && limit == null) {
            return content;
        }
        const lines = content.split("\n");
        const startLine = line == null ? 1 : Math.max(1, Math.trunc(line));
        const startIndex = Math.max(0, startLine - 1);
        const maxLines = limit == null ? undefined : Math.max(0, Math.trunc(limit));
        if (maxLines === 0) {
            return "";
        }
        const endIndex = maxLines == null ? lines.length : Math.min(lines.length, startIndex + maxLines);
        return lines.slice(startIndex, endIndex).join("\n");
    }
    readWindowDetails(line, limit) {
        if (line == null && limit == null) {
            return undefined;
        }
        const start = line == null ? 1 : Math.max(1, Math.trunc(line));
        const max = limit == null ? "all" : Math.max(0, Math.trunc(limit));
        return `line=${start}, limit=${max}`;
    }
    emitOperation(operation) {
        this.onOperation?.(operation);
    }
}
