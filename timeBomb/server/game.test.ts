import { describe, expect, it } from "vitest";
import type { Room, WireCard } from "@shared/types";
import { RoomStore } from "./store";
import { GameRuleError } from "./game";

function createLobby(playerCount: number, maxPlayers = playerCount): { store: RoomStore; room: Room } {
  const store = new RoomStore();
  const room = store.createRoom("Host", maxPlayers, "random");
  for (let index = 1; index < playerCount; index += 1) {
    store.joinRoom(room.roomCode, `P${index + 1}`);
  }
  return {
    store,
    room: store.getRoom(room.roomCode)!,
  };
}

function hostCredentials(room: Room) {
  const host = room.players.find((player) => player.id === room.hostPlayerId)!;
  return {
    playerId: host.id,
    sessionToken: host.sessionToken,
  };
}

function ackAllRoles(store: RoomStore, room: Room): Room {
  room.players.forEach((player) => {
    store.ackRole(room.roomCode, player.id, player.sessionToken);
  });
  return store.getRoom(room.roomCode)!;
}

function ackAllWires(store: RoomStore, room: Room): Room {
  room.players.forEach((player) => {
    store.ackWires(room.roomCode, player.id, player.sessionToken);
  });
  return store.getRoom(room.roomCode)!;
}

function startStandardGame(playerCount: number): { store: RoomStore; room: Room } {
  const { store, room } = createLobby(playerCount);
  const host = hostCredentials(room);
  store.startGame(room.roomCode, host.playerId, host.sessionToken);
  const afterRoleAck = ackAllRoles(store, store.getRoom(room.roomCode)!);
  const afterWireAck = ackAllWires(store, afterRoleAck);
  return {
    store,
    room: afterWireAck,
  };
}

function setSingleCard(room: Room, targetPlayerId: string, card: WireCard): void {
  if (!room.game) {
    throw new Error("game missing");
  }
  room.game.wiresByPlayer[targetPlayerId] = [
    {
      slotIndex: 0,
      card,
      isRevealed: false,
    },
  ];
}

function performCut(store: RoomStore, room: Room, targetPlayerId: string, card: WireCard): Room {
  if (!room.game?.currentCutterPlayerId) {
    throw new Error("cutter missing");
  }
  setSingleCard(room, targetPlayerId, card);
  store.cutWire(
    room.roomCode,
    targetPlayerId,
    room.players.find((player) => player.id === targetPlayerId)!.sessionToken,
    room.game.currentCutterPlayerId,
    targetPlayerId,
    0,
  );
  return store.getRoom(room.roomCode)!;
}

describe("timebomb game rules", () => {
  it("4人でゲーム開始できる", () => {
    const { store, room } = createLobby(4);
    const host = hostCredentials(room);
    store.startGame(room.roomCode, host.playerId, host.sessionToken);
    const started = store.getRoom(room.roomCode)!;
    expect(started.status).toBe("role_reveal");
    expect(Object.keys(started.game?.roleAssignments ?? {})).toHaveLength(4);
  });

  it("8人でゲーム開始できる", () => {
    const { store, room } = createLobby(8);
    const host = hostCredentials(room);
    store.startGame(room.roomCode, host.playerId, host.sessionToken);
    const started = store.getRoom(room.roomCode)!;
    expect(started.status).toBe("role_reveal");
    expect(Object.keys(started.game?.roleAssignments ?? {})).toHaveLength(8);
  });

  it("役職未配布がある人数で正しく配布される", () => {
    const { store, room } = createLobby(4);
    const host = hostCredentials(room);
    store.startGame(room.roomCode, host.playerId, host.sessionToken);
    const started = store.getRoom(room.roomCode)!;
    expect(started.game?.initialRoleDeck).toHaveLength(5);
    expect(Object.keys(started.game?.roleAssignments ?? {})).toHaveLength(4);
  });

  it("名前重複で参加拒否される", () => {
    const store = new RoomStore();
    const room = store.createRoom("Alice", 5, "random");
    expect(() => store.joinRoom(room.roomCode, "Alice")).toThrow(GameRuleError);
  });

  it("開始後参加できない", () => {
    const { store, room } = createLobby(4);
    const host = hostCredentials(room);
    store.startGame(room.roomCode, host.playerId, host.sessionToken);
    expect(() => store.joinRoom(room.roomCode, "Late")).toThrow(GameRuleError);
  });

  it("ホストだけが役職配り直しできる", () => {
    const { store, room } = createLobby(4);
    const host = hostCredentials(room);
    store.startGame(room.roomCode, host.playerId, host.sessionToken);
    const nonHost = room.players.find((player) => player.id !== room.hostPlayerId)!;
    expect(() => store.rerollRoles(room.roomCode, nonHost.id, nonHost.sessionToken)).toThrow(GameRuleError);
    expect(() => store.rerollRoles(room.roomCode, host.playerId, host.sessionToken)).not.toThrow();
  });

  it("BOOM公開で即終了する", () => {
    const { store, room } = startStandardGame(4);
    const target = room.players.find((player) => player.id !== room.game?.currentCutterPlayerId)!;
    const updated = performCut(store, room, target.id, "boom");
    expect(updated.status).toBe("finished");
    expect(updated.game?.winnerTeam).toBe("bomber");
    expect(updated.game?.finishReason).toBe("boom");
  });

  it("解除全達成で即終了する", () => {
    const { store, room } = startStandardGame(4);
    if (!room.game) {
      throw new Error("game missing");
    }
    room.game.requiredDefuseTotal = 1;
    room.game.defuseFoundCount = 0;
    const target = room.players.find((player) => player.id !== room.game?.currentCutterPlayerId)!;
    const updated = performCut(store, room, target.id, "defuse");
    expect(updated.status).toBe("finished");
    expect(updated.game?.winnerTeam).toBe("time_police");
    expect(updated.game?.finishReason).toBe("all_defused");
  });

  it("4ラウンド終了でボマー団勝利になる", () => {
    const { store, room } = startStandardGame(4);
    if (!room.game) {
      throw new Error("game missing");
    }

    room.game.currentRound = 4;
    room.game.cutCountInRound = room.players.length - 1;
    room.game.requiredDefuseTotal = 10;
    room.game.defuseFoundCount = 0;

    const target = room.players.find((player) => player.id !== room.game?.currentCutterPlayerId)!;
    const updated = performCut(store, room, target.id, "silent");
    expect(updated.status).toBe("finished");
    expect(updated.game?.winnerTeam).toBe("bomber");
    expect(updated.game?.finishReason).toBe("round_limit");
  });

  it("同端末リロード復帰できる", () => {
    const { store, room } = createLobby(4);
    const reconnecting = room.players[2]!;
    store.disconnect({
      roomCode: room.roomCode,
      playerId: reconnecting.id,
      sessionToken: reconnecting.sessionToken,
    });
    const updated = store.reconnect(room.roomCode, reconnecting.id, reconnecting.sessionToken);
    const state = store.getClientState(updated, reconnecting.id);
    expect(state.privateState.role).toBeNull();
    expect(state.publicState.players.find((player) => player.id === reconnecting.id)?.isConnected).toBe(true);
  });
});
