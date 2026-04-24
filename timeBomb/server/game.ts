import crypto from "node:crypto";
import { createInitialWireDeck, createRoleDeck, getCardsPerPlayer, getWireConfig } from "@shared/rules";
import type {
  FinishReason,
  GameState,
  Player,
  PrivateGameState,
  PublicGameState,
  PublicRoomState,
  PublicWireSlot,
  RoleCard,
  Room,
  WireCard,
  WireSlot,
} from "@shared/types";

export class GameRuleError extends Error {}

function now(): number {
  return Date.now();
}

export function createRoomCode(existingCodes: Set<string>): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 2000; i += 1) {
    const roomCode = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    if (!existingCodes.has(roomCode)) {
      return roomCode;
    }
  }
  throw new Error("参加コードの生成に失敗しました。");
}

export function createPlayer(name: string): Player {
  return {
    id: crypto.randomUUID(),
    name: sanitizeName(name),
    sessionToken: crypto.randomUUID(),
    isConnected: true,
    joinedAt: now(),
  };
}

export function createRoom(hostName: string, maxPlayers: number, initialCutterMode: Room["initialCutterMode"], existingCodes: Set<string>): Room {
  if (maxPlayers < 4 || maxPlayers > 8) {
    throw new GameRuleError("4〜8人で作成してください。");
  }
  const hostPlayer = createPlayer(hostName);
  const timestamp = now();
  return {
    roomCode: createRoomCode(existingCodes),
    hostPlayerId: hostPlayer.id,
    maxPlayers,
    initialCutterMode,
    status: "lobby",
    players: [hostPlayer],
    game: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function sanitizeName(rawName: string): string {
  const name = rawName.trim();
  if (!name) {
    throw new GameRuleError("名前を入力してください。");
  }
  return name;
}

export function assertPlayerAuth(room: Room, playerId: string, sessionToken: string): Player {
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player || player.sessionToken !== sessionToken) {
    throw new GameRuleError("認証に失敗しました。再接続してください。");
  }
  return player;
}

function shuffle<T>(items: T[]): T[] {
  const clone = [...items];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }
  return clone;
}

function buildRoleAssignments(players: Player[]): { roleDeck: RoleCard[]; assignments: Record<string, RoleCard> } {
  const deck = shuffle(createRoleDeck(players.length));
  const assignments: Record<string, RoleCard> = {};
  players.forEach((player, index) => {
    const role = deck[index];
    if (!role) {
      throw new Error("役職配布に失敗しました。");
    }
    assignments[player.id] = role;
  });
  return { roleDeck: deck, assignments };
}

function dealRoundDeck(playerIds: string[], roundDeck: WireCard[], round: 1 | 2 | 3 | 4): Record<string, WireSlot[]> {
  const cardsPerPlayer = getCardsPerPlayer(round);
  const shuffledDeck = shuffle(roundDeck);
  const expectedCardCount = playerIds.length * cardsPerPlayer;
  if (shuffledDeck.length !== expectedCardCount) {
    throw new Error("導線デッキ枚数が不正です。");
  }

  const wiresByPlayer: Record<string, WireSlot[]> = {};
  let cursor = 0;

  playerIds.forEach((playerId) => {
    wiresByPlayer[playerId] = Array.from({ length: cardsPerPlayer }, (_, slotIndex) => {
      const card = shuffledDeck[cursor];
      cursor += 1;
      if (!card) {
        throw new Error("導線配布に失敗しました。");
      }
      return {
        slotIndex,
        card,
        isRevealed: false,
      };
    });
  });

  return wiresByPlayer;
}

function collectUnrevealedCards(game: GameState): WireCard[] {
  return Object.values(game.wiresByPlayer)
    .flat()
    .filter((slot) => !slot.isRevealed)
    .map((slot) => slot.card);
}

