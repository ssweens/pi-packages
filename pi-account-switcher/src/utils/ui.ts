import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { commonUtil } from "./common.js";
import { FilterableExtensionSelectorComponent, FilterableMultiSelectComponent } from "./filterable-selector.js";

function deduplicateLabels(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return n > 1 ? `${label} (${n})` : label;
  });
}

export const uiUtil = {
  /** Returns a prompt builder for a single input, parsed as text, CSV, JSON array, or JSON record. */
  prompt: (ui: ExtensionUIContext) => (title: string, hint?: string) => ({
    asText: async () => commonUtil.blankToUndefined(await ui.input(title, hint)),
    asCsv: async () => commonUtil.parseCsv((await ui.input(title, hint)) ?? ""),
    asJsonArray: async (field: string) => commonUtil.parseJsonArray(await ui.input(title, hint), field),
    asJsonRecord: async (field: string) => commonUtil.parseJsonRecord(await ui.input(title, hint), field),
  }),

  setAccountStatus: (ui: ExtensionUIContext, label: string | undefined): void => {
    ui.setStatus("account", label ? `👤 ${label}` : undefined);
  },

  /** Like filteredSelect but skips items where the corresponding value is null (used for group headers). */
  filteredGroupedSelect: async <T>(
    ui: ExtensionUIContext,
    title: string,
    labels: string[],
    values: Array<T | null>,
  ): Promise<T | undefined> => {
    const deduped = deduplicateLabels(labels);
    while (true) {
      const selected = await uiUtil.filteredSelect(ui, title, deduped);
      if (selected === undefined) return undefined;
      const value = values[deduped.indexOf(selected)];
      if (value !== null) return value;
    }
  },

  /** Show a selector using the custom filterable component. */
  filteredSelect: (ui: ExtensionUIContext, title: string, options: string[]): Promise<string | undefined> => {
    return ui.custom<string | undefined>(
      (_tui, theme, _keybindings, done) => new FilterableExtensionSelectorComponent(title, options, done, theme),
    );
  },

  /** Show a checkbox-style multi-select component. */
  multiSelect: (
    ui: ExtensionUIContext,
    title: string,
    options: string[],
    initialChecked: boolean[] = [],
    disabled: boolean[] = [],
  ): Promise<string[] | undefined> => {
    return ui.custom<string[] | undefined>(
      (_tui, theme, _keybindings, done) =>
        new FilterableMultiSelectComponent(title, options, initialChecked, done, theme, disabled),
    );
  },

  /** Like multiSelect but skips items where the corresponding value is null (used for group headers). */
  multiGroupedSelect: async <T>(
    ui: ExtensionUIContext,
    title: string,
    labels: string[],
    values: Array<T | null>,
    initialChecked: boolean[] = [],
  ): Promise<T[] | undefined> => {
    const deduped = deduplicateLabels(labels);
    const selected = await uiUtil.multiSelect(
      ui,
      title,
      deduped,
      initialChecked,
      values.map((value) => value === null),
    );
    if (!selected) return undefined;
    return selected.map((label) => values[deduped.indexOf(label)]).filter((value): value is T => value !== null);
  },
};
