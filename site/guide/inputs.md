# Asking for values

An action can ask for values before it runs: a branch name, an environment, a file. A small form opens in the middle of the screen, fully usable from the keyboard, and the values reach the script.

```json
{
  "id": "deploy",
  "label": "Deploy",
  "action": {
    "run": "./deploy.ps1 -Branch \"${BRANCH}\" -Target ${ENV}",
    "inputs": [
      { "name": "BRANCH", "label": "Branch", "default": "main" },
      { "name": "ENV", "label": "Environment", "type": "select", "options": ["dev", "test", { "value": "prod", "label": "Production" }] },
      { "name": "DRY", "label": "Dry run", "type": "checkbox", "default": true }
    ]
  }
}
```

![A form asking for values](/screens/launcher-form.png)

In the editor: open the action and click **Ask for a value**. The chip next to each value shows whether the script already uses it; click it to insert `${NAME}` where the cursor is.

## Using the values

Each value is available in two ways:

- **`${NAME}`** in the script (and in `cwd`, `env`, `confirm` and `notify` texts): replaced before the script runs. Values take precedence over [variables](./concepts#variables) with the same name.
- **An environment variable** with the same name: `$env:NAME` in PowerShell, `%NAME%` in cmd, `"$NAME"` in bash. This is the safest choice for free text, because quotes and spaces in the value cannot break the script.

```powershell
# both work; the second is safe whatever the user types
git checkout ${BRANCH}
git checkout $env:BRANCH
```

## Kinds of field

| `type` | Field | Value |
| --- | --- | --- |
| `text` (default) | Text box | The text |
| `password` | Masked text box | The text. Never remembered, shown as `••••` in the activity log and in error messages |
| `number` | Text box that accepts numbers | The number as text |
| `select` | Drop-down list | The `value` of the chosen option |
| `checkbox` | Switch | `true` or `false` |
| `file`, `folder` | Text box with **Browse** (<kbd>Ctrl</kbd> <kbd>O</kbd>) | The full path |

Other properties:

| Property | Description |
| --- | --- |
| `label` | Text shown above the field (default: the name). |
| `default` | Value proposed the first time. |
| `placeholder` | Hint shown inside an empty field. |
| `options` | Choices of a `select`: strings, or `{ "value", "label" }` to show a different text. |
| `optionsCommand` | Script whose output lines are the choices of a `select`, run when the form opens with the shell of the action. Example: `git branch --format=%(refname:short)`. |
| `optional` | Allow an empty value (otherwise the field is required). |
| `pattern` | Regular expression the whole value must match, e.g. `"[A-Z]+-\\d+"` for a ticket key (backslashes are doubled in JSON). |
| `remember` | `false` to always propose `default` instead of the last value used. |

## The form

- It opens when the entry is clicked in the tray, run from the launcher, from its shortcut, or with **Test** in the editor.
- The first field is selected: type and press <kbd>Enter</kbd> to run. <kbd>Tab</kbd> moves between fields. <kbd>Esc</kbd> cancels (from the launcher it goes back to the list).
- The last values you used are proposed again (stored on this PC, in the data folder, never in the configuration file). Passwords are never stored.
- Required fields, numbers and `pattern` are checked before running, with the problem shown under the field.

When an action runs other entries ([before, together, after](./concepts#composing-actions)), the values of all of them are asked **once**, in one form; a value with the same name is shared.

Values asked by a [schedule](./schedules) are never asked: they come from the schedule's `values` or the `default`.