function makeInitialGameState(room: Room, initialCutterPlayerId: string | null): GameState {
  const playerOrder = room.players.map((player) => player.id);
  const { roleDeck, assignments } = buildRoleAssignments(room.players);
  const wireConfig = getWireConfig(room.players.length);

  return {
    playerOrder,
    currentRound: 1,
    currentCutterPlayerId: null,
    configuredInitialCutterPlayerId: initialCutterPlayerId,
    lastCutPlayerId: null,
    cutCountInRound: 0,
    requiredDefuseTotal: wireConfig.defuse,
    defuseFoundCount: 0,
    winnerTeam: null,
    finishReason: null,
    initialRoleDeck: roleDeck,
    roleAssignments: assignments,
    roleRevealAckPlayerIds: [],
    wiresByPlayer: {},
    roundDeck: createInitialWireDeck(room.players.length),
    wireRevealAckPlayerIds: [],
    roundEndAckPlayerIds: [],
    lastRoundEnded: null,
    readyForNextPlayerIds: [],
    publicEvents: [],
  };
}

function startRound(game: GameState): void {
  game.wiresByPlayer = dealRoundDeck(game.playerOrder, game.roundDeck, game.currentRound);
  game.wireRevealAckPlayerIds = [];
}

export function startGame(room: Room, playerId: string, sessionToken: string, initialCutterPlayerId?: string): void {
  assertPlayerAuth(room, playerId, sessionToken);
  if (room.hostPlayerId !== playerId) {
    throw new GameRuleError("ホストだけがゲーム開始できます。");
  }
  if (room.status !== "lobby") {
    throw new GameRuleError("すでにゲームが開始されています。");
  }
  if (room.players.length < 4 || room.players.length > 8) {
    throw new GameRuleError("4〜8人で開始してください。");
  }

  let selectedInitialCutterId: string | null = null;
  if (room.initialCutterMode === "host_select") {
    if (!initialCutterPlayerId || !room.players.some((player) => player.id === initialCutterPlayerId)) {
      throw new GameRuleError("初手ニッパー係を選択してください。");
    }
    selectedInitialCutterId = initialCutterPlayerId;
  }

  room.game = makeInitialGameState(room, selectedInitialCutterId);
  room.status = "role_reveal";
  room.updatedAt = now();
}

export function joinRoom(room: Room, name: string): Player {
  if (room.status !== "lobby") {
    throw new GameRuleError("ゲーム開始後は参加できません。");
  }
  if (room.players.length >= room.maxPlayers) {
    throw new GameRuleError("満席です。");
  }
  const sanitizedName = sanitizeName(name);
  if (room.players.some((player) => player.name.toLowerCase() === sanitizedName.toLowerCase())) {
    throw new GameRuleError("同じ名前は使えません。");
  }

  const player = createPlayer(sanitizedName);
  room.players.push(player);
  room.updatedAt = now();
  return player;
}

export function reconnectPlayer(room: Room, playerId: string, sessionToken: string): Player {
  const player = assertPlayerAuth(room, playerId, sessionToken);
  player.isConnected = true;
  room.updatedAt = now();
  return player;
}

export function disconnectPlayer(room: Room, playerId: string): void {
  const player = room.players.find((entry) => entry.id === playerId);
  if (player) {
    player.isConnected = false;
    room.updatedAt = now();
  }
}

export function rerollRoles(room: Room, playerId: string, sessionToken: string): void {
  assertPlayerAuth(room, playerId, sessionToken);
  if (room.hostPlayerId !== playerId) {
    throw new GameRuleError("ホストだけが役職配布をやり直せます。");
  }
  if (room.status !== "role_reveal" || !room.game) {
    throw new GameRuleError("今は役職配布をやり直せません。");
  }

  const { roleDeck, assignments } = buildRoleAssignments(room.players);
  room.game.initialRoleDeck = roleDeck;
  room.game.roleAssignments = assignments;
  room.game.roleRevealAckPlayerIds = [];
  room.updatedAt = now();
}

