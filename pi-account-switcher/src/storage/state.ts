import { readFile } from "node:fs/promises";
import z from "zod";
import { STATE_PATH } from "@/constants";
import { fileUtil } from "@/utils";

const appStateSchema = z.object({
  activeAccountId: z.string().optional(),
  activeModelId: z.string().optional(),
  activeModelProvider: z.string().optional(),
});

export interface AppState {
  activeAccountId?: string;
  activeModelId?: string;
  activeModelProvider?: string;
}

export interface StateStore {
  load(): Promise<AppState>;
  save(state: AppState): Promise<void>;
}

export function useStateStore(path = STATE_PATH): StateStore {
  return new StateStoreImpl(path);
}

class StateStoreImpl implements StateStore {
  constructor(private readonly path: string) {}

  async load(): Promise<AppState> {
    try {
      const raw = await readFile(this.path, "utf8");
      return appStateSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (fileUtil.isMissingFileError(error)) return {};
      throw error;
    }
  }

  async save(state: AppState): Promise<void> {
    await fileUtil.writePrivateJson(this.path, state);
  }
}
