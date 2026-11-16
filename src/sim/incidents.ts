/**
 * Groups alerts that belong together, so the ground team reads one incident
 * instead of a burst of notifications.
 */
import type { Cause } from './cause';

export interface Alert {
  id: string;
  crew: string;
  /** Simulation second at which the alert was raised on board. */
  createdAt: number;
  cause: Cause;
  title: string;
  detail: string;
}

export interface Incident {
  id: string;
  cause: Cause;
  crew: string[];
  firstAt: number;
  lastAt: number;
  alerts: Alert[];
  /** Alerts folded into this incident after the first. */
  suppressed: number;
}

/** Alerts this close in time can share an incident. */
export const CORRELATION_SECONDS = 60;

export function correlate(alerts: Alert[]): Incident[] {
  const incidents: Incident[] = [];
  for (const alert of [...alerts].sort((a, b) => a.createdAt - b.createdAt)) {
    const match = incidents.find(
      (incident) =>
        alert.createdAt - incident.lastAt <= CORRELATION_SECONDS &&
        incident.cause === alert.cause &&
        // A cabin-wide cause links different people; any other cause links one person's alerts.
        (alert.cause === 'environment' || incident.crew.includes(alert.crew)),
    );
    if (match) {
      match.alerts.push(alert);
      match.lastAt = alert.createdAt;
      match.suppressed += 1;
      if (!match.crew.includes(alert.crew)) match.crew.push(alert.crew);
    } else {
      incidents.push({
        id: `inc-${alert.id}`,
        cause: alert.cause,
        crew: [alert.crew],
        firstAt: alert.createdAt,
        lastAt: alert.createdAt,
        alerts: [alert],
        suppressed: 0,
      });
    }
  }
  return incidents;
}
