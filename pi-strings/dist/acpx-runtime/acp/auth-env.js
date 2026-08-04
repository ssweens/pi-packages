const AUTH_ENV_PREFIX = "ACPX_AUTH_";
function toEnvToken(value) {
    return value
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
}
function buildAuthEnvKey(methodId) {
    const token = toEnvToken(methodId);
    return token.length > 0 ? `${AUTH_ENV_PREFIX}${token}` : undefined;
}
const authEnvKeyCache = new Map();
function authEnvKey(methodId) {
    const cached = authEnvKeyCache.get(methodId);
    if (cached !== undefined) {
        return cached;
    }
    const key = buildAuthEnvKey(methodId);
    authEnvKeyCache.set(methodId, key);
    return key;
}
export function readEnvCredential(methodId) {
    const key = authEnvKey(methodId);
    if (!key) {
        return undefined;
    }
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
        return value;
    }
    return undefined;
}
function protectedEnvKey(key) {
    return process.platform === "win32" ? key.toUpperCase() : key;
}
function isAuthEnvKey(key) {
    return protectedEnvKey(key).startsWith(AUTH_ENV_PREFIX);
}
function authEnvSuffix(key) {
    return key.slice(AUTH_ENV_PREFIX.length);
}
function protectEnvKey(protectedKeys, key) {
    protectedKeys.add(protectedEnvKey(key));
}
function promotePrefixedAuthEnvironment(env) {
    const protectedKeys = new Set();
    for (const [key, value] of Object.entries(env)) {
        if (!isAuthEnvKey(key)) {
            continue;
        }
        if (typeof value !== "string" || value.trim().length === 0) {
            continue;
        }
        const normalized = toEnvToken(authEnvSuffix(key));
        if (!normalized) {
            continue;
        }
        protectEnvKey(protectedKeys, key);
        protectEnvKey(protectedKeys, normalized);
        if (env[normalized] == null) {
            env[normalized] = value;
        }
    }
    return protectedKeys;
}
function buildAgentEnvironment(authCredentials, sessionEnv) {
    const env = { ...process.env };
    const protectedAuthEnvKeys = promotePrefixedAuthEnvironment(env);
    if (authCredentials) {
        for (const [methodId, credential] of Object.entries(authCredentials)) {
            addAuthCredentialEnvKeys(protectedAuthEnvKeys, methodId, credential);
            assignAuthCredentialEnv(env, methodId, credential);
        }
    }
    if (sessionEnv) {
        for (const [key, value] of Object.entries(sessionEnv)) {
            if (typeof value !== "string" || protectedAuthEnvKeys.has(protectedEnvKey(key))) {
                continue;
            }
            assignSessionEnv(env, key, value);
        }
    }
    return env;
}
function assignSessionEnv(env, key, value) {
    const normalizedKey = protectedEnvKey(key);
    for (const existingKey of Object.keys(env)) {
        if (protectedEnvKey(existingKey) === normalizedKey) {
            delete env[existingKey];
        }
    }
    env[key] = value;
}
function addAuthCredentialEnvKeys(protectedKeys, methodId, credential) {
    if (typeof credential !== "string" || credential.trim().length === 0) {
        return;
    }
    if (!methodId.includes("=") && !methodId.includes("\u0000")) {
        protectEnvKey(protectedKeys, methodId);
    }
    const normalized = toEnvToken(methodId);
    if (normalized) {
        protectEnvKey(protectedKeys, `${AUTH_ENV_PREFIX}${normalized}`);
        protectEnvKey(protectedKeys, normalized);
    }
}
function assignAuthCredentialEnv(env, methodId, credential) {
    if (typeof credential !== "string" || credential.trim().length === 0) {
        return;
    }
    if (!methodId.includes("=") && !methodId.includes("\u0000") && env[methodId] == null) {
        env[methodId] = credential;
    }
    const normalized = toEnvToken(methodId);
    if (normalized) {
        assignIfMissing(env, `${AUTH_ENV_PREFIX}${normalized}`, credential);
        assignIfMissing(env, normalized, credential);
    }
}
function assignIfMissing(env, key, value) {
    if (env[key] == null) {
        env[key] = value;
    }
}
export function resolveConfiguredAuthCredential(methodId, authCredentials) {
    const configCredentials = authCredentials ?? {};
    return configCredentials[methodId] ?? configCredentials[toEnvToken(methodId)];
}
export function buildAgentSpawnOptions(cwd, authCredentials, sessionEnv) {
    return {
        cwd,
        env: buildAgentEnvironment(authCredentials, sessionEnv),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
    };
}
