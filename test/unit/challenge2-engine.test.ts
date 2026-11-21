/* Second adversarial round: the alert slot of a timed schedule. */
import { expect, it } from 'vitest';
import { Engine } from '../../src/main/engine';
import { ConfigSchema, type Schedule } from '../../src/shared/config';
import type { RunResult } from '../../src/main/runner';
import type { AlertRequest } from '../../src/shared/api';

const res = (): RunResult => ({ code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, killed: false });
const tick = () => new Promise((r) => setTimeout(r, 0));

it('once answered, the window no longer blocks the next alert while the chosen OTHER entry runs', async () => {
  let release!: () => void;
  const alerts: AlertRequest[] = [];
  const engine = new Engine({
    run: async (s) => (s === 'slow-b' ? new Promise((r) => (release = () => r(res()))) : res()),
    runAdmin: async () => res(),
    notify: () => undefined,
    confirm: async () => true,
    log: () => undefined,
    env: {},
    platform: 'win32',
    alert: async (r) => {
      alerts.push(r);
      return alerts.length === 1 ? 0 : undefined;
    },
    closeAlert: () => undefined,
  });
  engine.load(ConfigSchema.parse({ version: 2, trays: [{ id: 'a', label: 'A', action: 'go' }, { id: 'b', label: 'B', action: 'slow-b' }] }), 'C:\cfg');
  engine.start();
  const schedule: Schedule = { every: '1m', alert: { text: 'x', choices: [{ label: 'B', run: 'b' }] } };
  const first = engine.fireSchedule(engine.get('a')!, schedule);
  await tick();
  await tick(); // answered: B is running
  await engine.fireSchedule(engine.get('a')!, schedule); // the next minute: the alert is closed, A is idle
  expect(alerts).toHaveLength(2);
  release();
  await first;
});
