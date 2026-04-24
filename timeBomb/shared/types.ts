export type RoomStatus =
  | "lobby"
  | "role_reveal"
  | "wire_reveal"
  | "playing"
  | "round_end"
  | "finished";

export type InitialCutterMode = "random" | "host_select";
export type RoleCard = "time_police" | "bomber";
export type WireCard = "defuse" | "boom" | "silent";
export type WinnerTeam = "time_police" | "bomber" | null;
export type FinishReason = "boom" | "all_defused" | "round_limit" | null;

export interface PlayerIdentity {
  roomCode: string;
  playerId: string;
  sessionToken: string;
}

export interface Player {
  id: string;
  name: string;
  sessionToken: string;
  isConnected: boolean;
  joinedAt: number;
}

export interface WireSlot {
  slotIndex: number;
  card: WireCard;
  isRevealed: boolean;
}

export interface PublicWireSlot {
  slotIndex: number;
  isRevealed: boolean;
  revealedCard: WireCard | null;
}

export interface PublicEvent {
  type: "cut_result" | "round_end" | "game_end";
  round: number;
  actorPlayerId: string | null;
  targetPlayerId: string | null;
  slotIndex: number | null;
  resultCard: WireCard | null;
  timestamp: number;
}

export interface GameState {
  playerOrder: string[];
  currentRound: 1 | 2 | 3 | 4;
  currentCutterPlayerId: string | null;
  configuredInitialCutterPlayerId: string | null;
  lastCutPlayerId: string | null;
  cutCountInRound: number;
  requiredDefuseTotal: number;
  defuseFoundCount: number;
  winnerTeam: WinnerTeam;
  finishReason: FinishReason;
  initialRoleDeck: RoleCard[];
  roleAssignments: Record<string, RoleCard>;
  roleRevealAckPlayerIds: string[];
  wiresByPlayer: Record<string, WireSlot[]>;
  roundDeck: WireCard[];
  wireRevealAckPlayerIds: string[];
  roundEndAckPlayerIds: string[];
  lastRoundEnded: 1 | 2 | 3 | null;
  readyForNextPlayerIds: string[];
  publicEvents: PublicEvent[];
}

export interface Room {
  roomCode: string;
  hostPlayerId: string;
  maxPlayers: number;
  initialCutterMode: InitialCutterMode;
  status: RoomStatus;
  players: Player[];
  game: GameState | null;
  createdAt: number;
  updatedAt: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  isConnected: boolean;
  joinedAt: number;
}

export interface PublicGameState {
  playerOrder: string[];
  currentRound: 1 | 2 | 3 | 4;
  currentCutterPlayerId: string | null;
  cutCountInRound: number;
  requiredDefuseTotal: number;
  defuseFoundCount: number;
  winnerTeam: WinnerTeam;
  finishReason: FinishReason;
  roleRevealAckPlayerIds: string[];
  wireRevealAckPlayerIds: string[];
  roundEndAckPlayerIds: string[];
  lastRoundEnded: 1 | 2 | 3 | null;
  readyForNextPlayerIds: string[];
  publicEvents: PublicEvent[];
  publicWiresByPlayer: Record<string, PublicWireSlot[]>;
  roleAssignmentsAtEnd: Record<string, RoleCard> | null;
}

export interface PrivateGameState {
  role: RoleCard | null;
  wires: WireSlot[];
}

export interface PublicRoomState {
  roomCode: string;
  hostPlayerId: string;
  maxPlayers: number;
  initialCutterMode: InitialCutterMode;
  status: RoomStatus;
  players: PublicPlayer[];
  game: PublicGameState | null;
}

export interface ClientRoomState {
  me: PlayerIdentity | null;
  publicState: PublicRoomState | null;
  privateState: PrivateGameState | null;
  errorMessage: string | null;
}

export interface RequestEnvelope<TType extends string, TPayload> {
  type: TType;
  payload: TPayload;
}

export type ClientMessage =
  | RequestEnvelope<
      "room:create",
      {
        name: string;
        maxPlayers: number;
        initialCutterMode: InitialCutterMode;
      }
    >
  | RequestEnvelope<
      "room:join",
      {
        roomCode: string;
        name: string;
      }
    >
  | RequestEnvelope<
      "room:reconnect",
      {
        roomCode: string;
        playerId: string;
        sessionToken: string;
      }
    >
  | RequestEnvelope<
      "game:start",
      {
        roomCode: string;
        playerId: string;
        sessionToken: string;
        initialCutterPlayerId?: string;
      }
    >
  | RequestEnvelope<
      "role:ack",
      {
        roomCode: string;
        playerId: string;
        sessionToken: string;
      }
    >
  | RequestEnvelope<
      "role:reroll",
      {
        roomCode: string;
        playerId: string;
        sessionToken: string;
      }
    >
  | RequestEnvelope<
      "wire:ack",
      {
        roomCode: string;
        playerId: string;
        sessionToken: string;
      }
    >
  | RequestEnvelope<
      "wire:reroll",
      {
        roomCode: string;
        playerId: string;
        sessionToken: string;
      }
    >
  | RequestEnvelope<
      "game:cut_request",
      {
        roomCode: string;
        playerId: string;
        sessionToken: string;
        actorPlayerId: string;
        targetPlayerId: string;
        slotIndex: number;
      }
    >
  | RequestEnvelope<
      "round:ack",
      {
        roomCode: string;
        playerId: string;
        sessionToken: string;
      }
    >
  | RequestEnvelope<
      "game:ready_for_next",
      {
        roomCode: string;
        playerId: string;
        sessionToken: string;
      }
    >
  | RequestEnvelope<
      "game:leave",
      {
        roomCode: string;
        playerId: string;
        sessionToken: string;
      }
    >;

export type ServerMessage =
  | RequestEnvelope<
      "room:state",
      {
        me: PlayerIdentity | null;
        publicState: PublicRoomState;
        privateState: PrivateGameState;
      }
    >
  | RequestEnvelope<
      "room:error",
      {
        message: string;
      }
    >;
