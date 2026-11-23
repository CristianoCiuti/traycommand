# Variables and secrets

A variable is a value you write once and use everywhere as `${NAME}`: a folder, a server name, an editor. Change it in one place and every tray follows.

```json
"variables": { "WS": "C:/work/workspaces", "EDITOR": "code" }
```

```json
{ "label": "Web app", "action": "${EDITOR} \"${WS}/web.code-workspace\"" }
```

## Where they can be used

`${NAME}` is replaced in every text TrayCommand runs or shows: scripts, working folders, environment variables of an action, labels, confirmation and notification texts, the question of a shortcut, the label and the choices script of an asked value, the state check and its notifications, the folder of a folder watch, the check of a schedule, the title, message and buttons of an alert, icon paths. A variable can use other variables.

**Scope.** Variables belong to the whole configuration: every tray, menu entry and schedule sees the same ones. Inside an action, two kinds of values come first:

- the values the action [asks before running](./inputs) (and the values a schedule gives them),
- for runs started by a [folder watch](./schedules#when-files-change), the file: `${TC_FILE}`, `${TC_FILE_NAME}`, `${TC_FILE_DIR}`, `${TC_EVENT}`, `${TC_FILES}`, `${TC_WATCH_DIR}`.

An asked value called like a variable hides the variable in that action only.

Built in, always available:

| Variable | Value |
| --- | --- |
| `${configDir}` | The folder of the configuration file. |
| `${env:NAME}` | The environment variable `NAME` (empty if not set). |

A name that is none of these is left as written, so shell syntax like `${HOME}` in a bash script still reaches the shell.

## The Variables page

**Variables** in the editor lists every variable with its value, which you can change in place, and how many times it is used. Click the count to see where (each place opens its entry). From the same page you can:

- **add** a variable (name, value, and whether it is a secret),
- **rename** it: TrayCommand asks what to do where it is written: **everywhere**, **only where I choose** (tick the places), or **nowhere** (only the name changes, the places keep the old one),
- **delete** it (when it is used, TrayCommand asks first: those places keep `${NAME}` as written),
- turn it into a **secret**, or a secret back into a plain variable.

**Written but not defined** lists the `${NAME}` written somewhere that are not variables, each with **Add variable**. **Built in** recalls `${configDir}`, `${env:NAME}` and the values of folder watches.

## Inserting a variable

While you edit any of the texts above, the variables it can use appear under it as chips: first the values of the action (asked values, the file of a folder watch), then the variables and secrets, then the built in ones. A click writes `${NAME}` where the cursor is; the chips of names already in the text are highlighted.

Under the text, a `${NAME}` with no value there is pointed out: a name that is not a variable (with **Add variable**), a `${TC_…}` outside a folder watch, a secret with no value on this PC. When an environment variable of that name exists, the hint reminds you to write `${env:NAME}` to use it.

## Secrets

A **secret** is a variable for passwords, tokens and keys. It is used like any other variable, `${NAME}`, but:

- its value is **never written in the configuration file**: the file only lists its name in `secrets`,
  ```json
  "secrets": ["API_TOKEN"]
  ```
- the value is kept **encrypted on this PC, for your account** (Windows DPAPI, the macOS Keychain, the Linux keyring), in `secrets.json` in the data folder: another account or another PC cannot read it,
- it is shown as `••••` in the activity log, in notifications, in labels and alerts, in the output of **Test**,
- **exports** carry only its name: whoever imports it gives it a value of their own on the Variables page,
- on the Variables page its value is hidden; the eye button shows it, the eraser removes it from this PC (the secret stays, with no value).

Values typed for a secret are saved with **Save**, together with the configuration; **Discard** forgets them.

A secret declared without a value on this PC (a configuration copied from elsewhere, an import) is replaced by nothing until you give it one: the Variables page and the texts that use it say so.

::: tip The safest way to give a secret to a script
`${API_TOKEN}` in a script puts the value in the command line of the process. Pass it as an environment variable of the action instead: in **Options → Environment variables** write `API_TOKEN=${API_TOKEN}`, then use `$env:API_TOKEN` (PowerShell), `%API_TOKEN%` (cmd) or `"$API_TOKEN"` (bash) in the script.
:::

On a Linux system without a keyring, secrets cannot be stored safely: the Variables page says so and plain variables keep working.
