import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ClientMessage,
  ClientRoomState,
  PlayerIdentity,
  PrivateGameState,
  PublicPlayer,
  PublicRoomState,
  ServerMessage,
  WireSlot,
} from "@shared/types";

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
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const port = window.location.port === "5173" ? "3001" : window.location.port;
  return `${protocol}://${window.location.hostname}:${port}`;
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

    if (type === "role:ack" || type === "role:reroll" || type === "wire:ack" || type === "wire:reroll") {
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

  function confirmAndSend(type: Extract<ClientMessage["type"], "role:ack" | "wire:ack">): void {
    const message =
      type === "role:ack"
        ? "役職の確認を完了しますか？"
        : "導線の確認を完了しますか？";

    askConfirm(message, () => sendAuthenticated(type));
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
  const isGameScreen = isPlaying || isFinished;
  const screenClassName = !publicState
    ? "screen-setup"
    : publicState.status === "lobby"
      ? "screen-lobby"
      : publicState.status === "role_reveal"
        ? "screen-role"
        : publicState.status === "wire_reveal"
          ? "screen-wire"
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
          <p className="eyebrow">Timebomb MVP</p>
          <h1>対面プレイ用『タイムボム』</h1>
          <p className="subtle">秘密情報は自分の端末だけに表示し、ゲーム状態はすべてサーバーで管理します。</p>
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
          {!isGameScreen ? (
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

              {publicState.status === "lobby" ? (
                <LobbyControls
                  publicState={publicState}
                  isHost={isHost}
                  onStart={handleStartGame}
                />
              ) : null}
            </section>
          ) : null}

          {publicState.status === "role_reveal" ? (
            <section className="panel stack">
              <h2>役職確認</h2>
              <p className="role-card">{roleLabel(privateState?.role ?? null)}</p>
              <p className="subtle">
                確認済み: {publicState.game?.roleRevealAckPlayerIds.length ?? 0} / {publicState.players.length}
              </p>
              <div className="actions">
                <button className="primary" onClick={() => confirmAndSend("role:ack")}>
                  確認済みにする
                </button>
                {isHost ? (
                  <button onClick={() => sendAuthenticated("role:reroll")}>
                    役職を配り直す
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          {publicState.status === "wire_reveal" ? (
            <section className="panel stack">
              <h2>導線確認</h2>
              <div className="wire-grid">
                {(privateState?.wires ?? []).map((wire) => (
                  <div key={wire.slotIndex} className="wire-card revealed">
                    {wireLabel(wire.card)}
                  </div>
                ))}
              </div>
              <p className="subtle">
                確認済み: {publicState.game?.wireRevealAckPlayerIds.length ?? 0} / {publicState.players.length}
              </p>
              <div className="actions">
                <button className="primary" onClick={() => confirmAndSend("wire:ack")}>
                  確認済みにする
                </button>
                {isHost ? (
                  <button onClick={() => sendAuthenticated("wire:reroll")}>
                    導線を配り直す
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          {isGameScreen ? (
            <section className={`game-stage ${isFinished ? "game-stage-finished" : ""}`}>
              <div className="game-overlay game-overlay-top">
                <span>R{publicState.game?.currentRound}</span>
                <span>解除残り {defuseLeft}</span>
                {isPlaying ? <span>ニッパー: {currentCutterName}</span> : null}
              </div>

              <div className="game-overlay game-overlay-actions">
                <button className="ghost-button" onClick={() => setShowRole(true)}>
                  役職
                </button>
                <button className="ghost-button" onClick={() => setShowWires(true)}>
                  導線
                </button>
              </div>

              {isPlaying ? (
                <div className="game-hint">
                  {publicState.game?.currentCutterPlayerId === me?.playerId
                    ? "他プレイヤーの端末でカードを選んでください"
                    : "この端末では自分のカードだけを操作できます"}
                </div>
              ) : null}

              {isFinished ? (
                <div className="game-finish-panel">
                  <strong>
                    {privateState?.role && publicState.game?.winnerTeam
                      ? privateState.role === publicState.game.winnerTeam
                        ? "勝利"
                        : "敗北"
                      : "-"}
                  </strong>
                  <span>
                    {publicState.game?.winnerTeam === "bomber" ? "ボマー団の勝利" : "タイムポリスの勝利"} /{" "}
                    {publicState.game?.finishReason === "boom"
                      ? "BOOM公開"
                      : publicState.game?.finishReason === "all_defused"
                        ? "解除全達成"
                        : "4ラウンド終了"}
                  </span>
                </div>
              ) : null}

              <div className="card-stage">
                {myPublicSlots.map((slot) => {
                  const label = slot.isRevealed ? wireLabel(slot.revealedCard ?? "silent") : "裏";

                  return (
                    <button
                      key={slot.slotIndex}
                      className={`player-card-face ${slot.isRevealed ? "revealed" : "hidden"}`}
                      disabled={!canBeCutOnMyDevice || slot.isRevealed || publicState.game?.currentCutterPlayerId === null}
                      onClick={() => me && handleCut(me.playerId, slot.slotIndex)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {publicState.game?.roleAssignmentsAtEnd ? (
                <div className="game-finish-roles">
                  {publicState.players.map((player) => (
                    <div key={player.id} className="summary-row">
                      <span>{player.name}</span>
                      <strong>{roleLabel(publicState.game?.roleAssignmentsAtEnd?.[player.id] ?? null)}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      {showRole ? (
        <Modal title="役職再確認" onClose={() => setShowRole(false)}>
          <p className="role-card">{roleLabel(privateState?.role ?? null)}</p>
        </Modal>
      ) : null}

      {showWires ? (
        <Modal title="導線再確認" onClose={() => setShowWires(false)}>
          <div className="wire-grid">
            {(privateState?.wires ?? []).map((wire) => (
              <div key={wire.slotIndex} className={`wire-card ${wire.isRevealed ? "revealed" : "hidden"}`}>
                {wireLabel(wire.card)}
              </div>
            ))}
          </div>
        </Modal>
      ) : null}

      {confirmDialog ? (
        <Modal title="確認" onClose={() => setConfirmDialog(null)}>
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

function LobbyControls({
  publicState,
  isHost,
  onStart,
}: {
  publicState: PublicRoomState;
  isHost: boolean;
  onStart: (initialCutterPlayerId?: string) => void;
}) {
  const [selectedInitialCutter, setSelectedInitialCutter] = useState("");

  if (!isHost) {
    return <p className="subtle">ホストの開始を待っています。</p>;
  }

  return (
    <div className="stack">
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
      <button
        className="primary"
        disabled={publicState.players.length < 4}
        onClick={() =>
          onStart(publicState.initialCutterMode === "host_select" ? selectedInitialCutter : undefined)
        }
      >
        ゲーム開始
      </button>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="headline-row compact">
          <h3>{title}</h3>
          <button onClick={onClose}>閉じる</button>
        </div>
        {children}
      </div>
    </div>
  );
}