export function acknowledgeRole(room: Room, playerId: string, sessionToken: string): void {
  assertPlayerAuth(room, playerId, sessionToken);
  if (room.status !== "role_reveal" || !room.game) {
    throw new GameRuleError("今は役職確認フェーズではありません。");
  }

  if (!room.game.roleRevealAckPlayerIds.includes(playerId)) {
    room.game.roleRevealAckPlayerIds.push(playerId);
  }

  if (room.game.roleRevealAckPlayerIds.length === room.players.length) {
    startRound(room.game);
    room.status = "wire_reveal";
  }

  room.updatedAt = now();
}

export function rerollWires(room: Room, playerId: string, sessionToken: string): void {
  assertPlayerAuth(room, playerId, sessionToken);
  if (room.hostPlayerId !== playerId) {
    throw new GameRuleError("ホストだけが導線配布をやり直せます。");
  }
  if (room.status !== "wire_reveal" || !room.game) {
    throw new GameRuleError("今は導線配布をやり直せません。");
  }

  startRound(room.game);
  room.updatedAt = now();
}

export function acknowledgeWires(room: Room, playerId: string, sessionToken: string): void {
  assertPlayerAuth(room, playerId, sessionToken);
  if (room.status !== "wire_reveal" || !room.game) {
    throw new GameRuleError("今は導線確認フェーズではありません。");
  }

  if (!room.game.wireRevealAckPlayerIds.includes(playerId)) {
    room.game.wireRevealAckPlayerIds.push(playerId);
  }

  if (room.game.wireRevealAckPlayerIds.length === room.players.length) {
    if (!room.game.currentCutterPlayerId) {
      if (room.initialCutterMode === "random") {
        room.game.currentCutterPlayerId = room.game.playerOrder[Math.floor(Math.random() * room.game.playerOrder.length)] ?? null;
      } else {
        room.game.currentCutterPlayerId = room.game.configuredInitialCutterPlayerId;
      }
    }
    room.status = "playing";
  }

  room.updatedAt = now();
}

function finishGame(room: Room, winnerTeam: Exclude<GameState["winnerTeam"], null>, finishReason: Exclude<FinishReason, null>): void {
  if (!room.game) {
    return;
  }
  room.game.winnerTeam = winnerTeam;
  room.game.finishReason = finishReason;
  room.game.publicEvents.push({
    type: "game_end",
    round: room.game.currentRound,
    actorPlayerId: null,
    targetPlayerId: null,
    slotIndex: null,
    resultCard: null,
    timestamp: now(),
  });
  room.status = "finished";
}

