import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const UNKNOWN_VERSION = "0.0.0-unknown";
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
let cachedVersion = null;
function parseVersion(value) {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function readPackageVersion(packageJsonPath) {
    try {
        const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
        return parseVersion(parsed.version);
    }
    catch {
        return null;
    }
}
function resolveVersionFromAncestors(startDir) {
    let current = startDir;
    while (true) {
        const packageVersion = readPackageVersion(path.join(current, "package.json"));
        if (packageVersion) {
            return packageVersion;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}
export function resolveAcpxVersion(params) {
    const envVersion = resolvePackageEnvVersion(params?.env ?? process.env);
    if (envVersion) {
        return envVersion;
    }
    if (params?.packageJsonPath) {
        return readPackageVersion(params.packageJsonPath) ?? UNKNOWN_VERSION;
    }
    return resolveVersionFromAncestors(MODULE_DIR) ?? UNKNOWN_VERSION;
}
function resolvePackageEnvVersion(env) {
    const envPackageName = parseVersion(env.npm_package_name);
    const envVersion = parseVersion(env.npm_package_version);
    return envPackageName === "acpx" ? envVersion : null;
}
export function getAcpxVersion() {
    if (cachedVersion) {
        return cachedVersion;
    }
    cachedVersion = resolveAcpxVersion();
    return cachedVersion;
}
