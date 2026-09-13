import { randomInt, randomUUID } from "node:crypto";
import { assetsFor, redemptionPrice, definitions, money, propertyById, rentFor } from "../shared/rules";
import { DEFAULT_GAME_MODE, MAX_PLAYERS, type GameMode, type DiceCount, type DiceValues } from "../shared/types";
import type {
  Action,
  GameEvent,
  Player,
  Room,
  Transaction,
} from "../shared/types";
export interface UndoState {
  players: Player[];
  properties: Room["properties"];
  dice: Room["dice"];
  eventId: string;
  actorId: string;
  status: Room["status"];
  winnerIds?: string[];
  finishReason?: string;
}
export interface StoredRoom extends Room {
  undo?: UndoState;
}
export function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function blankProperties(): Room["properties"] {
  return Object.fromEntries(
    definitions.map((d) => [
      d.id,
      { id: d.id, ownerId: null, houses: 0, hotel: false, mortgaged: false },
    ]),
  );
}
export function makeRoom(code: string, host: Player, diceCount: DiceCount = 1, mode: GameMode = DEFAULT_GAME_MODE): StoredRoom {
  check(diceCount === 1 || diceCount === 2, "骰子数量只能为 1 或 2");
  return {
    code,
    hostId: host.id,
    status: "lobby",
    mode: { ...mode },
    initialMoney: 15000,
    diceCount,
    players: [host],
    properties: blankProperties(),
    events: [],
    dice: [],
    revision: 0,
    updatedAt: Date.now(),
  };
}
export function settleOutcome(room: StoredRoom, now = Date.now()): boolean {
  if (room.status !== "playing") return false;
  const alive = room.players.filter(p => !p.bankrupt);
  let winners: Player[] | undefined;
  let reason = "";
  if (room.mode.type === "timed") {
    if (room.deadline !== undefined && now >= room.deadline) {
      const highest = Math.max(...alive.map(p => p.balance));
      winners = alive.filter(p => p.balance === highest);
      reason = "时间到，按现金排名结算";
    } else {
      const reached = alive.filter(p => p.balance >= room.mode.targetCash);
      if (reached.length) { winners = reached; reason = "现金达到目标"; }
    }
  } else if (alive.length <= 1 && (room.startedPlayerCount ?? room.players.length) >= 2) {
    winners = alive;
    reason = "只剩一名未破产玩家";
  }
  if (!winners) return false;
  room.status = "finished";
  room.winnerIds = winners.map(p => p.id);
  room.finishReason = reason;
  return true;
}
export function outcomeText(room: Room) {
  return `${room.finishReason} · ${room.players.filter(p => room.winnerIds?.includes(p.id)).map(p => p.name).join("、") || "无人"}获胜`;
}
export function log(
  room: StoredRoom,
  actorId: string,
  type: string,
  text: string,
  transactions: Transaction[] = [],
): GameEvent {
  const event = {
    id: randomUUID(),
    actorId,
    type,
    text,
    at: Date.now(),
    transactions,
  };
  room.events.unshift(event);
  room.events = room.events.slice(0, 150);
  room.revision++;
  room.updatedAt = Date.now();
  return event;
}
export function applyAction(
  room: StoredRoom,
  actorId: string,
  action: Action,
): GameEvent {
  const actor = room.players.find((p) => p.id === actorId);
  check(actor, "你已不在这个房间");
  const host = actorId === room.hostId;
  const { type } = action;
  const admin = ["settings", "start", "restart", "balance", "kick", "end"];
  if (admin.includes(type)) check(host, "只有房主可以执行此操作");
  check(room.status !== "closed", "游戏已结束，房间已关闭");
  check(!actor.bankrupt || admin.includes(type) || type === "undo", "你已破产，当前只能观战");
  if (!["settings", "start", "restart", "kick", "end", "undo"].includes(type))
    check(room.status === "playing", "请等待房主开局");
  const player = (id?: string) => {
    const p = room.players.find((p) => p.id === id);
    check(p, "请选择有效玩家");
    return p;
  };
  const amount = (v: unknown, zero = false) => {
    check(
      typeof v === "number" &&
        Number.isSafeInteger(v) &&
        v >= (zero ? 0 : 1) &&
        v <= 1_000_000_000,
      "请输入有效的整数金额（最多十亿元）",
    );
    return v;
  };
  const txs: Transaction[] = [];
  let bankruptcyText = "";
  const pay = (from: string, to: string, value: number, reason: string, debt = false) => {
    amount(value);
    check(from !== to, "收付款方不能相同");
    if (to !== "bank") check(!player(to).bankrupt, "收款玩家已破产");
    if (from !== "bank") {
      const p = player(from);
      check(!p.bankrupt, "付款玩家已破产");
      const total = assetsFor(room, p.id).total;
      if (debt && total < value) {
        if (to !== "bank") check(player(to).balance + total <= 1_000_000_000, "余额超过上限");
        const liquidation = total - p.balance;
        if (liquidation) txs.push({ id: randomUUID(), from: "bank", to: p.id, amount: liquidation, reason: "破产资产清算" });
        if (total) txs.push({ id: randomUUID(), from: p.id, to, amount: total, reason: "破产偿付" });
        p.balance = 0;
        p.bankrupt = true;
        if (to !== "bank") player(to).balance += total;
        for (const s of Object.values(room.properties))
          if (s.ownerId === p.id) Object.assign(s, { ownerId: null, houses: 0, hotel: false, mortgaged: false });
        bankruptcyText = `；${p.name}破产，总额 ${money(total)} 归${to === "bank" ? "银行" : player(to).name}，全部地产与建筑归银行`;
        return;
      }
      check(p.balance >= value, `${p.name}余额不足，请先卖房或抵押地产（总额 ${money(total)}）`);
      p.balance -= value;
    }
    if (to !== "bank") {
      const p = player(to);
      check(p.balance + value <= 1_000_000_000, "余额超过上限");
      p.balance += value;
    }
    txs.push({ id: randomUUID(), from, to, amount: value, reason });
  };
  const label = (id: string) => (id === "bank" ? "银行" : player(id).name);
  const before: UndoState = {
    players: structuredClone(room.players),
    properties: structuredClone(room.properties),
    dice: structuredClone(room.dice),
    eventId: "",
    actorId,
    status: room.status,
    winnerIds: room.winnerIds,
    finishReason: room.finishReason,
  };
  let text = "";
  if (type === "undo") {
    check(room.undo, "没有可撤销的操作");
    check(host || room.undo.actorId === actorId, "仅操作者或房主可撤销");
    const undo = room.undo;
    room.players = undo.players;
    room.properties = undo.properties;
    room.dice = undo.dice;
    room.status = undo.status;
    room.winnerIds = undo.winnerIds;
    room.finishReason = undo.finishReason;
    const old = room.events.find((e) => e.id === undo.eventId);
    if (old) old.undone = true;
    room.undo = undefined;
    return log(
      room,
      actorId,
      type,
      `${actor.name}撤销了「${old?.text ?? "最近操作"}」`,
    );
  }
  if (type === "end") {
    room.status = "closed";
    text = `${actor.name}结束游戏，所有玩家返回创建房间页面`;
  } else if (type === "settings") {
    check(room.status === "lobby", "开局后不能修改初始资金");
    room.initialMoney = amount(action.amount);
    text = `初始资金设为 ${money(room.initialMoney)}`;
  } else if (type === "start" || type === "restart") {
    check(room.players.length <= MAX_PLAYERS, `房间最多 ${MAX_PLAYERS} 位玩家，请先移除多余玩家`);
    if (type === "start") check(room.status === "lobby", "游戏已经开始");
    room.status = "playing";
    room.startedAt = Date.now();
    room.startedPlayerCount = room.players.length;
    room.deadline = room.mode.type === "timed" ? room.startedAt + room.mode.durationMinutes * 60_000 : undefined;
    room.winnerIds = undefined;
    room.finishReason = undefined;
    room.properties = blankProperties();
    room.dice = [];
    room.players.forEach((p) => {
      p.balance = room.initialMoney;
      p.bankrupt = false;
    });
    text = `${actor.name}${type === "restart" ? "重新开始游戏" : "开启中国之旅"} · 每人 ${money(room.initialMoney)}`;
  } else if (type === "kick") {
    const target = player(action.playerId);
    check(target.id !== room.hostId, "不能移除房主");
    room.players = room.players.filter((p) => p.id !== target.id);
    for (const state of Object.values(room.properties))
      if (state.ownerId === target.id)
        Object.assign(state, {
          ownerId: null,
          houses: 0,
          hotel: false,
          mortgaged: false,
        });
    text = `${actor.name}移除了${target.name}，其地产收回银行`;
  } else if (type === "balance") {
    const target = player(action.playerId);
    const next = amount(action.amount, true);
    check(!target.bankrupt, "破产玩家请通过重新开始恢复");
    text = `房主纠错：${target.name}余额 ${money(target.balance)} → ${money(next)}`;
    target.balance = next;
  } else if (type === "transfer") {
    check(action.from && action.to, "请选择收付款方");
    check(
      action.from === actorId || action.to === actorId || host,
      "你只能操作与自己相关的转账",
    );
    pay(action.from, action.to, amount(action.amount), "转账", true);
    text = `${label(action.from)} → ${label(action.to)} ${money(action.amount!)}`;
  } else if (type === "roll") {
    const values: DiceValues = action.values ?? (room.diceCount === 1
      ? [randomInt(1, 7)]
      : [randomInt(1, 7), randomInt(1, 7)]);
    check(values.length === room.diceCount, `本房间使用 ${room.diceCount} 个骰子，请录入对应数量`);
    check(
      values.every((n) => Number.isInteger(n) && n >= 1 && n <= 6),
      "每个骰子需为 1～6 点",
    );
    const total = values.reduce((sum, value) => sum + value, 0);
    room.dice.unshift({
      id: randomUUID(),
      playerId: actorId,
      values,
      total,
      manual: !!action.values,
      at: Date.now(),
    });
    room.dice = room.dice.slice(0, 20);
    text = `${actor.name}${action.values ? "录入实体骰子" : "掷出骰子"} ${values.join(" + ")} = ${total}`;
  } else {
    const def = propertyById[action.propertyId ?? ""],
      state = room.properties[action.propertyId ?? ""];
    check(def && state, "地产不存在");
    if (type === "buy") {
      check(!state.ownerId, "这张地产已被购买");
      pay(actorId, "bank", def.purchasePrice, `购买${def.name}`);
      state.ownerId = actorId;
      text = `${actor.name}买下${def.name} · ${money(def.purchasePrice)}`;
    } else {
      check(state.ownerId, "地产尚未售出");
      const owner = player(state.ownerId);
      check(
        host ||
          owner.id === actorId ||
          (type === "rent" && action.playerId === actorId),
        "只有产权人或房主可以操作",
      );
      if (type === "sell") {
        check(!state.mortgaged, "抵押中的地产不可出售");
        check(!state.hotel && state.houses === 0, "请先出售全部建筑");
        const refund = Math.floor(def.purchasePrice / 2);
        pay("bank", owner.id, refund, `出售${def.name}`);
        state.ownerId = null;
        text = `${owner.name}将${def.name}按半价出售给银行 · +${money(refund)}`;
      } else if (type === "mortgage") {
        check(!state.mortgaged, "地产已经抵押");
        pay("bank", owner.id, def.mortgagePrice, `抵押${def.name}`);
        state.mortgaged = true;
        text = `${owner.name}抵押${def.name} · +${money(def.mortgagePrice)}`;
      } else if (type === "redeem") {
        check(state.mortgaged, "地产未抵押");
        pay(owner.id, "bank", redemptionPrice(def), `赎回${def.name}（含10%利息）`);
        state.mortgaged = false;
        text = `${owner.name}赎回${def.name}（含10%利息） · ${money(redemptionPrice(def))}`;
      } else if (type === "rent") {
        check(!state.mortgaged, "抵押中的地产不能收租");
        if (def.type === "utility")
          check(
            room.dice[0] && room.dice[0].id === action.diceId,
            "骰子结果已变化，请重新确认租金",
          );
        const payer = player(action.playerId);
        const rent = rentFor(room, def.id);
        pay(payer.id, owner.id, rent, `${def.name}租金`, true);
        text = `${payer.name} → ${owner.name} ${money(rent)} · ${def.name}租金`;
      } else {
        check(def.type === "property" && def.buildingCost, "此地产不能建房");
        if (type !== "demolish") check(!state.mortgaged, "请先赎回地产");
        const count = action.count ?? 1;
        check(Number.isInteger(count) && count >= 1 && count <= 5, "栋数必须为 1～5 的整数");
        if (type === "build") {
          check(!state.hotel && state.houses + count <= 4, "最多 4 栋房屋，请调整数量或升级旅馆");
          pay(owner.id, "bank", def.buildingCost.house * count, `在${def.name}建房`);
          state.houses += count;
          text = `${owner.name}在${def.name}建造 ${count} 栋房屋（现有 ${state.houses} 栋）`;
        } else if (type === "hotel") {
          check(!state.hotel && state.houses === 4, "需先建满 4 栋房屋");
          pay(owner.id, "bank", def.buildingCost.hotel, `升级${def.name}旅馆`);
          state.houses = 0;
          state.hotel = true;
          text = `${owner.name}将${def.name}升级为旅馆`;
        } else if (type === "demolish") {
          check(state.hotel || state.houses > 0, "这里还没有建筑");
          const available = state.hotel ? 5 : state.houses;
          check(count <= available, "售卖栋数超过现有建筑");
          const refund = Math.floor(def.buildingCost.house / 2) * count;
          pay("bank", owner.id, refund, `拆除${def.name}建筑`);
          state.hotel = false;
          state.houses = available - count;
          text = `${owner.name}出售${def.name}的 ${count} 栋房屋（剩余 ${state.houses} 栋） · +${money(refund)}`;
        } else throw new Error("不支持的操作");
      }
    }
  }
  text += bankruptcyText;
  if (settleOutcome(room)) text += `；${outcomeText(room)}`;
  const event = log(room, actorId, type, text, txs);
  room.undo = ["settings", "start", "restart", "kick", "end"].includes(type)
    ? undefined
    : { ...before, eventId: event.id };
  return event;
}
