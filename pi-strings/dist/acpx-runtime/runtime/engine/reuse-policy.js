import path from "node:path";
export function shouldReuseExistingRecord(record, params) {
    if (record.acpx?.reset_on_next_ensure === true) {
        return false;
    }
    if (path.resolve(record.cwd) !== path.resolve(params.cwd)) {
        return false;
    }
    if (record.agentCommand !== params.agentCommand) {
        return false;
    }
    if (params.resumeSessionId && record.acpSessionId !== params.resumeSessionId) {
        return false;
    }
    return true;
}
