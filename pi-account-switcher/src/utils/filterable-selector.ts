import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, getKeybindings, Input, Spacer, Text, type Focusable } from "@earendil-works/pi-tui";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";

type Theme = { fg: (color: ThemeColor, text: string) => string; bold: (text: string) => string };

export class FilterableMultiSelectComponent extends Container implements Focusable {
  private readonly listContainer: Container;
  private readonly theme: Theme;
  private selectedIndex = 0;
  private checked: boolean[];

  _focused = false;
  get focused() {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
  }

  constructor(
    title: string,
    private readonly options: string[],
    initialChecked: boolean[],
    private readonly onDone: (selected: string[] | undefined) => void,
    theme: Theme,
    private readonly disabled: boolean[] = [],
  ) {
    super();
    this.theme = theme;
    this.checked = options.map((_, i) => !this.disabled[i] && (initialChecked[i] ?? false));
    this.selectedIndex = Math.max(
      0,
      this.disabled.findIndex((value) => !value),
    );

    const borderColor = (str: string) => theme.fg("border", str);
    this.addChild(new DynamicBorder(borderColor));
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
    this.addChild(new Spacer(1));

    this.listContainer = new Container();
    this.addChild(this.listContainer);
    this.addChild(new Spacer(1));

    const hint = (key: string, desc: string) => theme.fg("dim", key) + theme.fg("muted", ` ${desc}`);
    this.addChild(
      new Text(
        hint("↑↓", "navigate") +
          "  " +
          hint("Space", "toggle") +
          "  " +
          hint("Enter", "run") +
          "  " +
          hint("Esc", "cancel"),
        1,
        0,
      ),
    );
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder(borderColor));

    this.updateList();
  }

  handleInput(keyData: string) {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.up")) {
      this.moveSelection(-1);
    } else if (kb.matches(keyData, "tui.select.down")) {
      this.moveSelection(1);
    } else if (keyData === " ") {
      this.toggleSelected();
    } else if (kb.matches(keyData, "tui.select.confirm")) {
      this.onDone(this.options.filter((_, i) => this.checked[i] && !this.disabled[i]));
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.onDone(undefined);
    }
  }

  private moveSelection(delta: number) {
    if (this.options.length === 0) return;
    for (let step = 0; step < this.options.length; step++) {
      this.selectedIndex = (this.selectedIndex + delta + this.options.length) % this.options.length;
      if (!this.disabled[this.selectedIndex]) break;
    }
    this.updateList();
  }

  private toggleSelected() {
    if (this.disabled[this.selectedIndex]) return;
    this.checked[this.selectedIndex] = !this.checked[this.selectedIndex];
    this.updateList();
  }

  private updateList() {
    this.listContainer.clear();
    for (let i = 0; i < this.options.length; i++) {
      const isSelected = i === this.selectedIndex;
      if (this.disabled[i]) {
        this.listContainer.addChild(new Text(this.theme.fg("muted", `  ${this.options[i]}`), 0, 0));
        continue;
      }
      const marker = this.checked[i] ? "[x]" : "[ ]";
      const line = `${isSelected ? "›" : " "} ${marker} ${this.options[i]}`;
      this.listContainer.addChild(new Text(isSelected ? this.theme.fg("accent", line) : line, 0, 0));
    }
  }
}

export class FilterableExtensionSelectorComponent extends Container implements Focusable {
  private readonly searchInput: Input;
  private readonly listContainer: Container;
  private readonly theme: Theme;
  private allOptions: string[];
  private filteredOptions: string[];
  private selectedIndex = 0;

  _focused = false;
  get focused() {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  constructor(
    title: string,
    options: string[],
    private readonly onDone: (selected: string | undefined) => void,
    theme: Theme,
  ) {
    super();
    this.theme = theme;
    this.allOptions = options;
    this.filteredOptions = options;

    const borderColor = (str: string) => theme.fg("border", str);
    this.addChild(new DynamicBorder(borderColor));
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
    this.addChild(new Spacer(1));

    this.searchInput = new Input();
    this.searchInput.onSubmit = () => this.confirm();
    this.addChild(this.searchInput);
    this.addChild(new Spacer(1));

    this.listContainer = new Container();
    this.addChild(this.listContainer);
    this.addChild(new Spacer(1));

    const hint = (key: string, desc: string) => theme.fg("dim", key) + theme.fg("muted", ` ${desc}`);
    this.addChild(
      new Text(hint("↑↓", "navigate") + "  " + hint("Enter", "select") + "  " + hint("Esc", "cancel"), 1, 0),
    );
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder(borderColor));

    this.updateList();
  }

  handleInput(keyData: string) {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.up")) {
      if (this.filteredOptions.length === 0) return;
      this.selectedIndex = this.selectedIndex === 0 ? this.filteredOptions.length - 1 : this.selectedIndex - 1;
      this.updateList();
    } else if (kb.matches(keyData, "tui.select.down")) {
      if (this.filteredOptions.length === 0) return;
      this.selectedIndex = this.selectedIndex === this.filteredOptions.length - 1 ? 0 : this.selectedIndex + 1;
      this.updateList();
    } else if (kb.matches(keyData, "tui.select.confirm")) {
      this.confirm();
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.onDone(undefined);
    } else {
      this.searchInput.handleInput(keyData);
      this.applyFilter(this.searchInput.getValue());
    }
  }

  private confirm() {
    const option = this.filteredOptions[this.selectedIndex];
    if (option) this.onDone(option);
  }

  private applyFilter(query: string) {
    this.filteredOptions = query ? fuzzyFilter(this.allOptions, query, (o) => o) : this.allOptions;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredOptions.length - 1));
    this.updateList();
  }

  private updateList() {
    this.listContainer.clear();
    const maxVisible = 12;
    const total = this.filteredOptions.length;
    const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), total - maxVisible));
    const end = Math.min(start + maxVisible, total);

    for (let i = start; i < end; i++) {
      const isSelected = i === this.selectedIndex;
      const line = isSelected
        ? this.theme.fg("accent", `→ ${this.filteredOptions[i]}`)
        : `  ${this.filteredOptions[i]}`;
      this.listContainer.addChild(new Text(line, 0, 0));
    }

    if (start > 0 || end < total) {
      this.listContainer.addChild(new Text(this.theme.fg("muted", `  (${this.selectedIndex + 1}/${total})`), 0, 0));
    }

    if (total === 0) {
      this.listContainer.addChild(new Text(this.theme.fg("muted", "  No matches"), 0, 0));
    }
  }
}
