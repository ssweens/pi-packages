import type { ReadTextFileRequest, ReadTextFileResponse, WriteTextFileRequest, WriteTextFileResponse } from "@agentclientprotocol/sdk";
import type { ClientOperation, NonInteractivePermissionPolicy, PermissionMode } from "./types.js";
export type FileSystemHandlersOptions = {
    cwd: string;
    permissionMode: PermissionMode;
    nonInteractivePermissions?: NonInteractivePermissionPolicy;
    onOperation?: (operation: ClientOperation) => void;
    confirmWrite?: (filePath: string, preview: string) => Promise<boolean>;
};
export declare class FileSystemHandlers {
    private readonly rootDir;
    private permissionMode;
    private nonInteractivePermissions;
    private readonly onOperation?;
    private readonly usesDefaultConfirmWrite;
    private readonly confirmWrite;
    constructor(options: FileSystemHandlersOptions);
    updatePermissionPolicy(permissionMode: PermissionMode, nonInteractivePermissions?: NonInteractivePermissionPolicy): void;
    readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse>;
    writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse>;
    private isWriteApproved;
    private resolvePathWithinRoot;
    private sliceContent;
    private readWindowDetails;
    private emitOperation;
}
