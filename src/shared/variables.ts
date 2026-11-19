export interface VariableContext {
  variables: Record<string, string>;
  env: Record<string, string | undefined>;
  configDir: string;
}

const PATTERN = /\$\{(env:)?([A-Za-z0-9_]+)\}/g;

/**
 * Replaces ${NAME}, ${env:NAME} and ${configDir}. Unknown names are left untouched
 * so that shell syntax like ${foo} in bash scripts keeps working.
 * Variables may reference other variables (max depth 5).
 */
export function expand(text: string, ctx: VariableContext, depth = 0): string {
  if (depth > 5 || !text.includes('${')) return text;
  return text.replace(PATTERN, (match, envPrefix: string | undefined, name: string) => {
    if (envPrefix) return ctx.env[name] ?? '';
    if (name === 'configDir') return ctx.configDir;
    const value = ctx.variables[name];
    return value === undefined ? match : expand(value, ctx, depth + 1);
  });
}