export function cutWire(
  room: Room,
  requestingPlayerId: string,
  sessionToken: string,
  actorPlayerId: string,
  targetPlayerId: string,
  slotIndex: number,
): void {
  assertPlayerAuth(room, requestingPlayerId, sessionToken);
  if (room.status !== "playing" || !room.game) {
    throw new GameRuleError("今はカードを切れません。");
  }
  if (requestingPlayerId !== targetPlayerId) {
    throw new GameRuleError("対象プレイヤー本人の端末で操作してください。");
  }
  if (room.game.currentCutterPlayerId !== actorPlayerId) {
    throw new GameRuleError("現在あなたの手番ではありません。");
  }
  if (actorPlayerId === targetPlayerId) {
    throw new GameRuleError("自分自身のカードは切れません。");
  }

  const targetSlots = room.game.wiresByPlayer[targetPlayerId];
  const targetSlot = targetSlots?.find((slot) => slot.slotIndex === slotIndex);

  if (!targetSlots || !targetSlot) {
    throw new GameRuleError("カードが見つかりません。");
  }
  if (targetSlot.isRevealed) {
    throw new GameRuleError("このカードはすでに公開されています。");
  }

  targetSlot.isRevealed = true;
  room.game.cutCountInRound += 1;
  room.game.lastCutPlayerId = targetPlayerId;
  room.game.publicEvents.push({
    type: "cut_result",
    round: room.game.currentRound,
    actorPlayerId,
    targetPlayerId,
    slotIndex,
    resultCard: targetSlot.card,
    timestamp: now(),
  });

  if (targetSlot.card === "defuse") {
    room.game.defuseFoundCount += 1;
  }

  if (targetSlot.card === "boom") {
    finishGame(room, "bomber", "boom");
    room.updatedAt = now();
    return;
  }

  if (room.game.defuseFoundCount === room.game.requiredDefuseTotal) {
    finishGame(room, "time_police", "all_defused");
    room.updatedAt = now();
    return;
  }

  if (room.game.cutCountInRound === room.players.length) {
    room.game.publicEvents.push({
      type: "round_end",
      round: room.game.currentRound,
      actorPlayerId,
      targetPlayerId,
      slotIndex,
      resultCard: targetSlot.card,
      timestamp: now(),
    });

    if (room.game.currentRound === 4) {
      finishGame(room, "bomber", "round_limit");
      room.updatedAt = now();
      return;
    }

    // ラウンド終了ack画面へ。全員のackを待ってから次ラウンドを配る
    // (次ラウンド配布前に他人の端末が覗かれて手札が露見するのを防ぐ)
    room.game.lastRoundEnded = room.game.currentRound as 1 | 2 | 3;
    room.game.roundEndAckPlayerIds = [];
    room.status = "round_end";
    room.updatedAt = now();
    return;
  }

  room.game.currentCutterPlayerId = targetPlayerId;
  room.updatedAt = now();
}

export function acknowledgeRoundEnd(room: Room, playerId: string, sessionToken: string): void {
  assertPlayerAuth(room, playerId, sessionToken);
  if (room.status !== "round_end" || !room.game) {
    throw new GameRuleError("今はラウンド終了確認フェーズではありません。");
  }

  if (!room.game.roundEndAckPlayerIds.includes(playerId)) {
    room.game.roundEndAckPlayerIds.push(playerId);
  }

  if (room.game.roundEndAckPlayerIds.length === room.players.length) {
    const nextRoundDeck = collectUnrevealedCards(room.game);
    const nextRound = (room.game.currentRound + 1) as 2 | 3 | 4;
    room.game.currentRound = nextRound;
    room.game.cutCountInRound = 0;
    room.game.roundDeck = nextRoundDeck;
    room.game.currentCutterPlayerId = room.game.lastCutPlayerId;
    room.game.roundEndAckPlayerIds = [];
    startRound(room.game);
    room.status = "wire_reveal";
  }

  room.updatedAt = now();
}

export function readyForNext(room: Room, playerId: string, sessionToken: string): void {
  assertPlayerAuth(room, playerId, sessionToken);
  if (room.status !== "finished" || !room.game) {
    throw new GameRuleError("ゲーム終了後のみ再戦準備ができます。");
  }

  if (!room.game.readyForNextPlayerIds.includes(playerId)) {
    room.game.readyForNextPlayerIds.push(playerId);
  }

  // 現時点で残っている全員が「準備完了」を押したらロビーへ戻す。
  // 既に抜けた人(leaveRoomで players から除かれた人)は数に入らない。
  const allReady = room.players.every((player) => room.game!.readyForNextPlayerIds.includes(player.id));
  if (allReady && room.players.length >= 1) {
    room.game = null;
    room.status = "lobby";
  }

  room.updatedAt = now();
}

