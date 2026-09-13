import express from "express";
import { createServer } from "node:http";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Server } from "socket.io";
import { z } from "zod";
import { Store } from "./store";
import { applyAction, check, log, makeRoom, type StoredRoom } from "./engine";
import type { Reply, Room, Session } from "../shared/types";
import { MAX_PLAYERS } from "../shared/types";

const app = express(),
  http = createServer(app);
const io = new Server(http, { maxHttpBufferSize: 16_384 });
const store = new Store(process.env.DB_PATH || resolve("data/game.sqlite"));
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const sessionSchema = z.object({
  code: z.string().regex(/^[A-Z2-9]{6}$/),
  playerId: z.string().uuid(),
  token: z.string().length(48),
});
const nickname = z
  .string()
  .trim()
  .min(1, "请输入昵称")
  .max(16, "昵称最多 16 字");
const actionSchema = z.object({
  type: z.enum([
    "settings",
    "start",
    "restart",
    "transfer",
    "buy",
    "give",
    "mortgage",
    "redeem",
    "build",
    "demolish",
    "hotel",
    "rent",
    "roll",
    "undo",
    "balance",
    "kick",
  ]),
  propertyId: z.string().max(10).optional(),
  playerId: z.string().uuid().optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  amount: z.number().int().min(0).max(1_000_000_000).optional(),
  values: z.union([
    z.tuple([z.number().int().min(1).max(6)]),
    z.tuple([z.number().int().min(1).max(6), z.number().int().min(1).max(6)]),
  ]).optional(),
  diceId: z.string().uuid().optional(),
});
const online = (code: string, id: string) =>
  [...io.sockets.sockets.values()].some(
    (s) => s.data.session?.code === code && s.data.session?.playerId === id,
  );
