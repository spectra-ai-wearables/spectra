import type { Cause } from '../cause';
import type { SessionOptions } from '../generator';

export type CrewId = 'CDR' | 'PLT' | 'MS1' | 'MS2';

export interface CrewMember {
  id: CrewId;
  role: string;
  /** Seed of this person's session; fixed so every run plays the same. */
  seed: number;
}

/** Four roles, no names: the crew is as synthetic as its readings. */
export const CREW: CrewMember[] = [
  { id: 'CDR', role: 'Commander', seed: 50_003 },
  { id: 'PLT', role: 'Pilot', seed: 50_011 },
  { id: 'MS1', role: 'Mission specialist 1', seed: 50_024 },
  { id: 'MS2', role: 'Mission specialist 2', seed: 50_038 },
];

export interface Disturbance {
  from: number;
  to: number;
  /** Fraction of packets lost while the disturbance lasts. */
  loss: number;
  /** Share of the nominal rate that remains. */
  rateFactor: number;
}

export interface LinkPlan {
  /** Mission date, which sets the light time and any solar blackout. */
  missionDate: string;
  /** Whether the operator's link switch starts on. */
  startConnected: boolean;
  disturbance?: Disturbance;
}

export interface Scenario {
  id: string;
  label: string;
  description: string;
  /** What to watch for while it plays. */
  watch: string;
  /** The astronaut shown in detail when the scenario loads. */
  focus: CrewId;
  /** Changes applied to each astronaut's session; absent means a normal session. */
  crew: Partial<Record<CrewId, SessionOptions>>;
  link: LinkPlan;
  /** The on-board server restarts at this second. */
  restartAt?: number;
  /** Where the scenario's conditions come from. */
  basis: { kind: 'synthetic' | 'data'; text: string };
  expected: {
    alerts: Array<{ crew: CrewId; cause: Cause }>;
    incidents: number;
  };
}

/** Date of the data snapshots; the default mission date. */
export const DEFAULT_DATE = '2026-11-15';