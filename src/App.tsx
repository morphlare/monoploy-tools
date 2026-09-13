import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { socket } from "./socket";
import { DEFAULT_GAME_MODE, MAX_PLAYERS, type GameMode, type DiceCount } from "../shared/types";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  ArrowLeftRight,
  Banknote,
  Building2,
  Check,
  ChevronRight,
  Copy,
  Dices,
  DoorOpen,
  House,
  Landmark,
  ListFilter,
  MapPin,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  TrainFront,
  Undo2,
  Wallet,
  X,
  History,
  Hotel,
  LockKeyhole,
  Users,
  Zap,
} from "lucide-react";
import type {
  Action,
  Player,
  PropertyDefinition,
  Reply,
  Room,
  Session,
} from "../shared/types";
import {
  assetsFor,
  redemptionPrice,
  definitions,
  groupColors,
  groupName,
  money,
  propertyById,
  rentFor,
} from "../shared/rules";

const sessionKey = "china-journey-session";
const NoticeContext = createContext("");
const BalanceContext = createContext<ReactNode>(null);
const avatars = [
  "#e2edc4",
  "#f4d9bc",
  "#d6e2f3",
  "#ead8eb",
  "#cee9e2",
  "#f4ded7",
];
const time = (at: number) =>
  new Date(at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
function uuid() {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (
      Number(c) ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))
    ).toString(16),
  );
}
function readSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(sessionKey) || "null");
  } catch {
    return null;
  }
}
function Avatar({
  player,
  small = false,
}: {
  player: Player;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${small ? "small" : ""}`}
      style={{ background: avatars[player.color % avatars.length] }}
    >
      {player.name.slice(0, 1)}
    </span>
  );
}
function Die({ value }: { value: number }) {
  const dots: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  return (
    <div className="die" aria-label={`${value} 点`}>
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} className={dots[value].includes(i) ? "pip" : ""} />
      ))}
    </div>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const notice = useContext(NoticeContext);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-label={title}
    >
      <div className="modal-inner">
        <div className="modal-title">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={close}>
            <X size={21} />
          </button>
        </div>
        {notice && (
          <div className="modal-alert" role="alert">
            {notice}
          </div>
        )}
        {useContext(BalanceContext)}
        {children}
      </div>
    </dialog>
  );
}
function EventList({ room, limit = 150 }: { room: Room; limit?: number }) {
  return (
    <div className="event-list">
      {room.events.slice(0, limit).map((e) => (
        <div className={`event ${e.undone ? "undone" : ""}`} key={e.id}>
          <span
            className={`event-icon ${e.type === "rent" || e.type === "transfer" ? "green" : ""}`}
          >
            {e.type === "roll" ? (
              <Dices size={17} />
            ) : e.type === "buy" ? (
              <House size={17} />
            ) : e.type === "join" ? (
              <Users size={17} />
            ) : e.type === "undo" ? (
              <Undo2 size={17} />
            ) : (
              <ArrowLeftRight size={17} />
            )}
          </span>
          <div>
            <p>{e.text}</p>
            <span>
              {time(e.at)}
              {e.undone ? " · 已撤销" : ""}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(readSession);
  const sessionRef = useRef(session),
    previous = useRef<Room | null>(null);
  const [room, setRoom] = useState<Room | null>(null),
    [connected, setConnected] = useState(false),
    [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false),
    [notice, setNotice] = useState(""),
    [delta, setDelta] = useState<number | null>(null);
  const [tab, setTab] = useState("home"),
    [modal, setModal] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const [entry, setEntry] = useState<"create" | "join">("create"),
    [name, setName] = useState(""),
    [code, setCode] = useState("");
  const [initial, setInitial] = useState("15000"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [sortGroups, setSortGroups] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>({ ...DEFAULT_GAME_MODE });
  const [buildingCount, setBuildingCount] = useState(1);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const [diceCount, setDiceCount] = useState<DiceCount>(1);
  const [transferMode, setTransferMode] = useState<"pay" | "receive">("pay"),
    [target, setTarget] = useState("bank"),
    [amount, setAmount] = useState("");
  const [propertyOp, setPropertyOp] = useState(""),
    [propertyTarget, setPropertyTarget] = useState("");
  const [adminPlayer, setAdminPlayer] = useState(""),
    [adminAmount, setAdminAmount] = useState(""),
    [confirmAdmin, setConfirmAdmin] = useState("");
  const [manual, setManual] = useState<[number, number]>([1, 1]),
    [rolling, setRolling] = useState(false);
  const me = room?.players.find((p) => p.id === session?.playerId),
    host = room?.hostId === me?.id;
  const myProperties =
    room && me
      ? definitions.filter((d) => room.properties[d.id].ownerId === me.id)
      : [];
  const active = connected && ready && !pending;
  const canPlay = active && room?.status === "playing" && !me?.bankrupt;
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [tab, room?.code]);
  function updateRoom(next: Room) {
    const before = previous.current?.players.find(
      (p) => p.id === sessionRef.current?.playerId,
    )?.balance;
    const after = next.players.find(
      (p) => p.id === sessionRef.current?.playerId,
    )?.balance;
    if (
      previous.current?.code === next.code &&
      before !== undefined &&
      after !== undefined &&
      after !== before
    )
      setDelta(after - before);
    if (previous.current?.dice[0]?.id !== next.dice[0]?.id && next.dice[0])
      setRolling(true);
    previous.current = next;
    setRoom(next);
  }
  function clearSession() {
    localStorage.removeItem(sessionKey);
    sessionRef.current = null;
    setSession(null);
    setRoom(null);
    previous.current = null;
    setReady(socket.connected);
    setEntry("create");
    setTab("home");
    setModal(null);
    setSelected(null);
  }
  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      if (sessionRef.current)
        socket
          .timeout(8000)
          .emit(
            "resume",
            sessionRef.current,
            (err: Error | null, reply: Reply) => {
              if (err) {
                setNotice("恢复房间超时，正在重连");
                socket.disconnect().connect();
              } else if (!reply.ok) {
                clearSession();
                setNotice(reply.error!);
              } else {
                updateRoom(reply.room!);
                setInitial(String(reply.room!.initialMoney));
                setReady(true);
              }
            },
          );
      else setReady(true);
    };
    const onDisconnect = () => {
      setConnected(false);
      setReady(false);
    };
    const onKicked = () => {
      clearSession();
      setNotice("房主已将你移出房间");
    };
    const onEnded = () => { clearSession(); setNotice("房主已结束游戏，可以创建新的房间"); };
    socket
      .on("ended", onEnded)
      .on("connect", onConnect)
      .on("disconnect", onDisconnect)
      .on("room", updateRoom)
      .on("kicked", onKicked);
    socket.connect();
    return () => {
      socket
        .off("ended", onEnded)
        .off("connect", onConnect)
        .off("disconnect", onDisconnect)
        .off("room", updateRoom)
        .off("kicked", onKicked);
      socket.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (delta === null) return;
    const t = setTimeout(() => setDelta(null), 2500);
    return () => clearTimeout(t);
  }, [delta]);
  useEffect(() => {
    if (!rolling) return;
    const t = setTimeout(() => setRolling(false), 450);
    return () => clearTimeout(t);
  }, [rolling, room?.dice[0]?.id]);
  async function request(event: string, payload: unknown): Promise<Reply> {
    return new Promise((resolve) =>
      socket
        .timeout(8000)
        .emit(event, payload, (error: Error | null, reply: Reply) =>
          resolve(
            error
              ? { ok: false, error: "连接超时，请等待房间恢复后检查记录" }
              : reply,
          ),
        ),
    );
  }
  async function enterRoom(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const result = await request("enter", {
      mode: entry,
      name,
      ...(entry === "join" ? { code: code.toUpperCase() } : { diceCount, gameMode }),
    });
    if (result.ok) {
      sessionRef.current = result.session!;
      setSession(result.session!);
      localStorage.setItem(sessionKey, JSON.stringify(result.session));
      updateRoom(result.room!);
      setInitial(String(result.room!.initialMoney));
      setReady(true);
      setTab("home");
    } else setNotice(result.error!);
    setPending(false);
  }
  async function act(action: Action): Promise<boolean> {
    if (!room || !active) return false;
    setPending(true);
    const result = await request("action", {
      id: uuid(),
      revision: room.revision,
      action,
    });
    if (result.ok) {
      if (action.type === "end") clearSession();
      else if (result.room) updateRoom(result.room);
    } else {
      setNotice(result.error!);
      const resumed = await request("resume", sessionRef.current);
      if (resumed.ok) updateRoom(resumed.room!);
    }
    setPending(false);
    return result.ok;
  }
  const openProperty = (id: string) => {
    setSelected(id);
    setBuildingCount(1);
    setPropertyOp("");
    setPropertyTarget("");
  };
  const openTransfer = (mode: "pay" | "receive", playerId = "bank") => {
    setTransferMode(mode);
    setTarget(playerId);
    setAmount("");
    setModal("transfer");
  };
  const close = () => {
    if (!pending) {
      setModal(null);
      setSelected(null);
    }
  };
  const balanceCard = room && me ? (
    <section className="balance-card shared-balance" aria-label="我的资产">
      <div className="balance-label"><span><Wallet size={17} /> {me.name}{me.bankrupt ? " · 已破产，观战中" : ""}</span><span>已同步</span></div>
      <div className="asset-figures">
        <div><span>现金</span><strong>{money(me.balance)}</strong></div>
        <div><span>总额</span><strong>{money(assetsFor(room, me.id).total)}</strong></div>
      </div>
      <p className="asset-note">未抵押地产 {money(assetsFor(room, me.id).land)} · 建筑变现 {money(assetsFor(room, me.id).buildings)}</p>
    </section>
  ) : null;
  function propertyCard(d: PropertyDefinition, compact = false) {
    const state = room!.properties[d.id],
      owner = room!.players.find((p) => p.id === state.ownerId);
    return (
      <button
        className={`property-card ${compact ? "compact" : ""}`}
        key={d.id}
        onClick={() => openProperty(d.id)}
        style={
          {
            "--group": d.colorGroup ? groupColors[d.colorGroup - 1] : "#758d88",
          } as React.CSSProperties
        }
      >
        <div className="property-top">
          <span>{d.id}</span>
          {state.mortgaged ? (
            <LockKeyhole size={16} />
          ) : d.type === "station" ? (
            <TrainFront size={17} />
          ) : d.type === "utility" ? (
            <Zap size={17} />
          ) : (
            <MapPin size={17} />
          )}
        </div>
        <h3>{d.name}</h3>
        <span className="property-group">{groupName(d)}</span>
        <div className="property-bottom">
          <b>
            {owner
              ? state.mortgaged
                ? "已抵押"
                : state.hotel
                  ? "旅馆"
                  : state.houses
                    ? `${state.houses} 栋房屋`
                    : "空地"
              : money(d.purchasePrice)}
          </b>
          <span>
            {owner ? (owner.id === me?.id ? "我的" : owner.name) : "可购买"}
            <ChevronRight size={14} />
          </span>
        </div>
      </button>
    );
  }
  function dicePanel() {
    const roll = room?.dice[0];
    return (
      <>
        <div className={`dice-pair ${rolling ? "rolling" : ""}`}>
          {Array.from({ length: room?.diceCount ?? 1 }, (_, i) => (
            <Die key={i} value={roll?.values[i] || 1} />
          ))}
        </div>
        <div className="dice-result">
          {roll ? (
            <>
              <strong>{roll.total}</strong>
              <span>
                {room?.players.find((p) => p.id === roll.playerId)?.name ??
                  "已离开的玩家"}{" "}
                · {roll.manual ? "实体骰子" : "本次点数"}
                {roll.values.length === 2 && roll.values[0] === roll.values[1] ? " · 双骰相同" : ""}
              </span>
            </>
          ) : (
            <span>旅程的下一步，交给好运</span>
          )}
        </div>
        <button
          className="primary wide"
          disabled={!canPlay || rolling}
          onClick={() => void act({ type: "roll" })}
        >
          <Dices size={19} />
          {rolling ? "骰子落定中…" : "掷骰子"}
        </button>
        <button className="text-button wide" onClick={() => setModal("manual")}>
          使用实体骰子？手动录入 <ChevronRight size={14} />
        </button>
      </>
    );
  }

  const nav = [
    { id: "home", name: "总览", icon: Wallet },
    { id: "properties", name: "地产", icon: Building2 },
    { id: "dice", name: "骰子", icon: Dices },
    { id: "events", name: "记录", icon: History },
  ];
  return (
    <NoticeContext.Provider value={notice}>
    <BalanceContext.Provider value={balanceCard}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">
              <Landmark size={25} />
            </span>
            <div>
              <strong>
                中国之旅 <i>3007</i>
              </strong>
              <span>大富翁 · 桌游辅助器</span>
            </div>
          </div>
          {room && (
            <nav className="desktop-nav">
              {nav.map((n) => (
                <button
                  key={n.id}
                  className={tab === n.id ? "active" : ""}
                  onClick={() => setTab(n.id)}
                >
                  <n.icon size={17} />
                  {n.name}
                </button>
              ))}
            </nav>
          )}
          <div className="top-status">
            <span
              className={`connection ${connected && ready ? "" : "offline"}`}
            >
              <i />
              {connected && ready ? "实时连接" : "连接中"}
            </span>
            {me && (
              <button
                className="avatar-button"
                onClick={() => setModal("room")}
                aria-label="房间信息"
              >
                <Avatar player={me} small />
              </button>
            )}
          </div>
        </header>
        {notice && (
          <div className="toast" role="alert">
            {notice}
            <button aria-label="关闭提示" onClick={() => setNotice("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {delta !== null && (
          <div
            className={`money-feedback ${delta < 0 ? "negative" : ""}`}
            role="status"
          >
            {delta > 0 ? "+" : "−"}
            {money(Math.abs(delta))}
          </div>
        )}
        {!room || !me ? (
          <main className="entry-layout">
            <div className="entry-intro">
              <span className="eyebrow">
                <span /> THE JOURNEY STARTS HERE
              </span>
              <h1>
                朋友围桌，
                <br />
                快乐不找零<span>。</span>
              </h1>
              <p>
                放下纸币，带上好运。
                <br />
                你的中国之旅，交给随身桌游银行。
              </p>
              <div className="entry-ticket">
                <Landmark size={26} />
                <div>
                  <b>中国之旅 · 电子银行</b>
                  <span>41 张地产证 · 自选骰子 · 实时记账</span>
                </div>
                <span className="ticket-number">3007</span>
              </div>
              <div className="entry-foot">
                <ShieldCheck size={17} /> 自动保存旅程，刷新也能继续
              </div>
            </div>
            <section className="entry-form panel">
              <div className="section-kicker">准备出发</div>
              <h2>一起开启新旅程</h2>
              <p className="muted">和朋友在同一张桌上，也在同一个房间。</p>
              <div className="segments">
                <button
                  className={entry === "create" ? "selected" : ""}
                  onClick={() => setEntry("create")}
                >
                  创建房间
                </button>
                <button
                  className={entry === "join" ? "selected" : ""}
                  onClick={() => setEntry("join")}
                >
                  加入房间
                </button>
              </div>
              <form onSubmit={enterRoom}>
                <label>
                  你的昵称
                  <input
                    placeholder="朋友们怎么称呼你？"
                    maxLength={16}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
                {entry === "create" && (
                  <label>
                    骰子数量
                    <select value={diceCount} onChange={e => setDiceCount(Number(e.target.value) as DiceCount)} disabled={pending}>
                      <option value={1}>1 个骰子（默认）</option>
                      <option value={2}>2 个骰子</option>
                    </select>
                  </label>
                )}
                {entry === "create" && (
                  <fieldset className="mode-fields"><legend>胜负模式</legend>
                    <label>游戏模式<select value={gameMode.type} onChange={e => setGameMode({ ...gameMode, type: e.target.value as GameMode["type"] })}>
                      <option value="timed">限时现金赛</option><option value="survival">最后一人获胜</option>
                    </select></label>
                    {gameMode.type === "timed" && <>
                      <label>游戏时长（分钟）<input type="number" min="1" max="1440" required value={gameMode.durationMinutes || ""} onChange={e => setGameMode({ ...gameMode, durationMinutes: Number(e.target.value) })} /></label>
                      <label>目标现金（元）<input type="number" min="1" max="1000000000" required value={gameMode.targetCash || ""} onChange={e => setGameMode({ ...gameMode, targetCash: Number(e.target.value) })} /></label>
                      <p className="tiny">先达到目标者获胜；时间到按现金排名，同额并列。</p>
                    </>}
                  </fieldset>
                )}
                {entry === "join" && (
                  <label>
                    房间号
                    <input
                      placeholder="输入 6 位房间号"
                      maxLength={6}
                      className="code-input"
                      value={code}
                      onChange={(e) =>
                        setCode(
                          e.target.value
                            .toUpperCase()
                            .replace(/[^A-Z2-9]/g, ""),
                        )
                      }
                      required
                      minLength={6}
                    />
                  </label>
                )}
                <button
                  className="primary wide"
                  disabled={!connected || pending || !name.trim()}
                >
                  {pending
                    ? "正在进入…"
                    : entry === "create"
                      ? "创建我的房间"
                      : "加入朋友的房间"}
                  <ArrowRight size={18} />
                </button>
              </form>
              <div className="form-note">
                <Users size={17} />
                {entry === "create"
                  ? `创建后邀请朋友，最多支持 ${MAX_PLAYERS} 位玩家`
                  : "请向房主询问房间号，开局前加入"}
              </div>
            </section>
            <div className="entry-caption">
              实体棋盘上的冒险 · 屏幕里的小小银行
            </div>
          </main>
        ) : (
          <main className="workspace">
            {balanceCard}
            <div className="game-mode-summary">{room.mode.type === "timed" ? `限时现金赛 · 目标 ${money(room.mode.targetCash)} · ${room.status === "lobby" ? room.mode.durationMinutes + " 分钟" : "剩余 " + Math.max(0, Math.ceil(((room.deadline ?? now) - now) / 60000)) + " 分钟"}` : "生存赛 · 最后一名未破产玩家获胜"}</div>
            {room.status === "finished" && <section className="panel result-panel" role="status"><h2>{room.players.filter(p => room.winnerIds?.includes(p.id)).map(p => p.name).join("、") || "无人"}获胜</h2><p>{room.finishReason}。房主可以重新开始或结束游戏。</p></section>}
            {me.bankrupt && <p className="connection-banner">你已破产，资产已结清，可以继续观战。</p>}
            <div className="page-heading">
              <div>
                <span className="eyebrow">LET’S GO, TRAVELER</span>
                <h1>
                  {room.status === "lobby"
                    ? "人齐了，就出发。"
                    : tab === "home"
                      ? `你好，${me.name}`
                      : tab === "properties"
                        ? "下一站，你的地产。"
                        : tab === "dice"
                          ? "好运，就在下一掷。"
                          : "每一笔，都有记录。"}
                </h1>
                <p>
                  {room.status === "lobby"
                    ? "邀请朋友加入，准备好你们的第一笔旅途资金。"
                    : tab === "home"
                      ? "专心享受旅程，剩下的交给银行。"
                      : tab === "properties"
                        ? "一张地产证，一段属于你的旅程。"
                        : tab === "dice"
                          ? `掷出 ${room.diceCount} 个骰子，所有玩家实时看见结果。`
                          : "资金、产权与骰子，旅途中的每一步都在这里。"}
                </p>
              </div>
              <button className="room-badge" onClick={() => setModal("room")}>
                <span>
                  房间号<b>{room.code}</b>
                </span>
                <Users size={18} />
                <span>{room.players.length}</span>
              </button>
            </div>
            {(!connected || !ready) && (
              <div className="connection-banner" role="status">
                正在恢复连接，操作暂时停用。你的旅程已自动保存。
              </div>
            )}
            {room.status === "lobby" ? (
              <div className="lobby-grid">
                <section className="panel">
                  <div className="section-heading">
                    <h2>
                      <Users size={20} /> 旅途伙伴
                    </h2>
                    <span className="badge">{room.players.length} / {MAX_PLAYERS}</span>
                  </div>
                  <div className="player-list">
                    {room.players.map((p) => (
                      <div className="player-row" key={p.id}>
                        <Avatar player={p} />
                        <div className="player-name">
                          <b>
                            {p.name}
                            {p.id === me.id ? "（我）" : ""}
                          </b>
                          <span>
                            {p.bankrupt ? "已破产" : p.id === room.hostId
                              ? "房主"
                              : p.online
                                ? "已就位"
                                : "暂时离线"}
                          </span>
                        </div>
                        <span className="ready-tag">
                          {p.online ? "准备好了" : "等待重连"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="soft-note">
                    把房间号 <b>{room.code}</b> 告诉朋友，所有人加入后再开局。
                  </div>
                </section>
                <section className="panel setup">
                  <div className="section-heading">
                    <h2>
                      <Banknote size={20} /> 初始资金
                    </h2>
                    <span className="badge">房主设置</span>
                  </div>
                  <strong className="setup-money">
                    {money(room.initialMoney)}
                  </strong>
                  {host ? (
                    <>
                      <div className="quick-amounts">
                        {[15000, 20000].map((n) => (
                          <button
                            className={room.initialMoney === n ? "chosen" : ""}
                            key={n}
                            disabled={!active}
                            onClick={() => {
                              setInitial(String(n));
                              void act({ type: "settings", amount: n });
                            }}
                          >
                            {money(n)}
                          </button>
                        ))}
                      </div>
                      <form
                        className="inline-form"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          await act({
                            type: "settings",
                            amount: Number(initial),
                          });
                        }}
                      >
                        <input
                          aria-label="自定义初始资金"
                          type="number"
                          min="1"
                          max="1000000000"
                          value={initial}
                          onChange={(e) => setInitial(e.target.value)}
                          required
                        />
                        <button className="secondary" disabled={!active}>
                          设定
                        </button>
                      </form>
                      <button
                        className="primary wide"
                        disabled={
                          !active || Number(initial) !== room.initialMoney
                        }
                        onClick={() => void act({ type: "start" })}
                      >
                        人齐了，开始游戏 <ArrowRight size={18} />
                      </button>
                      {Number(initial) !== room.initialMoney && (
                        <p className="muted">请先点击“设定”保存初始资金。</p>
                      )}
                    </>
                  ) : (
                    <p className="soft-note">
                      房主正在准备资金，开局后将自动发放。
                    </p>
                  )}
                  <p className="tiny">每位玩家都会获得相同的初始资金 · 本房间使用 {room.diceCount} 个骰子</p>
                </section>
              </div>
            ) : (
              <>
                {tab === "home" && (
                  <div className="dashboard">
                    <div className="main-column">
                      <section className="quick-actions">
                        <button onClick={() => openTransfer("pay")}>
                          <span className="quick-icon olive">
                            <ArrowUpRight size={23} />
                          </span>
                          <b>支付</b>
                          <span>给银行或玩家</span>
                        </button>
                        <button onClick={() => openTransfer("receive")}>
                          <span className="quick-icon peach">
                            <ArrowDownLeft size={23} />
                          </span>
                          <b>收款</b>
                          <span>从银行或玩家</span>
                        </button>
                        <button onClick={() => setTab("properties")}>
                          <span className="quick-icon blue">
                            <Building2 size={23} />
                          </span>
                          <b>买地产</b>
                          <span>挑选下一站</span>
                        </button>
                        <button
                          onClick={() => {
                            setFilter("mine");
                            setTab("properties");
                          }}
                        >
                          <span className="quick-icon lilac">
                            <Banknote size={23} />
                          </span>
                          <b>收租</b>
                          <span>让地产赚点钱</span>
                        </button>
                      </section>
                      <section className="panel my-estates">
                        <div className="section-heading">
                          <h2>
                            我的地产{" "}
                            <span className="count">{myProperties.length}</span>
                          </h2>
                          <button
                            className="text-button"
                            onClick={() => {
                              setFilter("mine");
                              setTab("properties");
                            }}
                          >
                            查看全部 <ChevronRight size={16} />
                          </button>
                        </div>
                        {myProperties.length ? (
                          <div className="property-grid home-estates">
                            {myProperties
                              .slice(0, 4)
                              .map((d) => propertyCard(d, true))}
                          </div>
                        ) : (
                          <div className="empty-state">
                            <span className="empty-icon">
                              <Building2 size={29} />
                            </span>
                            <div>
                              <b>下一站，成为地主</b>
                              <p>买下第一张地产，收下旅途的第一份租金。</p>
                            </div>
                            <button
                              className="secondary"
                              onClick={() => setTab("properties")}
                            >
                              去看看 <ArrowRight size={15} />
                            </button>
                          </div>
                        )}
                        <div className="estate-summary">
                          <span>
                            <House size={15} />
                            {myProperties.reduce(
                              (n, d) => n + room.properties[d.id].houses,
                              0,
                            )}{" "}
                            栋房屋
                          </span>
                          <span>
                            <Hotel size={15} />
                            {
                              myProperties.filter(
                                (d) => room.properties[d.id].hotel,
                              ).length
                            }{" "}
                            座旅馆
                          </span>
                          <span>
                            <LockKeyhole size={15} />
                            {
                              myProperties.filter(
                                (d) => room.properties[d.id].mortgaged,
                              ).length
                            }{" "}
                            处抵押
                          </span>
                        </div>
                      </section>
                      <section className="panel">
                        <div className="section-heading">
                          <h2>旅途动态</h2>
                          <button
                            className="text-button"
                            onClick={() => setTab("events")}
                          >
                            全部记录 <ChevronRight size={16} />
                          </button>
                        </div>
                        <EventList room={room} limit={4} />
                      </section>
                    </div>
                    <aside className="side-column">
                      <section className="panel">
                        <div className="section-heading">
                          <h2>
                            旅途伙伴{" "}
                            <span className="count">{room.players.length}</span>
                          </h2>
                          <span className="live-label">
                            <Radio size={14} /> 实时
                          </span>
                        </div>
                        <div className="player-list">
                          {room.players.map((p) => (
                            <button
                              className={`player-row ${p.id === me.id ? "self" : ""}`}
                              key={p.id}
                              onClick={() =>
                                p.id !== me.id
                                  ? openTransfer("pay", p.id)
                                  : setModal("room")
                              }
                            >
                              <Avatar player={p} />
                              <span className="player-name">
                                <b>
                                  {p.name}
                                  {p.id === me.id && <em>我</em>}
                                </b>
                                <span>
                                  {p.bankrupt ? "已破产" : p.id === room.hostId
                                    ? "房主"
                                    : p.online
                                      ? "在线"
                                      : "离线"}{" "}
                                  ·{" "}
                                  {
                                    Object.values(room.properties).filter(
                                      (d) => d.ownerId === p.id,
                                    ).length
                                  }{" "}
                                  处地产
                                </span>
                              </span>
                              <strong>{money(p.balance)}</strong>
                            </button>
                          ))}
                        </div>
                      </section>
                      <section className="panel dice-card">
                        <div className="section-heading">
                          <h2>
                            <Dices size={19} /> 掷出好运
                          </h2>
                          <span className="badge">{room.diceCount === 1 ? "单骰" : "双骰"}</span>
                        </div>
                        {dicePanel()}
                      </section>
                      <button
                        className="undo-link"
                        disabled={
                          !room.undoActorId ||
                          (room.undoActorId !== me.id && !host) ||
                          !active
                        }
                        onClick={() => setModal("undo")}
                      >
                        <Undo2 size={17} /> 撤销最近一次操作
                      </button>
                    </aside>
                  </div>
                )}
                {tab === "properties" && (
                  <section className="properties-section">
                    <div className="property-toolbar">
                      <div className="search">
                        <Search size={18} />
                        <input
                          aria-label="搜索地产"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="搜索地产名称或编号"
                        />
                      </div>
                      <button
                        className={`secondary ${sortGroups ? "chosen" : ""}`}
                        onClick={() => setSortGroups(!sortGroups)}
                      >
                        <ListFilter size={17} />
                        {sortGroups ? "同色组查看" : "卡片编号排序"}
                      </button>
                    </div>
                    <div className="filters">
                      {[
                        ["all", "全部地产"],
                        ["mine", "我的地产"],
                        ["bank", "待售地产"],
                        ["station", "车站"],
                        ["utility", "公共事业"],
                      ].map(([id, title]) => (
                        <button
                          className={filter === id ? "chosen" : ""}
                          key={id}
                          onClick={() => setFilter(id)}
                        >
                          {title}
                          {id === "all" && <span>41</span>}
                        </button>
                      ))}
                    </div>
                    {sortGroups && (
                      <div className="group-legend">
                        {groupColors.map((color, i) => (
                          <button
                            className={
                              filter === `group${i + 1}` ? "chosen" : ""
                            }
                            key={color}
                            onClick={() => setFilter(`group${i + 1}`)}
                          >
                            <i style={{ background: color }} />
                            {i + 1} 组
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="property-grid all-estates">
                      {definitions
                        .filter(
                          (d) =>
                            (!query || `${d.name}${d.id}`.includes(query)) &&
                            (filter === "all" ||
                              (filter === "mine" &&
                                room.properties[d.id].ownerId === me.id) ||
                              (filter === "bank" &&
                                !room.properties[d.id].ownerId) ||
                              d.type === filter ||
                              filter === `group${d.colorGroup}`),
                        )
                        .map((d) => propertyCard(d))}
                    </div>
                    {!definitions.some(
                      (d) =>
                        (!query || `${d.name}${d.id}`.includes(query)) &&
                        (filter === "all" ||
                          (filter === "mine" &&
                            room.properties[d.id].ownerId === me.id) ||
                          (filter === "bank" &&
                            !room.properties[d.id].ownerId) ||
                          d.type === filter ||
                          filter === `group${d.colorGroup}`),
                    ) && (
                      <div className="empty-state">
                        <Search size={28} />
                        <p>没有找到地产，试试其他名称或分类。</p>
                      </div>
                    )}
                    <p className="data-note">
                      71-31 — 71-71 · 地产数值来自原始
                      JSON；标记为推定的购买价可在地产证内查看。
                    </p>
                  </section>
                )}
                {tab === "dice" && (
                  <div className="lobby-grid">
                    <section className="panel dice-full">
                      <div className="section-heading">
                        <h2>下一掷，轮到谁？</h2>
                        <span className="badge">实时同步</span>
                      </div>
                      {dicePanel()}
                    </section>
                    <section className="panel">
                      <div className="section-heading">
                        <h2>最近骰子</h2>
                        <span className="badge">最近 20 次</span>
                      </div>
                      {room.dice.length ? (
                        room.dice.map((d) => (
                          <div className="dice-history" key={d.id}>
                            <span>
                              <b>
                                {room.players.find((p) => p.id === d.playerId)
                                  ?.name ?? "已离开的玩家"}
                              </b>
                              <small>
                                {time(d.at)} ·{" "}
                                {d.manual ? "实体骰子" : "在线掷骰"}
                              </small>
                            </span>
                            <span>
                              {d.values.join(" + ")}
                              <strong>{d.total}</strong>
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="empty-state">
                          还没有掷骰记录，来试试手气。
                        </div>
                      )}
                    </section>
                  </div>
                )}
                {tab === "events" && (
                  <section className="panel records">
                    <div className="section-heading">
                      <h2>
                        游戏时间线{" "}
                        <span className="count">{room.events.length}</span>
                      </h2>
                      <button
                        className="secondary"
                        disabled={
                          !room.undoActorId ||
                          (room.undoActorId !== me.id && !host) ||
                          !active
                        }
                        onClick={() => setModal("undo")}
                      >
                        <Undo2 size={16} /> 撤销最近操作
                      </button>
                    </div>
                    <EventList room={room} />
                    <p className="tiny">
                      显示最近 150 条记录 · 完整日志由服务器保存
                    </p>
                  </section>
                )}
              </>
            )}
            <footer className="workspace-footer">
              <span>
                <ShieldCheck size={14} /> 旅程已自动保存
              </span>
              <button onClick={() => setModal("rules")}>桌游规则约定</button>
              {host && (
                <button
                  onClick={() => {
                    setConfirmAdmin("");
                    setModal("admin");
                  }}
                >
                  <Settings2 size={15} /> 房主管理
                </button>
              )}
            </footer>
            <nav className="mobile-nav">
              {nav.map((n) => (
                <button
                  key={n.id}
                  className={tab === n.id ? "active" : ""}
                  onClick={() => setTab(n.id)}
                >
                  <n.icon size={21} />
                  {n.name}
                </button>
              ))}
            </nav>
          </main>
        )}
        {room && me && modal === "transfer" && (
          <Modal title="桌游银行" close={close}>
            <div className="segments">
              <button
                className={transferMode === "pay" ? "selected" : ""}
                onClick={() => setTransferMode("pay")}
              >
                <ArrowUpRight size={17} /> 我要支付
              </button>
              <button
                className={transferMode === "receive" ? "selected" : ""}
                onClick={() => setTransferMode("receive")}
              >
                <ArrowDownLeft size={17} /> 我要收款
              </button>
            </div>
            <label>{transferMode === "pay" ? "支付给" : "收款自"}</label>
            <div className="recipient-grid">
              <button
                className={target === "bank" ? "chosen" : ""}
                onClick={() => setTarget("bank")}
              >
                <Landmark size={22} /> 银行
              </button>
              {room.players
                .filter((p) => p.id !== me.id && !p.bankrupt)
                .map((p) => (
                  <button
                    className={target === p.id ? "chosen" : ""}
                    key={p.id}
                    onClick={() => setTarget(p.id)}
                  >
                    <Avatar player={p} small />
                    {p.name}
                  </button>
                ))}
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await act({
                    type: "transfer",
                    from: transferMode === "pay" ? me.id : target,
                    to: transferMode === "pay" ? target : me.id,
                    amount: Number(amount),
                  })
                )
                  setModal(null);
              }}
            >
              <label>
                交易金额
                <div className="amount-input">
                  <span>¥</span>
                  <input
                    autoFocus
                    inputMode="numeric"
                    type="number"
                    min="1"
                    max="1000000000"
                    placeholder="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>
              </label>
              <div className="quick-amounts">
                {[100, 500, 1000, 2000].map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={Number(amount) === n ? "chosen" : ""}
                    onClick={() => setAmount(String(n))}
                  >
                    {n.toLocaleString()}
                  </button>
                ))}
              </div>
              <div className="transfer-preview">
                {transferMode === "pay"
                  ? me.name
                  : target === "bank"
                    ? "银行"
                    : room.players.find((p) => p.id === target)?.name}
                <ArrowRight size={16} />
                {transferMode === "receive"
                  ? me.name
                  : target === "bank"
                    ? "银行"
                    : room.players.find((p) => p.id === target)?.name}
                <b>{money(Number(amount) || 0)}</b>
              </div>
              <button
                className="primary wide"
                disabled={!canPlay || !Number(amount)}
              >
                {pending ? "正在记账…" : "确认交易"}
                <Check size={18} />
              </button>
            </form>
          </Modal>
        )}
        {room && me && selected && (
          <Modal title="地产证" close={close}>
            {(() => {
              const d = propertyById[selected],
                s = room.properties[selected],
                owner = room.players.find((p) => p.id === s.ownerId),
                canManage = host || s.ownerId === me.id,
                rent = rentFor(room, d.id);
              const ops: {
                id: Action["type"];
                label: string;
                disabled?: boolean;
              }[] = s.ownerId
                ? [
                    {
                      id: "rent",
                      label: canManage ? "收取租金" : "支付租金",
                      disabled: s.mortgaged,
                    },
                    ...(canManage
                      ? [
                          { id: "sell" as const, label: "出售地产给银行", disabled: s.mortgaged || s.hotel || s.houses > 0 },
                          {
                            id: s.mortgaged
                              ? ("redeem" as const)
                              : ("mortgage" as const),
                            label: s.mortgaged ? "赎回地产" : "抵押地产",
                          },
                          ...(d.type === "property"
                            ? [
                                {
                                  id: "build" as const,
                                  label: "建造房屋",
                                  disabled:
                                    s.mortgaged || s.hotel || s.houses >= 4,
                                },
                                {
                                  id: "hotel" as const,
                                  label: "升级旅馆",
                                  disabled:
                                    s.mortgaged || s.hotel || s.houses !== 4,
                                },
                                {
                                  id: "demolish" as const,
                                  label: s.hotel ? "出售旅馆 / 房屋" : "出售房屋",
                                  disabled:
                                    (!s.hotel && !s.houses),
                                },
                              ]
                            : []),
                        ]
                      : []),
                  ]
                : [{ id: "buy", label: "从银行购买" }];
              const price =
                propertyOp === "buy"
                  ? d.purchasePrice
                  : propertyOp === "build"
                    ? (d.buildingCost?.house ?? 0) * buildingCount
                    : propertyOp === "hotel"
                      ? d.buildingCost?.hotel
                      : propertyOp === "redeem" ? redemptionPrice(d)
                      : propertyOp === "sell" ? Math.floor(d.purchasePrice / 2)
                      : propertyOp === "mortgage"
                        ? d.mortgagePrice
                        : propertyOp === "rent"
                          ? rent
                          : propertyOp === "demolish"
                            ? Math.floor(d.buildingCost!.house / 2) * buildingCount
                            : 0;
              return (
                <>
                  <div
                    className="deed-header"
                    style={
                      {
                        "--group": d.colorGroup
                          ? groupColors[d.colorGroup - 1]
                          : "#758d88",
                      } as React.CSSProperties
                    }
                  >
                    <span>
                      {d.id} <i />
                      {groupName(d)}
                    </span>
                    <h2>{d.name}</h2>
                    <div>
                      {owner ? `产权人：${owner.name}` : "银行持有 · 待售"}
                      <b>
                        {s.mortgaged
                          ? "已抵押 · 暂停收租"
                          : s.hotel
                            ? "旅馆"
                            : `${s.houses} 栋房屋`}
                      </b>
                    </div>
                  </div>
                  <div className="deed-prices">
                    <div>
                      <span>
                        购买价{d.purchasePriceInferred ? "（推定）" : ""}
                      </span>
                      <b>{money(d.purchasePrice)}</b>
                    </div>
                    <div>
                      <span>抵押价</span>
                      <b>{money(d.mortgagePrice)}</b>
                    </div>
                    <div>
                      <span>当前租金</span>
                      <b>
                        {d.type === "utility" && !room.dice[0]
                          ? "请先掷骰"
                          : money(rent)}
                      </b>
                    </div>
                  </div>
                  {d.type === "property" ? (
                    <>
                      <div className="rent-table">
                        {[
                          ["空地", d.rent!.land],
                          ["1 栋房屋", d.rent!.house1],
                          ["2 栋房屋", d.rent!.house2],
                          ["3 栋房屋", d.rent!.house3],
                          ["4 栋房屋", d.rent!.house4],
                          ["旅馆", d.rent!.hotel],
                        ].map(([title, value]) => (
                          <div key={title}>
                            <span>{title}</span>
                            <b>{money(Number(value))}</b>
                          </div>
                        ))}
                      </div>
                      <div className="building-fees">
                        <span>
                          房屋建筑费 <b>{money(d.buildingCost!.house)}</b>
                        </span>
                        <span>
                          旅馆建筑费 <b>{money(d.buildingCost!.hotel)}</b>
                        </span>
                      </div>
                      {s.ownerId &&
                        !s.hotel &&
                        !s.houses &&
                        !s.mortgaged &&
                        rent === d.rent!.land! * 2 && (
                          <p className="soft-note">已集齐同色组，空地租金 ×2</p>
                        )}
                    </>
                  ) : (
                    <p className="soft-note">
                      {d.type === "station"
                        ? "拥有 1 / 2 / 3 / 4 个车站，租金为 ¥250 / ¥500 / ¥1,000 / ¥2,000。"
                        : `拥有一处：骰子 ×10；同时拥有两处：骰子 ×100。本次骰子：${room.dice[0]?.total ?? "尚未投掷"} 点。`}
                    </p>
                  )}
                  <div className="property-operations">
                    {ops.map((op) => (
                      <button
                        disabled={op.disabled || !active || me.bankrupt || room.status !== "playing"}
                        className={propertyOp === op.id ? "chosen" : ""}
                        key={op.id}
                        onClick={() => {
                          setPropertyOp(op.id);
                          setBuildingCount(1);
                          setPropertyTarget(
                            op.id === "rent" && !canManage ? me.id : "",
                          );
                        }}
                      >
                        {op.label}
                      </button>
                    ))}
                  </div>
                  {propertyOp && (
                    <form
                      className="operation-confirm"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (
                          await act({
                            type: propertyOp as Action["type"],
                            propertyId: selected,
                            ...(["build", "demolish"].includes(propertyOp) ? { count: buildingCount } : {}),
                            ...(propertyTarget
                              ? { playerId: propertyTarget }
                              : {}),
                            ...(d.type === "utility" && propertyOp === "rent"
                              ? { diceId: room.dice[0]?.id }
                              : {}),
                          })
                        ) {
                          setPropertyOp("");
                          if (
                            propertyOp === "buy" ||
                            propertyOp === "sell" ||
                            propertyOp === "rent"
                          )
                            setSelected(null);
                        }
                      }}
                    >
                      <b>
                        {ops.find((o) => o.id === propertyOp)?.label}
                        {price
                          ? ` · ${propertyOp === "mortgage" || propertyOp === "demolish" || propertyOp === "sell" ? "+" : ""}${money(price)}`
                          : ""}
                      </b>
                      {propertyOp === "rent" && (
                        <label>
                          选择付款玩家
                          <select
                            value={propertyTarget}
                            onChange={(e) => setPropertyTarget(e.target.value)}
                            required
                          >
                            <option value="">请选择玩家</option>
                            {room.players
                              .filter(
                                (p) =>
                                  !p.bankrupt && p.id !== s.ownerId &&
                                  (propertyOp !== "rent" ||
                                    canManage ||
                                    p.id === me.id),
                              )
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} · {money(p.balance)} · 总额 {money(assetsFor(room, p.id).total)}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                      {["build", "demolish"].includes(propertyOp) && <label>
                        {propertyOp === "build" ? "建造栋数" : "售卖栋数"}
                        <select value={buildingCount} onChange={e => setBuildingCount(Number(e.target.value))}>
                          {Array.from({ length: propertyOp === "build" ? Math.max(0, 4 - s.houses) : s.hotel ? 5 : s.houses }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} 栋</option>)}
                        </select>
                      </label>}
                      {propertyOp === "rent" && propertyTarget && <p className="soft-note">{assetsFor(room, propertyTarget).total < rent ? `付款玩家总额 ${money(assetsFor(room, propertyTarget).total)} 不足，将自动破产清算，全部地产与建筑归银行。` : "现金不足但总额足够时，请付款玩家先卖房或抵押。"}</p>}
                      {propertyOp === "mortgage" && (
                        <p>
                          抵押保留现有建筑，暂停收租，获得{" "}
                          {money(d.mortgagePrice)}。
                        </p>
                      )}
                      {propertyOp === "redeem" && (
                        <p>缴回抵押本金及 10% 利息，恢复收租。</p>
                      )}
                      {propertyOp === "sell" && (
                        <p>
                          无建筑、未抵押的地产按购买价的一半出售给银行。
                        </p>
                      )}
                      {propertyOp === "demolish" && (
                        <p>
                          {s.hotel ? "旅馆折算为 5 栋房屋，卖出所选数量后保留剩余房屋。" : ""}
                          每栋返还原房屋建筑费的 50%。
                        </p>
                      )}
                      <button
                        className="primary wide"
                        disabled={
                          !canPlay ||
                          (propertyOp === "rent" &&
                            (!rent ||
                              (d.type === "utility" && !room.dice.length)))
                        }
                      >
                        {pending ? "处理中…" : "确认操作"}
                        <Check size={17} />
                      </button>
                    </form>
                  )}
                </>
              );
            })()}
          </Modal>
        )}
        {room && modal === "manual" && (
          <Modal title="录入实体骰子" close={close}>
            <p className="muted">
              输入 {room.diceCount} 个骰子的点数，所有玩家会同步看到。
            </p>
            <div className="manual-dice">
              {manual.slice(0, room.diceCount).map((value, i) => (
                <label key={i}>
                  第 {i + 1} 个骰子
                  <select
                    aria-label={`第 ${i + 1} 个骰子`}
                    value={value}
                    onChange={(e) =>
                      setManual((old) =>
                        i === 0
                          ? [Number(e.target.value), old[1]]
                          : [old[0], Number(e.target.value)],
                      )
                    }
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n} 点
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              className="primary wide"
              disabled={!canPlay}
              onClick={async () => {
                if (await act({ type: "roll", values: room.diceCount === 1 ? [manual[0]] : manual })) setModal(null);
              }}
            >
              确认 {manual.slice(0, room.diceCount).reduce((sum, value) => sum + value, 0)} 点
            </button>
          </Modal>
        )}
        {room && modal === "undo" && (
          <Modal title="撤销最近操作" close={close}>
            <p>将同时恢复这次操作涉及的余额、产权、建筑或骰子。</p>
            <div className="soft-note">
              {room.events.find((e) => e.id === room.undoEventId)?.text ??
                "没有可撤销的操作"}
            </div>
            <button
              className="primary wide"
              disabled={!active || !room.undoEventId}
              onClick={async () => {
                if (await act({ type: "undo" })) setModal(null);
              }}
            >
              确认撤销
            </button>
          </Modal>
        )}
        {room && modal === "room" && (
          <Modal title="我们的小小旅途" close={close}>
            <div className="room-code-large">
              <span>房间号</span>
              <strong>{room.code}</strong>
            </div>
            <button
              className="secondary wide"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(room.code);
                  setNotice("房间号已复制");
                } catch {
                  setNotice(`房间号：${room.code}`);
                }
              }}
            >
              <Copy size={17} /> 复制房间号
            </button>
            <p className="muted">
              朋友打开同一个网站，输入房间号和昵称即可在开局前加入。刷新页面会自动回到这里。
            </p>
            <div className="soft-note">
              {room.status === "lobby" ? "等待出发" : room.status === "finished" ? "本局已结算" : "游戏进行中"} ·{" "}
              {room.players.length} / {MAX_PLAYERS} 位玩家 · {room.diceCount} 个骰子 · 初始资金 {money(room.initialMoney)}
            </div>
            <button
              className="text-button wide"
              onClick={() => {
                socket.disconnect();
                clearSession();
                socket.connect();
              }}
            >
              {" "}
              <DoorOpen size={16} /> 退出此设备的房间身份
            </button>
            <p className="tiny">
              退出身份后无法恢复原玩家；暂时离开请直接关闭页面。
            </p>
          </Modal>
        )}
        {room && host && modal === "admin" && (
          <Modal title="房主管理" close={close}>
            <p className="muted">纠错会同步给所有玩家，并保留游戏记录。</p>
            <label>
              选择玩家
              <select
                value={adminPlayer}
                onChange={(e) => {
                  setAdminPlayer(e.target.value);
                  setAdminAmount(
                    String(
                      room.players.find((p) => p.id === e.target.value)
                        ?.balance ?? 0,
                    ),
                  );
                  setConfirmAdmin("");
                }}
              >
                <option value="">请选择玩家</option>
                {room.players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {money(p.balance)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              修正为此余额
              <input
                type="number"
                min="0"
                max="1000000000"
                value={adminAmount}
                onChange={(e) => setAdminAmount(e.target.value)}
                placeholder="输入正确余额"
              />
            </label>
            <button
              className="secondary wide"
              disabled={
                !active ||
                !adminPlayer ||
                !adminAmount ||
                room.status !== "playing"
              }
              onClick={() =>
                void act({
                  type: "balance",
                  playerId: adminPlayer,
                  amount: Number(adminAmount),
                })
              }
            >
              保存余额纠错
            </button>

            <div className="admin-danger">
              <button
                className="secondary"
                disabled={!adminPlayer || adminPlayer === me?.id}
                onClick={() => setConfirmAdmin("kick")}
              >
                移除所选玩家
              </button>
              <button
                className="secondary"
                onClick={() => setConfirmAdmin("restart")}
              >
                重新开始
              </button>
              <button className="danger" onClick={() => setConfirmAdmin("end")}>结束游戏</button>
            </div>
            {confirmAdmin && (
              <div className="operation-confirm">
                <p>
                  {confirmAdmin === "kick"
                    ? `确认移除${room.players.find((p) => p.id === adminPlayer)?.name}？其地产与建筑将收回银行，此操作不可撤销。`
                    : confirmAdmin === "end" ? "确认结束游戏？所有人将返回创建房间页面，本房间不可恢复。"
                    : `确认重开？所有玩家（含破产玩家）余额恢复为 ${money(room.initialMoney)}，地产与骰子清空，日志保留。此操作不可撤销。`}
                </p>
                <button
                  className="danger wide"
                  disabled={!active}
                  onClick={async () => {
                    if (
                      await act({
                        type: confirmAdmin as "kick" | "restart" | "end",
                        ...(confirmAdmin === "kick"
                          ? { playerId: adminPlayer }
                          : {}),
                      })
                    ) {
                      setConfirmAdmin("");
                      setAdminPlayer("");
                    }
                  }}
                >
                  确认{confirmAdmin === "kick" ? "移除" : confirmAdmin === "end" ? "结束游戏" : "重新开始"}
                </button>
                <button className="secondary wide" onClick={() => setConfirmAdmin("")}>取消</button>
              </div>
            )}
          </Modal>
        )}
        {modal === "rules" && (
          <Modal title="这一桌的规则" close={close}>
            <div className="rules">
              <p>
                <b>钱与地产</b> ·
                金额只支持整数。付款时现金不足但总额足够，请先变现；总额不足则破产，总额交给债主，地产与建筑收回银行。购买、建房等自愿支出余额不足时不执行。你可以代扣其他玩家向自己的付款，适合彼此信任的围桌游戏；所有操作公开记账。
              </p>
              <p>
                <b>建筑与抵押</b> ·
                可直接在自有地产建房，无需集齐色组或均衡建造。最多 4
                栋，再支付旅馆建筑费升级。抵押保留建筑但停收租；赎回需本金加 10% 利息。房屋半价出售，旅馆折算 5 栋房屋后按所选数量出售；空地半价售给银行，抵押地产不可出售。
              </p>
              <p>
                <b>自动租金</b> ·
                同色组全部归同一人时，该玩家无建筑的地块收双倍空地租金。抵押地产不收租，但仍计入同组、车站和公共事业的拥有数量。
              </p>
              <p>
                <b>地产来源</b> · 所有 41 张卡片均使用提供的
                properties.json。购买价带有推定标记，界面保留该标记；色组颜色仅用于区分。
              </p>
              <p>
                <b>撤销与保存</b> ·
                仅操作者或房主可撤销最近一笔可撤销操作。加入、踢人和重开会清除撤销机会。所有人离线
                24 小时后房间会清理。
              </p>
            </div>
          </Modal>
        )}
      </div>
    </BalanceContext.Provider>
    </NoticeContext.Provider>
  );
}
