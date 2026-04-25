import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ClientMessage,
  ClientRoomState,
  PlayerIdentity,
  PrivateGameState,
  PublicPlayer,
  PublicRoomState,
  ServerMessage,
  WireCard,
  WireSlot,
} from "@shared/types";
import cardDefuseImg from "./assets/cards/01_defuse.png";
import cardSilentImg from "./assets/cards/02_silent.png";
import cardBoomImg from "./assets/cards/03_boom.png";
import cardBackImg from "./assets/cards/04_bomb.png";
import nipperImg from "./assets/img/nipper.png";
import titleLogoImg from "./assets/img/title.png";
import bomberImg from "./assets/img/bomber.png";
import policeImg from "./assets/img/police.png";
import bomberWinImg from "./assets/img/bomber_win.png";
import bomberLoseImg from "./assets/img/bomber_lose.png";
import policeWinImg from "./assets/img/police_win.png";
import policeLoseImg from "./assets/img/police_lose.png";

function cardImageSrc(card: WireCard): string {
  if (card === "defuse") return cardDefuseImg;
  if (card === "boom") return cardBoomImg;
  return cardSilentImg;
}

const storageKey = "timebomb-mvp-identities";

function loadSavedIdentities(): Record<string, PlayerIdentity> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as Record<string, PlayerIdentity>) : {};
  } catch {
    return {};
  }
}

function saveIdentity(identity: PlayerIdentity): void {
  const identities = loadSavedIdentities();
  identities[identity.roomCode] = identity;
  window.localStorage.setItem(storageKey, JSON.stringify(identities));
}

function getIdentityForRoom(roomCode: string): PlayerIdentity | null {
  const identities = loadSavedIdentities();
  return identities[roomCode.toUpperCase()] ?? null;
}

function roleLabel(role: PrivateGameState["role"]): string {
  return role === "bomber" ? "ボマー団" : role === "time_police" ? "タイムポリス" : "-";
}

function wireLabel(card: WireSlot["card"]): string {
  if (card === "boom") return "BOOM";
  if (card === "defuse") return "解除";
  return "しーん";
}

