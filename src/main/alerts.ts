import type { AlertRequest, PromptRequest } from '../shared/api';

/** A notification on screen. */
export interface ShownNotification {
  close(): void;
}

export interface AlertDeps {
  /** Shows a form in the launcher window (the alert is a form without fields). */
  window: (request: PromptRequest) => Promise<Record<string, string> | undefined>;
  /** Closes the window of an alert, or drops it from the queue. */
  dismissWindow: (id: number) => void;
  /** Shows a system notification; undefined when notifications are not available. */
  notification: (options: { title: string; body: string; onClick: () => void }) => ShownNotification | undefined;
  /** URL of an icon file for the window. */
  icon: (file: string | undefined) => string | undefined;
}

/**
 * Shows the alerts of schedules: a small window over all the others (in the launcher window,
 * keyboard driven), or a system notification whose click shows the same window.
 */
export class Alerts {
  private notifications = new Map<number, ShownNotification>();
  /** Notifications clicked: their window is on screen. */
  private answering = new Set<number>();

  constructor(private readonly deps: AlertDeps) {}

  /** Resolves with the index of the choice, or undefined (dismissed, or a notification without choices). */
  show(request: AlertRequest): Promise<number | undefined> {
    if (request.style === 'window') return this.window(request);
    return new Promise((resolve) => {
      const hasChoices = request.choices.length > 0;
      // a click on the notification can run one of the choices directly, without the window
      const direct = request.clickChoice !== undefined && request.clickChoice < request.choices.length ? request.clickChoice : undefined;
      const hint = direct !== undefined ? `Click: ${request.choices[direct]}` : hasChoices ? `Click to choose: ${request.choices.join(' · ')}` : undefined;
      const body = [request.text, hint].filter(Boolean).join('\n');
      const shown = this.deps.notification({
        title: request.title,
        body,
        onClick: () => {
          if (!this.notifications.delete(request.id)) return; // already answered or closed
          if (direct !== undefined) return resolve(direct);
          this.answering.add(request.id);
          void this.window(request)
            .then(resolve)
            .finally(() => this.answering.delete(request.id));
        },
      });
      // no notifications on this system: the window instead, so that the choice is not lost
      if (!shown) return void this.window(request).then(resolve);
      if (!hasChoices) return resolve(undefined); // it only informs
      this.notifications.set(request.id, shown);
    });
  }

  private async window(r: AlertRequest): Promise<number | undefined> {
    const answer = await this.deps.window({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      icon: this.deps.icon(r.icon),
      fields: [],
      submitLabel: 'OK',
      alert: { text: r.text, choices: r.choices, defaultChoice: r.defaultChoice, deadline: r.deadline },
    });
    const index = answer?.choice === undefined ? NaN : Number(answer.choice);
    return Number.isInteger(index) && index >= 0 && index < r.choices.length ? index : undefined;
  }

  /** True while the window of a clicked notification is on screen. */
  isAnswering(id: number): boolean {
    return this.answering.has(id);
  }

  close(id: number) {
    this.notifications.get(id)?.close();
    this.notifications.delete(id);
    this.deps.dismissWindow(id);
  }
}
