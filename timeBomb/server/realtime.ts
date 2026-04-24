import type express from "express";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, PlayerIdentity, ServerMessage } from "@shared/types";
import { RoomStore } from "./store";
import { GameRuleError } from "./game";

export function attachRealtimeServer(_app: express.Express, httpServer: HttpServer): void {
  const wss = new WebSocketServer({ server: httpServer });
  const roomStore = new RoomStore();
  const sockets = new Map<string, Set<WebSocket>>();
  const socketIdentity = new WeakMap<WebSocket, PlayerIdentity | null>();

  function addSocketToRoom(roomCode: string, socket: WebSocket): void {
    const key = roomCode.toUpperCase();
    if (!sockets.has(key)) {
      sockets.set(key, new Set());
    }
    sockets.get(key)?.add(socket);
  }

  function removeSocketFromRoom(roomCode: string, socket: WebSocket): void {
    const key = roomCode.toUpperCase();
    const roomSockets = sockets.get(key);
    roomSockets?.delete(socket);
    if (roomSockets?.size === 0) {
      sockets.delete(key);
    }
  }

  function send(socket: WebSocket, message: ServerMessage): void {
    socket.send(JSON.stringify(message));
  }

  function broadcastRoomState(roomCode: string): void {
    const room = roomStore.getRoom(roomCode);
    if (!room) {
      return;
    }

    const roomSockets = sockets.get(room.roomCode);
    if (!roomSockets) {
      return;
    }

    roomSockets.forEach((socket) => {
      const identity = socketIdentity.get(socket);
      if (!identity || identity.roomCode !== room.roomCode) {
        return;
      }

      const state = roomStore.getClientState(room, identity.playerId);
      send(socket, {
        type: "room:state",
        payload: {
          me: identity,
          publicState: state.publicState,
          privateState: state.privateState,
        },
      });
    });
  }

  function handleMessage(socket: WebSocket, rawData: string): void {
    let message: ClientMessage;

    try {
      message = JSON.parse(rawData) as ClientMessage;
    } catch {
      send(socket, { type: "room:error", payload: { message: "不正なメッセージ形式です。" } });
      return;
    }

    try {
      switch (message.type) {
        case "room:create": {
          const room = roomStore.createRoom(message.payload.name, message.payload.maxPlayers, message.payload.initialCutterMode);
          const host = room.players[0];
          const identity = {
            roomCode: room.roomCode,
            playerId: host.id,
            sessionToken: host.sessionToken,
          };
          socketIdentity.set(socket, identity);
          addSocketToRoom(room.roomCode, socket);
          broadcastRoomState(room.roomCode);
          return;
        }
        case "room:join": {
          const room = roomStore.joinRoom(message.payload.roomCode, message.payload.name);
          const player = room.players.at(-1);
          if (!player) {
            throw new Error("参加プレイヤーの取得に失敗しました。");
          }
          const identity = {
            roomCode: room.roomCode,
            playerId: player.id,
            sessionToken: player.sessionToken,
          };
          socketIdentity.set(socket, identity);
          addSocketToRoom(room.roomCode, socket);
          broadcastRoomState(room.roomCode);
          return;
        }
        case "room:reconnect": {
          const room = roomStore.reconnect(message.payload.roomCode, message.payload.playerId, message.payload.sessionToken);
          const identity = {
            roomCode: room.roomCode,
            playerId: message.payload.playerId,
            sessionToken: message.payload.sessionToken,
          };
          socketIdentity.set(socket, identity);
          addSocketToRoom(room.roomCode, socket);
          broadcastRoomState(room.roomCode);
          return;
        }
        case "game:start": {
          const room = roomStore.startGame(
            message.payload.roomCode,
            message.payload.playerId,
            message.payload.sessionToken,
            message.payload.initialCutterPlayerId,
          );
          broadcastRoomState(room.roomCode);
          return;
        }
        case "role:ack": {
          const room = roomStore.ackRole(message.payload.roomCode, message.payload.playerId, message.payload.sessionToken);
          broadcastRoomState(room.roomCode);
          return;
        }
        case "role:reroll": {
          const room = roomStore.rerollRoles(message.payload.roomCode, message.payload.playerId, message.payload.sessionToken);
          broadcastRoomState(room.roomCode);
          return;
        }
        case "wire:ack": {
          const room = roomStore.ackWires(message.payload.roomCode, message.payload.playerId, message.payload.sessionToken);
          broadcastRoomState(room.roomCode);
          return;
        }
        case "wire:reroll": {
          const room = roomStore.rerollWires(message.payload.roomCode, message.payload.playerId, message.payload.sessionToken);
          broadcastRoomState(room.roomCode);
          return;
        }
        case "game:cut_request": {
          const room = roomStore.cutWire(
            message.payload.roomCode,
            message.payload.playerId,
            message.payload.sessionToken,
            message.payload.actorPlayerId,
            message.payload.targetPlayerId,
            message.payload.slotIndex,
          );
          broadcastRoomState(room.roomCode);
          return;
        }
        default: {
          send(socket, { type: "room:error", payload: { message: "未対応の操作です。" } });
        }
      }
    } catch (error) {
      const messageText = error instanceof GameRuleError || error instanceof Error ? error.message : "不明なエラーが発生しました。";
      send(socket, { type: "room:error", payload: { message: messageText } });

      const identity = socketIdentity.get(socket);
      if (identity) {
        broadcastRoomState(identity.roomCode);
      }
    }
  }

  wss.on("connection", (socket) => {
    socketIdentity.set(socket, null);

    socket.on("message", (data) => {
      handleMessage(socket, data.toString());
    });

    socket.on("close", () => {
      const identity = socketIdentity.get(socket);
      if (identity) {
        removeSocketFromRoom(identity.roomCode, socket);
        roomStore.disconnect(identity);
        broadcastRoomState(identity.roomCode);
      }
    });
  });
}