function buildWsUrl(): string {
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl) return envUrl;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}`;
}

export function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const [clientState, setClientState] = useState<ClientRoomState>({
    me: null,
    publicState: null,
    privateState: null,
    errorMessage: null,
  });
  const [joinName, setJoinName] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [createMaxPlayers, setCreateMaxPlayers] = useState(4);
  const [createMode, setCreateMode] = useState<"random" | "host_select">("random");
  const [showRole, setShowRole] = useState(false);
  const [showWires, setShowWires] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [endFlashCard, setEndFlashCard] = useState<"boom" | "defuse" | null>(null);
  const lastFlashedTimestampRef = useRef<number | null>(null);
  const flashSeededRef = useRef(false);

  useEffect(() => {
    const socket = new WebSocket(buildWsUrl());
    socketRef.current = socket;

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === "room:error") {
        setClientState((prev) => ({
          ...prev,
          errorMessage: message.payload.message,
        }));
        return;
      }

      if (message.type === "room:state") {
        if (message.payload.me) {
          saveIdentity(message.payload.me);
          const url = new URL(window.location.href);
          url.searchParams.set("roomCode", message.payload.me.roomCode);
          window.history.replaceState({}, "", url);
        }
        setClientState((prev) => ({
          me: message.payload.me,
          publicState: message.payload.publicState,
          privateState: message.payload.privateState,
          errorMessage: prev.errorMessage,
        }));
      }
    });

    return () => {
      socket.close();
    };
  }, []);

  useEffect(() => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      const handleOpen = () => {
        const roomCode = new URLSearchParams(window.location.search).get("roomCode");
        if (!roomCode) {
          return;
        }
        const savedIdentity = getIdentityForRoom(roomCode);
        if (savedIdentity) {
          send({
            type: "room:reconnect",
            payload: savedIdentity,
          });
        }
      };

      socketRef.current?.addEventListener("open", handleOpen, { once: true });
      return;
    }
  }, []);

  const me = clientState.me;
  const publicState = clientState.publicState;
  const privateState = clientState.privateState;

  // 直近の cut_result イベントを観測し、BOOM / 解除 が引かれた瞬間に全画面フラッシュ演出。
  // - 再接続(過去イベントを抱えた状態)では再生をスキップするため初回 seed をマーク
  // - timestamp で重複処理防止
  useEffect(() => {
    const events = publicState?.game?.publicEvents ?? [];
    const lastCut = [...events].reverse().find((event) => event.type === "cut_result");
    if (!lastCut || !lastCut.resultCard) return;

    if (!flashSeededRef.current) {
      lastFlashedTimestampRef.current = lastCut.timestamp;
      flashSeededRef.current = true;
      return;
    }

    if (lastFlashedTimestampRef.current === lastCut.timestamp) return;
    lastFlashedTimestampRef.current = lastCut.timestamp;

    if (lastCut.resultCard !== "boom" && lastCut.resultCard !== "defuse") return;

    setEndFlashCard(lastCut.resultCard);
    const timer = window.setTimeout(() => setEndFlashCard(null), 2400);
    return () => window.clearTimeout(timer);
  }, [publicState?.game?.publicEvents]);

  const playersById = useMemo(() => {
    const map = new Map<string, PublicPlayer>();
    publicState?.players.forEach((player) => map.set(player.id, player));
    return map;
  }, [publicState]);

  function send(message: ClientMessage): void {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setClientState((prev) => ({ ...prev, errorMessage: "接続中です。少し待ってから再試行してください。" }));
      return;
    }
    setClientState((prev) => (prev.errorMessage ? { ...prev, errorMessage: null } : prev));
    socketRef.current.send(JSON.stringify(message));
  }

  function dismissError(): void {
    setClientState((prev) => (prev.errorMessage ? { ...prev, errorMessage: null } : prev));
  }

  function handleCreateRoom(): void {
    send({
      type: "room:create",
      payload: {
        name: joinName,
        maxPlayers: createMaxPlayers,
        initialCutterMode: createMode,
      },
    });
  }

  function handleJoinRoom(): void {
    const roomCode = roomCodeInput.trim().toUpperCase();
    const savedIdentity = getIdentityForRoom(roomCode);
    if (savedIdentity) {
      send({
        type: "room:reconnect",
        payload: savedIdentity,
      });
      return;
    }
    send({
      type: "room:join",
      payload: {
        roomCode,
        name: joinName,
      },
    });
  }

  function handleStartGame(initialCutterPlayerId?: string): void {
    if (!me || !publicState) return;
    send({
      type: "game:start",
      payload: {
        roomCode: publicState.roomCode,
        playerId: me.playerId,
        sessionToken: me.sessionToken,
        initialCutterPlayerId,
      },
    });
  }

  function sendAuthenticated(type: ClientMessage["type"]): void {
    if (!me || !publicState) return;

    if (
      type === "role:ack" ||
      type === "role:reroll" ||
      type === "wire:ack" ||
      type === "wire:reroll" ||
      type === "round:ack"
    ) {
      send({
        type,
        payload: {
          roomCode: publicState.roomCode,
          playerId: me.playerId,
          sessionToken: me.sessionToken,
        },
      } as ClientMessage);
    }
  }

  function askConfirm(message: string, onConfirm: () => void): void {
    setConfirmDialog({ message, onConfirm });
  }

  function confirmAndSend(type: Extract<ClientMessage["type"], "role:ack" | "wire:ack" | "round:ack">): void {
    const message =
      type === "role:ack"
        ? "役職の確認を完了しますか？"
        : type === "wire:ack"
          ? "導線の確認を完了しますか？"
          : "次のラウンドに進みますか？";

    askConfirm(message, () => sendAuthenticated(type));
  }

  function handleReadyForNext(): void {
    if (!me || !publicState) return;
    send({
      type: "game:ready_for_next",
      payload: {
        roomCode: publicState.roomCode,
        playerId: me.playerId,
        sessionToken: me.sessionToken,
      },
    });
  }

  function handleLeaveAndGoHome(): void {
    // サーバーに leave を通知 (接続中の他プレイヤーから自分を消す)
    if (me && publicState) {
      send({
        type: "game:leave",
        payload: {
          roomCode: publicState.roomCode,
          playerId: me.playerId,
          sessionToken: me.sessionToken,
        },
      });
    }
    // localStorageから当該ルームのidentityを消して接続をリセット
    if (publicState) {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const identities = JSON.parse(raw) as Record<string, PlayerIdentity>;
          delete identities[publicState.roomCode];
          window.localStorage.setItem(storageKey, JSON.stringify(identities));
        }
      } catch {
        /* noop */
      }
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("roomCode");
    window.history.replaceState({}, "", url);
    // leave メッセージが送られるタイミングを確保してからリロード
    window.setTimeout(() => window.location.reload(), 80);
  }

  function handleCut(targetPlayerId: string, slotIndex: number): void {
    if (!me || !publicState?.game) return;
    const actorPlayerId = publicState.game.currentCutterPlayerId;
    if (!actorPlayerId) return;

    const roomCode = publicState.roomCode;
    const playerId = me.playerId;
    const sessionToken = me.sessionToken;

    askConfirm("このカードを切りますか？", () => {
      send({
        type: "game:cut_request",
        payload: {
          roomCode,
          playerId,
          sessionToken,
          actorPlayerId,
          targetPlayerId,
          slotIndex,
        },
      });
    });
  }

  const isHost = !!me && !!publicState && publicState.hostPlayerId === me.playerId;
  const isPlaying = publicState?.status === "playing";
  const isFinished = publicState?.status === "finished";
  const isRoundEnd = publicState?.status === "round_end";
  const isGameScreen = isPlaying || isFinished;
  const isMeCutter =
    isPlaying && !!me && publicState?.game?.currentCutterPlayerId === me.playerId;
  const screenClassName = !publicState
    ? "screen-setup"
    : publicState.status === "lobby"
      ? "screen-lobby"
      : publicState.status === "role_reveal"
        ? "screen-role"
        : publicState.status === "wire_reveal"
          ? "screen-wire"
          : publicState.status === "round_end"
            ? "screen-round-end"
            : publicState.status === "finished"
              ? "screen-finish"
              : "screen-game";
  const currentCutterName = publicState?.game?.currentCutterPlayerId
    ? playersById.get(publicState.game.currentCutterPlayerId)?.name ?? "不明"
    : "-";
  const defuseLeft = publicState?.game ? publicState.game.requiredDefuseTotal - publicState.game.defuseFoundCount : 0;
  const myPublicSlots = me && publicState?.game ? publicState.game.publicWiresByPlayer[me.playerId] ?? [] : [];
  const canBeCutOnMyDevice =
    isPlaying &&
    !!me &&
    publicState?.game?.currentCutterPlayerId !== me?.playerId &&
    publicState?.game?.currentCutterPlayerId !== null;

  return (
    <div className={`app-shell ${isGameScreen ? "app-shell-game" : ""} ${screenClassName}`}>
      {!isGameScreen ? (
        <header className="hero">
          <img src={titleLogoImg} alt="タイムボム" className="hero-logo" draggable={false} />
        </header>
      ) : null}

      {clientState.errorMessage ? (
        <div className="error-banner" role="alert">
          <span>{clientState.errorMessage}</span>
          <button type="button" className="error-close" onClick={dismissError} aria-label="エラーを閉じる">
            ×
          </button>
        </div>
      ) : null}

      {!publicState ? (
        <section className="panel stack">
          <label className="field">
            <span>プレイヤー名</span>
            <input value={joinName} onChange={(event) => setJoinName(event.target.value)} placeholder="名前を入力" />
          </label>

          <div className="split">
            <section className="subpanel stack">
              <h2>ルーム参加</h2>
              <label className="field">
                <span>参加コード</span>
                <input value={roomCodeInput} onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())} placeholder="ABCD12" />
              </label>
              <button className="primary" onClick={handleJoinRoom}>
                参加する
              </button>
            </section>

            <section className="subpanel stack">
              <h2>ルーム作成</h2>
              <label className="field">
                <span>人数上限</span>
                <select value={createMaxPlayers} onChange={(event) => setCreateMaxPlayers(Number(event.target.value))}>
                  {[4, 5, 6, 7, 8].map((count) => (
                    <option key={count} value={count}>
                      {count}人
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>初手ニッパー係</span>
                <select value={createMode} onChange={(event) => setCreateMode(event.target.value as "random" | "host_select")}>
                  <option value="random">ランダム</option>
                  <option value="host_select">ホスト指定</option>
                </select>
              </label>
              <button className="primary" onClick={handleCreateRoom}>
                ルームを作成
              </button>
            </section>
          </div>
        </section>
      ) : (
        <>
          {publicState.status === "lobby" ? (
            <section className="panel stack">
              <div className="headline-row">
                <div>
                  <h2>ルーム {publicState.roomCode}</h2>
                  <p className="subtle">
                    {publicState.players.length} / {publicState.maxPlayers}人
                  </p>
                </div>
                <div className="badge">{publicState.status}</div>
              </div>

              <div className="player-list">
                {publicState.players.map((player) => (
                  <div key={player.id} className={`player-card ${player.id === publicState.hostPlayerId ? "host" : ""}`}>
                    <strong>{player.name}</strong>
                    <span>{player.id === me?.playerId ? "あなた" : player.id === publicState.hostPlayerId ? "ホスト" : "参加者"}</span>
                    <span>{player.isConnected ? "接続中" : "切断中"}</span>
                  </div>
                ))}
              </div>

              <LobbyControls
                publicState={publicState}
                isHost={isHost}
                onStart={handleStartGame}
                onLeave={() =>
                  askConfirm("このルームから退出してホームに戻りますか？", handleLeaveAndGoHome)
                }
              />
            </section>
          ) : null}

          {publicState.status === "role_reveal" ? (
            <section className="panel stack">
              <div className="confirm-header">
                <span className="confirm-title">役職確認</span>
                <AckStatusBar
                  players={publicState.players}
                  ackedIds={publicState.game?.roleRevealAckPlayerIds ?? []}
                  meId={me?.playerId ?? null}
                />
              </div>
              <RoleReveal role={privateState?.role ?? null} />
              <div className="actions">
                <button
                  className="primary"
                  disabled={!!me && (publicState.game?.roleRevealAckPlayerIds ?? []).includes(me.playerId)}
                  onClick={() => confirmAndSend("role:ack")}
                >
                  {!!me && (publicState.game?.roleRevealAckPlayerIds ?? []).includes(me.playerId)
                    ? "確認済み"
                    : "確認済みにする"}
                </button>
                {isHost ? (
                  <button
                    onClick={() =>
                      askConfirm("役職を配り直しますか？(全員の確認済みがリセットされます)", () =>
                        sendAuthenticated("role:reroll"),
                      )
                    }
                  >
                    役職を配り直す
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          {publicState.status === "wire_reveal" ? (
            <section className="panel stack">
              <div className="confirm-header">
                <span className="confirm-title">
                  導線確認 <span className="confirm-round">R{publicState.game?.currentRound}</span>
                </span>
                <AckStatusBar
                  players={publicState.players}
                  ackedIds={publicState.game?.wireRevealAckPlayerIds ?? []}
                  meId={me?.playerId ?? null}
                />
              </div>
              <div
                className="wire-grid"
                style={{
                  ["--wire-count" as string]: Math.max(privateState?.wires?.length ?? 0, 1),
                }}
              >
                {(privateState?.wires ?? []).map((wire) => (
                  <div key={wire.slotIndex} className="wire-card revealed">
                    <img src={cardImageSrc(wire.card)} alt={wireLabel(wire.card)} />
                  </div>
                ))}
              </div>
              <div className="actions">
                <button
                  className="primary"
                  disabled={!!me && (publicState.game?.wireRevealAckPlayerIds ?? []).includes(me.playerId)}
                  onClick={() => confirmAndSend("wire:ack")}
                >
                  {!!me && (publicState.game?.wireRevealAckPlayerIds ?? []).includes(me.playerId)
                    ? "確認済み"
                    : "確認済みにする"}
                </button>
                {isHost ? (
                  <button
                    onClick={() =>
                      askConfirm("導線を配り直しますか？(全員の確認済みがリセットされます)", () =>
                        sendAuthenticated("wire:reroll"),
                      )
                    }
                  >
                    導線を配り直す
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          {isRoundEnd ? (
            <section className="panel stack round-end-panel">
              <div className="confirm-header">
                <span className="confirm-title">
                  R{publicState.game?.lastRoundEnded ?? publicState.game?.currentRound} 終了
                </span>
                <AckStatusBar
                  players={publicState.players}
                  ackedIds={publicState.game?.roundEndAckPlayerIds ?? []}
                  meId={me?.playerId ?? null}
                />
              </div>
              <p className="round-end-message">
                次のラウンドに進むと新しい手札が配られます。<br />
                手元の端末が見えないようにしてから進んでください。
              </p>
              {publicState.game?.lastRoundEnded ? (
                <RoundDigest publicState={publicState} round={publicState.game.lastRoundEnded} />
              ) : null}
              <div className="actions">
                <button
                  className="primary"
                  disabled={!!me && (publicState.game?.roundEndAckPlayerIds ?? []).includes(me.playerId)}
                  onClick={() => confirmAndSend("round:ack")}
                >
                  {!!me && (publicState.game?.roundEndAckPlayerIds ?? []).includes(me.playerId)
                    ? "準備完了"
                    : "次のラウンドへ"}
                </button>
              </div>
            </section>
          ) : null}

          {isPlaying ? (
            <section className="game-stage">
              <div className="game-overlay game-overlay-top">
                <span className="round-pill">R{publicState.game?.currentRound}</span>
                <DefuseProgress
                  found={publicState.game?.defuseFoundCount ?? 0}
                  total={publicState.game?.requiredDefuseTotal ?? 0}
                />
              </div>

              <div className="game-overlay game-overlay-actions">
                <button className="ghost-button" onClick={() => setShowRole(true)}>
                  役職
                </button>
                <button className="ghost-button" onClick={() => setShowWires(true)}>
                  導線
                </button>
              </div>

              <div className={`cutter-banner ${isMeCutter ? "is-me" : "is-other"}`}>
                <img src={nipperImg} alt="ニッパー" className="cutter-nipper-img" draggable={false} />
                <div className="cutter-info">
                  <span className="cutter-label">ニッパー</span>
                  <strong className="cutter-name">
                    {currentCutterName}
                    {isMeCutter ? " (あなた)" : ""}
                  </strong>
                </div>
              </div>

              <div
                className="card-stage"
                style={{ ["--card-count" as string]: Math.max(myPublicSlots.length, 1) }}
              >
                {myPublicSlots.map((slot) => {
                  const label = slot.isRevealed ? wireLabel(slot.revealedCard ?? "silent") : "裏";
                  const imgSrc = slot.isRevealed
                    ? cardImageSrc(slot.revealedCard ?? "silent")
                    : cardBackImg;

                  return (
                    <button
                      key={slot.slotIndex}
                      className={`player-card-face ${slot.isRevealed ? "revealed" : "hidden"} ${
                        canBeCutOnMyDevice && !slot.isRevealed ? "cuttable" : ""
                      }`}
                      disabled={!canBeCutOnMyDevice || slot.isRevealed || publicState.game?.currentCutterPlayerId === null}
                      onClick={() => me && handleCut(me.playerId, slot.slotIndex)}
                      aria-label={label}
                    >
                      <img src={imgSrc} alt={label} draggable={false} />
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {isFinished ? (
            <FinishStage
              publicState={publicState}
              privateState={privateState}
              meId={me?.playerId ?? null}
              onReadyForNext={() =>
                askConfirm(
                  "同じメンバーでもう一度プレイしますか？(全員の準備完了でロビーに戻ります)",
                  handleReadyForNext,
                )
              }
              onLeave={() =>
                askConfirm("このルームから抜けてホームに戻りますか？", handleLeaveAndGoHome)
              }
            />
          ) : null}
        </>
      )}

      {showRole ? (
        <Modal title="役職再確認" onClose={() => setShowRole(false)}>
          <RoleReveal role={privateState?.role ?? null} />
        </Modal>
      ) : null}

      {showWires ? (
        <Modal title="導線再確認" onClose={() => setShowWires(false)}>
          <div className="wire-grid">
            {(privateState?.wires ?? []).map((wire) => (
              <div key={wire.slotIndex} className={`wire-card revealed ${wire.isRevealed ? "cut" : ""}`}>
                <img src={cardImageSrc(wire.card)} alt={wireLabel(wire.card)} />
                {wire.isRevealed ? <span className="wire-cut-badge">切済</span> : null}
              </div>
            ))}
          </div>
        </Modal>
      ) : null}

      {endFlashCard === "boom" ? (
        <div className="boom-flash" aria-hidden>
          <img src={cardBoomImg} alt="" className="boom-flash-card" draggable={false} />
          <div className="boom-flash-text">BOOM!</div>
        </div>
      ) : null}
      {endFlashCard === "defuse" ? (
        <div className="defuse-flash" aria-hidden>
          <img src={cardDefuseImg} alt="" className="defuse-flash-card" draggable={false} />
          <div className="defuse-flash-text">解除!</div>
        </div>
      ) : null}

      {confirmDialog ? (
        <Modal title="確認" onClose={() => setConfirmDialog(null)} hideClose>
          <p className="confirm-message">{confirmDialog.message}</p>
          <div className="actions confirm-actions">
            <button type="button" onClick={() => setConfirmDialog(null)}>
              キャンセル
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                const onConfirm = confirmDialog.onConfirm;
                setConfirmDialog(null);
                onConfirm();
              }}
            >
              確定
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function DefuseProgress({ found, total }: { found: number; total: number }) {
  const safeTotal = Math.max(total, 1);
  const pct = Math.min(100, Math.round((found / safeTotal) * 100));
  return (
    <div
      className="defuse-gauge"
      role="progressbar"
      aria-valuenow={found}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={`解除進捗 ${found} / ${total}`}
    >
      <img src={cardDefuseImg} alt="" className="defuse-gauge-icon" draggable={false} />
      <div className="defuse-gauge-bar">
        <div className="defuse-gauge-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="defuse-gauge-count">
        {found}/{total}
      </span>
    </div>
  );
}

function RoundDigest({
  publicState,
  round,
}: {
  publicState: PublicRoomState;
  round: number;
}) {
  const game = publicState.game;
  if (!game) return null;

  const events = game.publicEvents.filter(
    (event) => event.type === "cut_result" && event.round === round,
  );

  let defuseCount = 0;
  let silentCount = 0;
  events.forEach((event) => {
    if (event.resultCard === "defuse") defuseCount += 1;
    else if (event.resultCard === "silent") silentCount += 1;
  });

  const playersById = new Map(publicState.players.map((p) => [p.id, p.name]));

  return (
    <div className="round-digest">
      <div className="round-digest-stats">
        <div className="round-digest-stat digest-defuse">
          <img src={cardDefuseImg} alt="" draggable={false} />
          <span className="digest-stat-value">+{defuseCount}</span>
          <span className="digest-stat-label">解除</span>
        </div>
        <div className="round-digest-stat digest-silent">
          <img src={cardSilentImg} alt="" draggable={false} />
          <span className="digest-stat-value">{silentCount}</span>
          <span className="digest-stat-label">しーん</span>
        </div>
        <div className="round-digest-stat digest-total">
          <span className="digest-stat-value">
            {game.defuseFoundCount}/{game.requiredDefuseTotal}
          </span>
          <span className="digest-stat-label">累計解除</span>
        </div>
      </div>

      {events.length > 0 ? (
        <ol className="round-digest-log">
          {events.map((event, index) => {
            const actorName = event.actorPlayerId ? playersById.get(event.actorPlayerId) ?? "?" : "?";
            const targetName = event.targetPlayerId ? playersById.get(event.targetPlayerId) ?? "?" : "?";
            const resultLabel =
              event.resultCard === "defuse"
                ? "解除"
                : event.resultCard === "boom"
                  ? "BOOM"
                  : "しーん";
            const resultClass = `digest-result-${event.resultCard ?? "silent"}`;
            return (
              <li key={`${event.timestamp}-${index}`} className="round-digest-log-item">
                <span className="digest-log-order">{index + 1}</span>
                <span className="digest-log-actor">{actorName}</span>
                <span className="digest-log-arrow">→</span>
                <span className="digest-log-target">{targetName}</span>
                <span className={`digest-log-result ${resultClass}`}>{resultLabel}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

function AckStatusBar({
  players,
  ackedIds,
  meId,
}: {
  players: PublicPlayer[];
  ackedIds: string[];
  meId: string | null;
}) {
  const ackedSet = new Set(ackedIds);
  const ackedCount = players.reduce((count, player) => (ackedSet.has(player.id) ? count + 1 : count), 0);
  return (
    <div className="ack-bar" aria-label="確認状況">
      <span className="ack-count">
        {ackedCount}/{players.length}
      </span>
      <ul className="ack-chip-list">
        {players.map((player) => {
          const acked = ackedSet.has(player.id);
          return (
            <li
              key={player.id}
              className={`ack-chip ${acked ? "acked" : "pending"} ${player.id === meId ? "me" : ""}`}
              title={`${player.name} — ${acked ? "確認済み" : "未確認"}`}
            >
              <span className="ack-mark" aria-hidden>
                {acked ? "✓" : "…"}
              </span>
              <span className="ack-name">{player.name}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RoleReveal({ role }: { role: PrivateGameState["role"] }) {
  if (role === "bomber") {
    return (
      <div className="role-reveal is-bomber">
        <img src={bomberImg} alt="ボマー団" className="role-reveal-image" draggable={false} />
        <span className="role-reveal-label">ボマー団</span>
      </div>
    );
  }
  if (role === "time_police") {
    return (
      <div className="role-reveal is-police">
        <img src={policeImg} alt="タイムポリス" className="role-reveal-image" draggable={false} />
        <span className="role-reveal-label">タイムポリス</span>
      </div>
    );
  }
  return <p className="role-card">-</p>;
}

function FinishStage({
  publicState,
  privateState,
  meId,
  onReadyForNext,
  onLeave,
}: {
  publicState: PublicRoomState;
  privateState: PrivateGameState | null;
  meId: string | null;
  onReadyForNext: () => void;
  onLeave: () => void;
}) {
  const myRole = privateState?.role ?? null;
  const winnerTeam = publicState.game?.winnerTeam ?? null;
  const isWin = !!myRole && !!winnerTeam && myRole === winnerTeam;

  const finishImg =
    myRole === "bomber"
      ? isWin
        ? bomberWinImg
        : bomberLoseImg
      : myRole === "time_police"
        ? isWin
          ? policeWinImg
          : policeLoseImg
        : null;

  const winnerLabel =
    winnerTeam === "bomber" ? "ボマー団の勝利" : winnerTeam === "time_police" ? "タイムポリスの勝利" : "-";
  const reasonLabel =
    publicState.game?.finishReason === "boom"
      ? "BOOM公開"
      : publicState.game?.finishReason === "all_defused"
        ? "解除全達成"
        : "4ラウンド終了";

  const readyForNextPlayerIds = publicState.game?.readyForNextPlayerIds ?? [];
  const isReady = !!meId && readyForNextPlayerIds.includes(meId);

  return (
    <section className={`finish-stage ${isWin ? "is-win" : "is-lose"}`}>
      <div className="finish-bg" aria-hidden />
      <div className="finish-burst" aria-hidden />
      <div className="finish-content">
        <div className={`finish-title ${isWin ? "win" : "lose"}`}>
          {isWin ? "勝 利" : "敗 北"}
        </div>
        {finishImg ? (
          <img
            src={finishImg}
            alt={isWin ? "勝利" : "敗北"}
            className="finish-image"
            draggable={false}
          />
        ) : null}
        <div className="finish-summary">
          <div className="finish-winner-team">{winnerLabel}</div>
          <div className="finish-reason">{reasonLabel}</div>
        </div>
        {publicState.game?.roleAssignmentsAtEnd ? (
          <ul className="finish-role-assignments">
            {publicState.players.map((player) => {
              const playerRole = publicState.game?.roleAssignmentsAtEnd?.[player.id] ?? null;
              return (
                <li
                  key={player.id}
                  className={`finish-role-row ${playerRole === winnerTeam ? "is-winner" : "is-loser"}`}
                >
                  <span className="finish-role-name">{player.name}</span>
                  <span className="finish-role-tag">{roleLabel(playerRole)}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="finish-ready-status">
          <span className="finish-ready-label">再戦準備</span>
          <AckStatusBar
            players={publicState.players}
            ackedIds={readyForNextPlayerIds}
            meId={meId}
          />
        </div>
        <div className="finish-actions">
          <button className="primary" disabled={isReady} onClick={onReadyForNext}>
            {isReady ? "準備完了 (他プレイヤー待ち)" : "もう一度"}
          </button>
          <button className="ghost" onClick={onLeave}>
            抜ける
          </button>
        </div>
      </div>
    </section>
  );
}

function LobbyControls({
  publicState,
  isHost,
  onStart,
  onLeave,
}: {
  publicState: PublicRoomState;
  isHost: boolean;
  onStart: (initialCutterPlayerId?: string) => void;
  onLeave: () => void;
}) {
  const [selectedInitialCutter, setSelectedInitialCutter] = useState("");

  if (!isHost) {
    return (
      <div className="stack lobby-controls">
        <p className="subtle">ホストの開始を待っています。</p>
        <div className="lobby-actions">
          <button className="ghost" onClick={onLeave}>
            ルームから退出
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack lobby-controls">
      <p className="subtle">
        初手ニッパー係: {publicState.initialCutterMode === "random" ? "ランダム" : "ホスト指定"}
      </p>
      {publicState.initialCutterMode === "host_select" ? (
        <label className="field">
          <span>初手ニッパー係を選択</span>
          <select value={selectedInitialCutter} onChange={(event) => setSelectedInitialCutter(event.target.value)}>
            <option value="">選択してください</option>
            {publicState.players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="lobby-actions">
        <button
          className="primary"
          disabled={
            publicState.players.length < 4 ||
            (publicState.initialCutterMode === "host_select" && !selectedInitialCutter)
          }
          onClick={() =>
            onStart(publicState.initialCutterMode === "host_select" ? selectedInitialCutter : undefined)
          }
        >
          ゲーム開始
        </button>
        <button className="ghost" onClick={onLeave}>
          ルームから退出
        </button>
      </div>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  hideClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  hideClose?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="headline-row compact">
          <h3>{title}</h3>
          {hideClose ? null : <button onClick={onClose}>閉じる</button>}
        </div>
        {children}
      </div>
    </div>
  );
}
