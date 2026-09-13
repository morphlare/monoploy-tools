import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { io, type Socket } from "socket.io-client";
import { Store } from "../server/store";
import { assetsFor } from "../shared/rules";
import type { Action, Reply, Room, Session } from "../shared/types";

test(
  "two real socket clients: transactions, contention, deduplication, reconnect, server restart, permissions",
  { timeout: 30000 },
  async () => {
    mkdirSync("artifacts", { recursive: true });
    const port = 3107,
      url = `http://127.0.0.1:${port}`,
      database = resolve(`artifacts/integration-${randomUUID()}.sqlite`);
    let proc: ChildProcess;
    const clients: Socket[] = [];
    const start = async () => {
      proc = spawn(process.execPath, ["dist/server.js"], {
        env: { ...process.env, PORT: String(port), DB_PATH: database },
        stdio: "pipe",
      });
      let output = "";
      proc.stdout?.on("data", (d) => {
        output += d;
      });
      proc.stderr?.on("data", (d) => {
        output += d;
      });
      for (let i = 0; i < 100; i++) {
        try {
          const response = await fetch(`${url}/api/health`);
          if (response.ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`server did not start: ${output}`);
    };
    const stop = async () => {
      if (proc && proc.exitCode === null)
        await new Promise<void>((resolve) => {
          proc.once("exit", () => resolve());
          proc.kill();
        });
    };
    const connect = async () => {
      const s = io(url, { autoConnect: false, reconnection: false });
      clients.push(s);
      await new Promise<void>((resolve, reject) => {
        s.once("connect", resolve);
        s.once("connect_error", reject);
        s.connect();
      });
      return s;
    };
    const request = (s: Socket, event: string, payload: unknown) =>
      new Promise<Reply>((resolve, reject) => {
        s.timeout(3000).emit(event, payload, (e: Error | null, r: Reply) =>
          e ? reject(e) : resolve(r),
        );
      });
    let room: Room, host: Session, guest: Session;
    const act = async (s: Socket, action: Action) => {
      const r = await request(s, "action", {
        id: randomUUID(),
        revision: room.revision,
        action,
      });
      assert.equal(r.ok, true, r.error);
      room = r.room!;
      return r;
    };
    try {
      await start();
      const a = await connect(),
        b = await connect();
      const created = await request(a, "enter", {
        mode: "create",
        name: "李四",
        diceCount: 2,
        gameMode: { type: "survival", durationMinutes: 60, targetCash: 30000 },
      });
      assert.ok(created.ok);
      host = created.session!;
      room = created.room!;
      const joined = await request(b, "enter", {
        mode: "join",
        name: "张三",
        code: room.code,
      });
      assert.ok(joined.ok);
      assert.equal(joined.room!.diceCount, 2);
      guest = joined.session!;
      room = joined.room!;
      let observed: Room | undefined;
      b.on("room", (next) => {
        observed = next;
      });
      await act(a, { type: "settings", amount: 20000 });
      await act(a, { type: "start" });
      await act(a, { type: "buy", propertyId: "71-49" });
      await act(a, { type: "build", propertyId: "71-49" });
      await act(b, {
        type: "rent",
        propertyId: "71-49",
        playerId: guest.playerId,
      });
      await act(a, { type: "mortgage", propertyId: "71-49" });
      assert.equal(room.players[0].balance, 17800);
      assert.equal(room.players[1].balance, 18700);
      await new Promise((r) => setTimeout(r, 60));
      assert.equal(observed?.players[0].balance, 17800);
      assert.equal(observed?.properties["71-49"].mortgaged, true);
      const bad = await request(b, "action", {
        id: randomUUID(),
        revision: room.revision,
        action: { type: "balance", playerId: guest.playerId, amount: 90000 },
      });
      assert.equal(bad.ok, false);
      const revision = room.revision;
      const contention = await Promise.all(
        [a, b].map((s) =>
          request(s, "action", {
            id: randomUUID(),
            revision,
            action: { type: "buy", propertyId: "71-66" },
          }),
        ),
      );
      assert.equal(contention.filter((r) => r.ok).length, 1);
      room = contention.find((r) => r.ok)!.room!;
      const sameRequest = {
        id: randomUUID(),
        revision: room.revision,
        action: {
          type: "transfer",
          from: "bank",
          to: host.playerId,
          amount: 100,
        },
      };
      const once = await request(a, "action", sameRequest);
      assert.ok(once.ok);
      const twice = await request(a, "action", sameRequest);
      assert.ok(twice.ok);
      assert.deepEqual(once.room, twice.room);
      room = twice.room!;
      const before = room.players[0].balance;
      const overdraw = await request(a, "action", {
        id: randomUUID(),
        revision: room.revision,
        action: {
          type: "transfer",
          from: host.playerId,
          to: guest.playerId,
          amount: before + 1,
        },
      });
      assert.equal(overdraw.ok, false);
      await act(a, { type: "roll", values: [3, 5] });
      assert.equal(room.dice[0].total, 8);
      a.disconnect();
      const a2 = await connect();
      const resumed = await request(a2, "resume", host);
      assert.ok(resumed.ok);
      assert.equal(resumed.room!.players[0].balance, before);
      assert.equal(resumed.room!.properties["71-49"].houses, 1);
      const savedCode = room.code,
        expectedRevision = room.revision;
      clients.forEach((s) => s.disconnect());
      await stop();
      await start();
      const a3 = await connect(),
        b3 = await connect();
      const restartResume = await request(a3, "resume", host);
      assert.ok(restartResume.ok);
      room = restartResume.room!;
      assert.equal(room.code, savedCode);
      assert.equal(room.revision, expectedRevision);
      assert.equal(room.properties["71-49"].mortgaged, true);
      assert.equal(room.dice[0].total, 8);
      assert.equal(
        (await request(b3, "resume", { ...host, token: "0".repeat(48) })).ok,
        false,
      );
      assert.equal((await request(b3, "resume", guest)).ok, true);
      // Bankruptcy must settle both clients' assets and remain undoable.
      await act(a3, { type: "restart" });
      await act(a3, { type: "buy", propertyId: "71-49" });
      await act(a3, { type: "build", propertyId: "71-49", count: 4 });
      await act(a3, { type: "hotel", propertyId: "71-49" });
      await act(b3, { type: "buy", propertyId: "71-66" });
      await act(a3, { type: "balance", playerId: guest.playerId, amount: 100 });
      const debtorTotal = assetsFor(room, guest.playerId).total;
      const creditorBefore = room.players[0].balance;
      await act(a3, { type: "rent", propertyId: "71-49", playerId: guest.playerId });
      assert.equal(room.players[0].balance, creditorBefore + debtorTotal);
      assert.equal(room.players[1].balance, 0);
      assert.equal(room.players[1].bankrupt, true);
      assert.equal(room.properties["71-66"].ownerId, null);
      assert.equal(room.status, "finished");
      assert.deepEqual(room.winnerIds, [host.playerId]);
      const bankruptResume = await request(b3, "resume", guest);
      assert.equal(bankruptResume.room!.players[1].bankrupt, true);
      assert.equal(bankruptResume.room!.status, "finished");
      await act(a3, { type: "undo" });
      assert.equal(room.status, "playing");
      assert.equal(room.players[1].bankrupt, false);
      assert.equal(room.properties["71-66"].ownerId, guest.playerId);
      await act(a3, { type: "demolish", propertyId: "71-49", count: 3 });
      assert.equal(room.properties["71-49"].houses, 2);
      assert.equal(room.properties["71-49"].hotel, false);
      await act(a3, { type: "restart" });
      assert.equal(room.players[1].balance, 20000);
      await act(a3, { type: "kick", playerId: guest.playerId });
      assert.equal((await request(b3, "resume", guest)).ok, false);
      assert.equal(room.players.length, 1);
      assert.equal(room.diceCount, 2);

      // A newly created room defaults to one die, including after reconnect.
      const c = await connect();
      for (const diceCount of [0, 3, 1.5]) {
        assert.equal((await request(c, "enter", { mode: "create", name: "无效设置", diceCount })).ok, false);
      }
      const single = await request(c, "enter", { mode: "create", name: "单骰房主" });
      assert.ok(single.ok); room = single.room!;
      assert.equal(room.diceCount, 1);
      assert.deepEqual(room.mode, { type: "timed", durationMinutes: 60, targetCash: 30000 });
      await act(c, { type: "start" });
      await act(c, { type: "roll", values: [6] });
      assert.equal(room.dice[0].total, 6);
      assert.deepEqual(room.dice[0].values, [6]);
      const mismatch = await request(c, "action", { id: randomUUID(), revision: room.revision, action: { type: "roll", values: [2, 4] } });
      assert.equal(mismatch.ok, false);
      assert.equal((await request(c, "resume", single.session)).room!.diceCount, 1);

      // Expiry is driven by the server even when clients send no action.
      const inspect = new Store(database);
      try {
        inspect.atomic(() => {
          const expired = inspect.get(room.code)!;
          expired.deadline = Date.now() - 1;
          inspect.save(expired);
        });
        const timedResult = await new Promise<Room>((resolve, reject) => {
          const timer = setTimeout(() => { c.off("room", onRoom); reject(new Error("deadline not broadcast")); }, 2500);
          const onRoom = (next: Room) => {
            if (next.status === "finished") { clearTimeout(timer); c.off("room", onRoom); resolve(next); }
          };
          c.on("room", onRoom);
        });
        room = timedResult;
        assert.deepEqual(room.winnerIds, [single.session!.playerId]);
        assert.match(room.finishReason!, /时间到/);
        assert.equal(room.events[0].type, "finish");
        assert.equal(inspect.get(room.code)!.status, "finished");
      } finally { inspect.db.close(); }
      await act(c, { type: "restart" });
      assert.equal(room.status, "playing");
      assert.ok(room.deadline! > Date.now());

      // Two simultaneous candidates contend for the eighth seat atomically.
      const capacity = await request(c, "enter", { mode: "create", name: "八人房主" });
      assert.ok(capacity.ok);
      for (let i = 0; i < 6; i++) {
        const guestSocket = await connect();
        assert.ok((await request(guestSocket, "enter", { mode: "join", name: `玩家${i}`, code: capacity.room!.code })).ok);
      }
      const lastSeats = await Promise.all([await connect(), await connect()].map((s, i) => request(s, "enter", { mode: "join", name: `候选${i}`, code: capacity.room!.code })));
      assert.equal(lastSeats.filter(r => r.ok).length, 1);
      assert.equal(lastSeats.find(r => r.ok)!.room!.players.length, 8);
      assert.match(lastSeats.find(r => !r.ok)!.error!, /最多 8/);
      room = lastSeats.find(r => r.ok)!.room!;
      await act(c, { type: "start" });
      assert.equal(room.players.length, 8);
      const member = await connect();
      const memberSession = lastSeats.find(r => r.ok)!.session!;
      assert.equal((await request(member, "resume", memberSession)).ok, true);
      const forbiddenEnd = await request(member, "action", { id: randomUUID(), revision: room.revision, action: { type: "end" } });
      assert.equal(forbiddenEnd.ok, false);
      const ended = Promise.all([c, member].map(s => new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("end not broadcast")), 2000);
        s.once("ended", () => { clearTimeout(timer); resolve(); });
      })));
      assert.ok((await request(c, "action", { id: randomUUID(), revision: room.revision, action: { type: "end" } })).ok);
      await ended;
      assert.equal((await request(member, "resume", memberSession)).ok, false);
      assert.equal((await request(c, "resume", capacity.session)).ok, false);
      assert.equal((await request(member, "enter", { mode: "join", code: room.code, name: "结束后加入" })).ok, false);
      assert.equal((await request(c, "enter", { mode: "create", name: "重新创建" })).ok, true);
    } finally {
      clients.forEach((s) => s.disconnect());
      await stop();
    }
  },
);
