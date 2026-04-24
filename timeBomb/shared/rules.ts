import type { RoleCard, WireCard } from "./types";

export interface RoleConfig {
  timePolice: number;
  bombers: number;
  dealt: number;
}

export interface WireConfig {
  defuse: number;
  boom: number;
  silent: number;
  total: number;
}

const roleConfigs: Record<number, RoleConfig> = {
  4: { timePolice: 3, bombers: 2, dealt: 4 },
  5: { timePolice: 3, bombers: 2, dealt: 5 },
  6: { timePolice: 4, bombers: 2, dealt: 6 },
  7: { timePolice: 5, bombers: 3, dealt: 7 },
  8: { timePolice: 5, bombers: 3, dealt: 8 },
};

const wireConfigs: Record<number, WireConfig> = {
  4: { defuse: 4, boom: 1, silent: 15, total: 20 },
  5: { defuse: 5, boom: 1, silent: 19, total: 25 },
  6: { defuse: 6, boom: 1, silent: 23, total: 30 },
  7: { defuse: 7, boom: 1, silent: 27, total: 35 },
  8: { defuse: 8, boom: 1, silent: 31, total: 40 },
};

export function getRoleConfig(playerCount: number): RoleConfig {
  const config = roleConfigs[playerCount];
  if (!config) {
    throw new Error("4〜8人のみ対応しています。");
  }
  return config;
}

export function getWireConfig(playerCount: number): WireConfig {
  const config = wireConfigs[playerCount];
  if (!config) {
    throw new Error("4〜8人のみ対応しています。");
  }
  return config;
}

export function createRoleDeck(playerCount: number): RoleCard[] {
  const config = getRoleConfig(playerCount);
  return [
    ...Array.from({ length: config.timePolice }, () => "time_police" as const),
    ...Array.from({ length: config.bombers }, () => "bomber" as const),
  ];
}

export function createInitialWireDeck(playerCount: number): WireCard[] {
  const config = getWireConfig(playerCount);
  return [
    ...Array.from({ length: config.defuse }, () => "defuse" as const),
    ...Array.from({ length: config.boom }, () => "boom" as const),
    ...Array.from({ length: config.silent }, () => "silent" as const),
  ];
}

export function getCardsPerPlayer(round: 1 | 2 | 3 | 4): number {
  return 6 - round;
}
