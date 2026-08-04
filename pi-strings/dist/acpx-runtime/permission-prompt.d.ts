export type PermissionPromptOptions = {
    prompt: string;
    header?: string;
    details?: string;
};
export declare function promptForPermission(options: PermissionPromptOptions): Promise<boolean>;
