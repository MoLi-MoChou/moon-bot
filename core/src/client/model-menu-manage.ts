// Shared helper: open the models settings page from a model menu action bag.
export const manageModels = (actions: { openModels?: (() => void) | undefined; openShellSettingsPanel?: (() => void) | undefined }): (() => void) | undefined =>
  actions.openModels ?? actions.openShellSettingsPanel

