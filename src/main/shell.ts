import type { Shell } from '../shared/config';

export interface ShellCommand {
  file: string;
  args: string[];
}

export function defaultShell(platform: NodeJS.Platform = process.platform, env = process.env): Shell {
  if (platform === 'win32') return 'powershell';
  const fromEnv = env.SHELL?.split('/').pop();
  if (fromEnv === 'zsh' || fromEnv === 'bash' || fromEnv === 'sh') return fromEnv;
  return platform === 'darwin' ? 'zsh' : 'bash';
}

const PS_PREAMBLE = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;$OutputEncoding=[Text.Encoding]::UTF8;";

/** Builds the process to spawn for a script with the given shell. */
export function shellCommand(shell: Shell, script: string, platform: NodeJS.Platform = process.platform): ShellCommand {
  if (typeof shell === 'object') return { file: shell.command, args: [...shell.args, script] };
  switch (shell) {
    case 'powershell':
    case 'pwsh':
      return {
        file: shell === 'powershell' ? 'powershell.exe' : 'pwsh',
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_PREAMBLE + script],
      };
    case 'cmd':
      return { file: 'cmd.exe', args: ['/d', '/s', '/c', script] };
    case 'bash':
    case 'zsh':
      // login shell so that PATH from the user profile is available (macOS GUI apps start with a minimal PATH)
      return { file: shell === 'bash' && platform === 'win32' ? 'bash.exe' : shell, args: ['-lc', script] };
    case 'sh':
      return { file: 'sh', args: ['-c', script] };
  }
}

/** Command that opens a visible terminal which runs the script and stays open. */
export function terminalCommand(shell: Shell, script: string, platform: NodeJS.Platform = process.platform): ShellCommand {
  const inner = shellCommand(shell, script, platform);
  if (platform === 'win32') {
    if (shell === 'powershell' || shell === 'pwsh') {
      const args = inner.args.filter((a) => a !== '-NonInteractive');
      args.splice(args.indexOf('-Command'), 0, '-NoExit');
      return { file: 'cmd.exe', args: ['/d', '/c', 'start', '""', inner.file, ...args] };
    }
    if (shell === 'cmd') return { file: 'cmd.exe', args: ['/d', '/c', 'start', '""', 'cmd.exe', '/k', script] };
    return { file: 'cmd.exe', args: ['/d', '/c', 'start', '""', inner.file, ...inner.args] };
  }
  if (platform === 'darwin') {
    const escaped = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return { file: 'osascript', args: ['-e', `tell application "Terminal" to do script "${escaped}"`, '-e', 'tell application "Terminal" to activate'] };
  }
  const keep = `${script}; exec ${typeof shell === 'string' && shell !== 'sh' ? shell : 'bash'}`;
  return { file: 'x-terminal-emulator', args: ['-e', inner.file, ...inner.args.slice(0, -1), keep] };
}
