import type { PlayerIdentity, Room } from "@shared/types";
import {
  acknowledgeRole,
  acknowledgeRoundEnd,
  acknowledgeWires,
  createRoom,
  cutWire,
  disconnectPlayer,
  GameRuleError,
  getPrivateGameState,
  getPublicRoomState,
  joinRoom,
  leaveRoom,
  reconnectPlayer,
  readyForNext,
  rerollRoles,
  rerollWires,
  startGame,
} from "./game";

export class RoomStore {
  private readonly rooms = new Map<string, Room>();

  getRoom(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode.toUpperCase());
  }

  createRoom(hostName: string, maxPlayers: number, initialCutterMode: Room["initialCutterMode"]): Room {
    const room = createRoom(hostName, maxPlayers, initialCutterMode, new Set(this.rooms.keys()));
    this.rooms.set(room.roomCode, room);
    return room;
  }

  joinRoom(roomCode: string, name: string): Room {
    const room = this.requireRoom(roomCode);
    joinRoom(room, name);
    return room;
  }

  reconnect(roomCode: string, playerId: string, sessionToken: string): Room {
    const room = this.requireRoom(roomCode);
    reconnectPlayer(room, playerId, sessionToken);
    return room;
  }

  disconnect(identity: PlayerIdentity | null): void {
    if (!identity) {
      return;
    }
    const room = this.rooms.get(identity.roomCode);
    if (!room) {
      return;
    }
    disconnectPlayer(room, identity.playerId);
  }

  startGame(roomCode: string, playerId: string, sessionToken: string, initialCutterPlayerId?: string): Room {
    const room = this.requireRoom(roomCode);
    startGame(room, playerId, sessionToken, initialCutterPlayerId);
    return room;
  }

  rerollRoles(roomCode: string, playerId: string, sessionToken: string): Room {
    const room = this.requireRoom(roomCode);
    rerollRoles(room, playerId, sessionToken);
    return room;
  }

  ackRole(roomCode: string, playerId: string, sessionToken: string): Room {
    const room = this.requireRoom(roomCode);
    acknowledgeRole(room, playerId, sessionToken);
    return room;
  }

  rerollWires(roomCode: string, playerId: string, sessionToken: string): Room {
    const room = this.requireRoom(roomCode);
    rerollWires(room, playerId, sessionToken);
    return room;
  }

  ackWires(roomCode: string, playerId: string, sessionToken: string): Room {
    const room = this.requireRoom(roomCode);
    acknowledgeWires(room, playerId, sessionToken);
    return room;
  }

  cutWire(
    roomCode: string,
    playerId: string,
    sessionToken: string,
    actorPlayerId: string,
    targetPlayerId: string,
    slotIndex: number,
  ): Room {
    const room = this.requireRoom(roomCode);
    cutWire(room, playerId, sessionToken, actorPlayerId, targetPlayerId, slotIndex);
    return room;
  }

  ackRound(roomCode: string, playerId: string, sessionToken: string): Room {
    const room = this.requireRoom(roomCode);
    acknowledgeRoundEnd(room, playerId, sessionToken);
    return room;
  }

  readyForNext(roomCode: string, playerId: string, sessionToken: string): Room {
    const room = this.requireRoom(roomCode);
    readyForNext(room, playerId, sessionToken);
    return room;
  }

  leave(roomCode: string, playerId: string, sessionToken: string): Room {
    const room = this.requireRoom(roomCode);
    leaveRoom(room, playerId, sessionToken);
    return room;
  }

  getClientState(room: Room, playerId: string) {
    return {
      publicState: getPublicRoomState(room),
      privateState: getPrivateGameState(room, playerId),
    };
  }

  private requireRoom(roomCode: string): Room {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) {
      throw new GameRuleError("ルームが見つかりません。");
    }
    return room;
  }
}