export function leaveRoom(room: Room, playerId: string, sessionToken: string): void {
  assertPlayerAuth(room, playerId, sessionToken);

  const leavingIndex = room.players.findIndex((player) => player.id === playerId);
  if (leavingIndex === -1) {
    return;
  }

  const wasHost = room.hostPlayerId === playerId;
  room.players.splice(leavingIndex, 1);

  // 参加者が残っていればホスト引き継ぎ、居なければルーム自体は残骸になるが
  // 次の接続時に cleanup される想定(MVPでは明示削除しない)。
  if (wasHost && room.players.length > 0) {
    room.hostPlayerId = room.players[0].id;
  }

  // ゲーム状態から抜けた人の痕跡を掃除して、残ったメンバーで「準備完了」条件が満たされ
  // 得るようにする。finished フェーズ以外で抜けるケース(MVPでは想定薄)はロビー戻しで済ませる。
  if (room.game) {
    room.game.readyForNextPlayerIds = room.game.readyForNextPlayerIds.filter((id) => id !== playerId);
    room.game.roleRevealAckPlayerIds = room.game.roleRevealAckPlayerIds.filter((id) => id !== playerId);
    room.game.wireRevealAckPlayerIds = room.game.wireRevealAckPlayerIds.filter((id) => id !== playerId);
    room.game.roundEndAckPlayerIds = room.game.roundEndAckPlayerIds.filter((id) => id !== playerId);
    room.game.playerOrder = room.game.playerOrder.filter((id) => id !== playerId);
    delete room.game.roleAssignments[playerId];
    delete room.game.wiresByPlayer[playerId];

    if (room.status === "finished") {
      // 残ったメンバーが全員「準備完了」なら即ロビーへ。
      const allReady =
        room.players.length > 0 &&
        room.players.every((player) => room.game!.readyForNextPlayerIds.includes(player.id));
      if (allReady) {
        room.game = null;
        room.status = "lobby";
      }
    } else {
      // ゲーム進行中に抜けた場合はロビーに戻す(MVP簡略化)。
      room.game = null;
      room.status = "lobby";
    }
  }

  room.updatedAt = now();
}

export function getPublicRoomState(room: Room): PublicRoomState {
  return {
    roomCode: room.roomCode,
    hostPlayerId: room.hostPlayerId,
    maxPlayers: room.maxPlayers,
    initialCutterMode: room.initialCutterMode,
    status: room.status,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      isConnected: player.isConnected,
      joinedAt: player.joinedAt,
    })),
    game: room.game ? getPublicGameState(room) : null,
  };
}

function getPublicGameState(room: Room): PublicGameState {
  const game = room.game;
  if (!game) {
    throw new Error("game state missing");
  }

  const publicWiresByPlayer: Record<string, PublicWireSlot[]> = {};
  for (const [playerId, slots] of Object.entries(game.wiresByPlayer)) {
    publicWiresByPlayer[playerId] = slots.map((slot) => ({
      slotIndex: slot.slotIndex,
      isRevealed: slot.isRevealed,
      revealedCard: slot.isRevealed ? slot.card : null,
    }));
  }

  return {
    playerOrder: game.playerOrder,
    currentRound: game.currentRound,
    currentCutterPlayerId: game.currentCutterPlayerId,
    cutCountInRound: game.cutCountInRound,
    requiredDefuseTotal: game.requiredDefuseTotal,
    defuseFoundCount: game.defuseFoundCount,
    winnerTeam: game.winnerTeam,
    finishReason: game.finishReason,
    roleRevealAckPlayerIds: game.roleRevealAckPlayerIds,
    wireRevealAckPlayerIds: game.wireRevealAckPlayerIds,
    roundEndAckPlayerIds: game.roundEndAckPlayerIds,
    lastRoundEnded: game.lastRoundEnded,
    readyForNextPlayerIds: game.readyForNextPlayerIds,
    publicEvents: game.publicEvents,
    publicWiresByPlayer,
    roleAssignmentsAtEnd: room.status === "finished" ? game.roleAssignments : null,
  };
}

export function getPrivateGameState(room: Room, playerId: string): PrivateGameState {
  const game = room.game;
  if (!game) {
    return {
      role: null,
      wires: [],
    };
  }

  return {
    role: game.roleAssignments[playerId] ?? null,
    wires: game.wiresByPlayer[playerId] ?? [],
  };
}
