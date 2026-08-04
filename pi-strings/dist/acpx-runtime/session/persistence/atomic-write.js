import { randomUUID } from "node:crypto";
export function createAtomicWriteTempPath(filePath, createUniqueId = randomUUID) {
    return `${filePath}.${process.pid}.${Date.now()}.${createUniqueId()}.tmp`;
}