function view(room: StoredRoom): Room {
  const { undo, ...publicRoom } = room;
  return {
    ...publicRoom,
    players: room.players.map((p) => ({
      ...p,
      online: online(room.code, p.id),
    })),
    undoActorId: undo?.actorId,
    undoEventId: undo?.eventId,
  };
}
function broadcast(code: string) {
  const room = store.get(code);
  if (room) io.to(code).emit("room", view(room));
}
function authenticate(session: Session) {
  const match = store.db
    .prepare("SELECT player FROM sessions WHERE token=? AND code=?")
    .get(hash(session.token), session.code) as { player: string } | undefined;
  check(
    match?.player === session.playerId,
    "房间已过期或你已被移出，请重新加入",
  );
  const room = store.get(session.code);
  check(
    room && room.players.some((p) => p.id === session.playerId),
    "房间不存在",
  );
  return room;
}
const limits = new Map<string, { count: number; at: number }>();
io.on("connection", (socket) => {
  socket.onAny(() => {
    /* Mutations are individually validated below. */
  });
  const handle = (event: string, run: (data: unknown) => Reply) =>
    socket.on(event, (data: unknown, ack: (reply: Reply) => void) => {
      if (typeof ack !== "function") return;
      try {
        const key = `${socket.handshake.address}:${event === "enter" ? "entry" : socket.id}`;
        let limit = limits.get(key);
        if (!limit || Date.now() - limit.at > 60_000) {
          limit = { count: 0, at: Date.now() };
          limits.set(key, limit);
        }
        check(
          ++limit.count <= (event === "enter" ? 30 : 180),
          "操作太快了，请稍后再试",
        );
        ack(run(data));
      } catch (error) {
        ack({
          ok: false,
          error:
            error instanceof z.ZodError
              ? error.issues[0].message
              : error instanceof Error
                ? error.message
                : "操作失败，请重试",
        });
      }
    });
  function attach(session: Session) {
    const old = socket.data.session as Session | undefined;
    if (old) socket.leave(old.code);
    socket.data.session = session;
    socket.join(session.code);
    if (old && old.code !== session.code) broadcast(old.code);
  }
  handle("enter", (data) => {
    const input = z
      .object({
        mode: z.enum(["create", "join"]),
        name: nickname,
        diceCount: z.union([z.literal(1), z.literal(2)]).default(1),
        code: z
          .string()
          .regex(/^[A-Z2-9]{6}$/)
          .optional(),
      })
      .parse(data);
    const session = store.atomic(() => {
      let code = input.code ?? "";
      const id = randomUUID(),
        token = randomBytes(24).toString("hex");
      if (input.mode === "create") {
        do {
          code = Array.from(
            { length: 6 },
            () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)],
          ).join("");
        } while (store.get(code));
      }
      const player = { id, name: input.name, balance: 0, color: 0 };
      let room: StoredRoom;
      if (input.mode === "create") room = makeRoom(code, player, input.diceCount);
      else {
        const found = store.get(code);
        check(found, "没有找到这个房间，请检查房间号");
        room = found;
        check(room.status === "lobby", "游戏已开局，新玩家请等待下一局");
        check(room.players.length < MAX_PLAYERS, `房间最多 ${MAX_PLAYERS} 位玩家`);
        check(
          !room.players.some((p) => p.name === input.name),
          "这个昵称已被使用",
        );
        player.color = room.players.length;
        room.players.push(player);
      }
      room.undo = undefined;
      store.save(
        room,
        log(
          room,
          id,
          "join",
          `${input.name}${input.mode === "create" ? "创建了房间" : "加入了旅程"}`,
        ),
      );
      store.db
        .prepare("INSERT INTO sessions VALUES (?, ?, ?)")
        .run(hash(token), code, id);
      return { code, playerId: id, token };
    });
    attach(session);
    broadcast(session.code);
    return { ok: true, session, room: view(store.get(session.code)!) };
  });
  handle("resume", (data) => {
    const session = sessionSchema.parse(data);
    const room = authenticate(session);
    room.updatedAt = Date.now();
    store.save(room);
    attach(session);
    broadcast(session.code);
    return { ok: true, room: view(room) };
  });
  handle("action", (data) => {
    const input = z
      .object({
        id: z.string().uuid(),
        revision: z.number().int().nonnegative(),
        action: actionSchema,
      })
      .parse(data);
    const session = socket.data.session as Session | undefined;
    check(session, "请先加入房间");
    store.atomic(() => {
      const room = authenticate(session);
      const key = `${session.playerId}:${input.id}`;
      if (store.db.prepare("SELECT id FROM requests WHERE id=?").get(key))
        return;
      check(
        room.revision === input.revision,
        "其他玩家刚刚更新了房间，请确认最新状态后重试",
      );
      const event = applyAction(room, session.playerId, input.action);
      store.save(room, event);
      store.db
        .prepare("INSERT INTO requests VALUES (?, ?)")
        .run(key, room.code);
      if (input.action.type === "kick")
        store.db
          .prepare("DELETE FROM sessions WHERE code=? AND player=?")
          .run(room.code, input.action.playerId!);
    });
    if (input.action.type === "kick")
      for (const s of io.sockets.sockets.values()) {
        if (
          s.data.session?.code === session.code &&
          s.data.session?.playerId === input.action.playerId
        ) {
          s.emit("kicked");
          s.leave(session.code);
          delete s.data.session;
        }
      }
    broadcast(session.code);
    return { ok: true, room: view(store.get(session.code)!) };
  });
  socket.on("disconnect", () => {
    const session = socket.data.session as Session | undefined;
    if (session) {
      const room = store.get(session.code);
      if (room) {
        room.updatedAt = Date.now();
        store.save(room);
        broadcast(room.code);
      }
    }
  });
});
setInterval(() => {
  const cutoff =
    Date.now() - Number(process.env.ROOM_TTL_HOURS || 24) * 3600_000;
  for (const row of store.db
    .prepare("SELECT code FROM rooms WHERE updated < ?")
    .all(cutoff) as { code: string }[]) {
    if (
      ![...io.sockets.sockets.values()].some(
        (s) => s.data.session?.code === row.code,
      )
    )
      store.db.prepare("DELETE FROM rooms WHERE code=?").run(row.code);
  }
  for (const [key, limit] of limits)
    if (Date.now() - limit.at > 60_000) limits.delete(key);
}, 60_000).unref();
app.get("/api/health", (_req, res) => res.json({ ok: true }));
if (process.argv[1]?.endsWith(".ts")) {
  const { createServer: createVite } = await import("vite");
  app.use(
    (await createVite({ server: { middlewareMode: true }, appType: "spa" }))
      .middlewares,
  );
} else {
  app.use(express.static(resolve("dist/client")));
  app.get("*", (_req, res) => res.sendFile(resolve("dist/client/index.html")));
}
const port = Number(process.env.PORT || 3000);
http.listen(port, "0.0.0.0", () =>
  console.log(`中国之旅银行运行中：http://localhost:${port}`),
);
