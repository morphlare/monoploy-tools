export interface PropertyDefinition {
  id: string;
  type: "property" | "station" | "utility";
  name: string;
  colorGroup?: number;
  purchasePrice: number;
  purchasePriceInferred?: boolean;
  mortgagePrice: number;
  rent?: {
    land?: number;
    house1?: number;
    house2?: number;
    house3?: number;
    house4?: number;
    hotel?: number;
    singleUtilityDiceMultiplier?: number;
    bothUtilitiesDiceMultiplier?: number;
  };
  buildingCost?: { house: number; hotel: number };
  rentByOwnedStationCount?: Record<string, number>;
}
export interface Player {
  id: string;
  name: string;
  balance: number;
  color: number;
  online?: boolean;
  bankrupt?: boolean;
}
export interface PropertyState {
  id: string;
  ownerId: string | null;
  houses: number;
  hotel: boolean;
  mortgaged: boolean;
}
export interface Transaction {
  id: string;
  from: string;
  to: string;
  amount: number;
  reason: string;
}
export interface GameEvent {
  id: string;
  actorId: string;
  type: string;
  text: string;
  at: number;
  transactions: Transaction[];
  undone?: boolean;
}
export const MAX_PLAYERS = 8;
export type DiceCount = 1 | 2;
export interface GameMode {
  type: "timed" | "survival";
  durationMinutes: number;
  targetCash: number;
}
export const DEFAULT_GAME_MODE: GameMode = { type: "timed", durationMinutes: 60, targetCash: 30000 };
export type DiceValues = [number] | [number, number];
export interface DiceRoll {
  id: string;
  playerId: string;
  values: DiceValues;
  total: number;
  manual: boolean;
  at: number;
}
export interface Room {
  code: string;
  hostId: string;
  status: "lobby" | "playing" | "finished" | "closed";
  mode: GameMode;
  startedAt?: number;
  startedPlayerCount?: number;
  deadline?: number;
  winnerIds?: string[];
  finishReason?: string;
  initialMoney: number;
  diceCount: DiceCount;
  players: Player[];
  properties: Record<string, PropertyState>;
  events: GameEvent[];
  dice: DiceRoll[];
  revision: number;
  updatedAt: number;
  undoActorId?: string;
  undoEventId?: string;
}
export type ActionType =
  | "settings"
  | "start"
  | "restart"
  | "transfer"
  | "buy"
  | "sell"
  | "end"
  | "mortgage"
  | "redeem"
  | "build"
  | "demolish"
  | "hotel"
  | "rent"
  | "roll"
  | "undo"
  | "balance"
  | "kick";
export interface Action {
  type: ActionType;
  propertyId?: string;
  playerId?: string;
  from?: string;
  to?: string;
  amount?: number;
  values?: DiceValues;
  diceId?: string;
  count?: number;
}
export interface Session {
  code: string;
  playerId: string;
  token: string;
}
export interface Reply {
  ok: boolean;
  error?: string;
  session?: Session;
  room?: Room;
}
