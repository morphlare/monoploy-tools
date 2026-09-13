import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applyAction, makeRoom } from "../server/engine";
import { Store } from "../server/store";
import { definitions, rentFor } from "../shared/rules";
import type { Action } from "../shared/types";
function setup(diceCount: 1 | 2 = 2) {
  const host = { id: randomUUID(), name: "李四", balance: 0, color: 0 },
    guest = { id: randomUUID(), name: "张三", balance: 0, color: 1 };
  const room = makeRoom("ABC234", host, diceCount);
  room.players.push(guest);
  const act = (a: Action, who = host.id) => applyAction(room, who, a);
  act({ type: "settings", amount: 20000 });
  act({ type: "start" });
  return { room, host, guest, act };
}
test("single die default, manual roll validation, utility rent and restart retention", () => {
  const { room, host, act } = setup(1);
  assert.equal(makeRoom("DEF234", host).diceCount, 1);
  act({ type: "roll" });
  assert.equal(room.dice[0].values.length, 1);
  assert.ok(room.dice[0].total >= 1 && room.dice[0].total <= 6);
  act({ type: "roll", values: [5] });
  assert.equal(room.dice[0].total, 5);
  assert.throws(() => act({ type: "roll", values: [2, 3] }), /对应数量/);
  act({ type: "buy", propertyId: "71-70" });
  assert.equal(rentFor(room, "71-70"), 50);
  act({ type: "buy", propertyId: "71-71" });
  assert.equal(rentFor(room, "71-70"), 500);
  act({ type: "restart" });
  assert.equal(room.diceCount, 1);
  const two = setup(2);
  two.act({ type: "roll" });
  assert.equal(two.room.dice[0].values.length, 2);
  assert.throws(() => two.act({ type: "roll", values: [6] }), /对应数量/);
});
test("dice settings persist and legacy rooms keep two dice", () => {
  const { room } = setup(1);
  const store = new Store(":memory:");
  store.save(room);
  assert.equal(store.get(room.code)!.diceCount, 1);
  const legacy: Partial<typeof room> = structuredClone(room);
  delete legacy.diceCount;
  store.db.prepare("UPDATE rooms SET state=? WHERE code=?").run(JSON.stringify(legacy), room.code);
  assert.equal(store.get(room.code)!.diceCount, 2);
  store.db.close();
});
test("provided JSON contains all 41 unique cards in order", () => {
  assert.equal(definitions.length, 41);
  assert.equal(new Set(definitions.map((d) => d.id)).size, 41);
  assert.deepEqual(
    definitions.map((d) => d.id),
    Array.from({ length: 41 }, (_, i) => `71-${i + 31}`),
  );
});
test("Henan: purchase → build → rent → mortgage → undo → persist and reload", () => {
  const { room, host, guest, act } = setup();
  act({ type: "buy", propertyId: "71-49" });
  assert.equal(host.balance, 17000);
  act({ type: "build", propertyId: "71-49" });
  assert.equal(host.balance, 15000);
  assert.equal(rentFor(room, "71-49"), 1300);
  act({ type: "rent", propertyId: "71-49", playerId: guest.id }, guest.id);
  assert.equal(guest.balance, 18700);
  assert.equal(host.balance, 16300);
  act({ type: "mortgage", propertyId: "71-49" });
  assert.equal(host.balance, 17800);
  assert.equal(room.properties["71-49"].houses, 1);
  assert.equal(rentFor(room, "71-49"), 0);
  const store = new Store(":memory:");
  store.atomic(() => store.save(room));
  assert.deepEqual(store.get(room.code), JSON.parse(JSON.stringify(room)));
  act({ type: "undo" });
  assert.equal(room.players[0].balance, 16300);
  assert.equal(room.properties["71-49"].mortgaged, false);
  assert.ok(room.events[1].undone);
  store.db.close();
});
test("same-color monopoly, stations and utility dice use definition rules", () => {
  const { room, host, act } = setup();
  act({ type: "balance", playerId: host.id, amount: 1000000 });
  for (const id of ["71-46", "71-47", "71-48", "71-49"])
    act({ type: "buy", propertyId: id });
  assert.equal(rentFor(room, "71-49"), 520);
  for (const [i, id] of ["71-66", "71-67", "71-68", "71-69"].entries()) {
    act({ type: "buy", propertyId: id });
    assert.equal(rentFor(room, id), [250, 500, 1000, 2000][i]);
  }
  act({ type: "roll", values: [3, 4] });
  act({ type: "buy", propertyId: "71-70" });
  assert.equal(rentFor(room, "71-70"), 70);
  act({ type: "buy", propertyId: "71-71" });
  assert.equal(rentFor(room, "71-70"), 700);
});
test("hotel upgrade, demolition and redemption are reversible", () => {
  const { room, host, act } = setup();
  act({ type: "buy", propertyId: "71-49" });
  for (let i = 0; i < 4; i++) act({ type: "build", propertyId: "71-49" });
  assert.throws(() => act({ type: "build", propertyId: "71-49" }));
  act({ type: "hotel", propertyId: "71-49" });
  assert.equal(rentFor(room, "71-49"), 12750);
  act({ type: "demolish", propertyId: "71-49" });
  assert.equal(room.properties["71-49"].houses, 4);
  assert.equal(host.balance, 8000);
  act({ type: "mortgage", propertyId: "71-49" });
  act({ type: "redeem", propertyId: "71-49" });
  assert.equal(host.balance, 8000);
});
test("authorization, insufficient funds and invalid amounts cannot commit state", () => {
  const { room, host, guest, act } = setup();
  const store = new Store(":memory:");
  store.save(room);
  const before = JSON.stringify(store.get(room.code));
  assert.throws(() =>
    store.atomic(() => {
      const current = store.get(room.code)!;
      const e = applyAction(current, host.id, {
        type: "transfer",
        from: host.id,
        to: guest.id,
        amount: 20001,
      });
      store.save(current, e);
    }),
  );
  assert.equal(JSON.stringify(store.get(room.code)), before);
  assert.throws(() =>
    act({ type: "balance", playerId: guest.id, amount: 100 }, guest.id),
  );
  assert.throws(() =>
    act({ type: "transfer", from: host.id, to: guest.id, amount: -5 }),
  );
  act({ type: "buy", propertyId: "71-49" });
  assert.throws(() => act({ type: "build", propertyId: "71-49" }, guest.id));
  assert.throws(() => act({ type: "buy", propertyId: "71-49" }, guest.id));
  store.db.close();
});
test("restart clears game state and prevents undo across membership changes", () => {
  const { room, guest, act } = setup();
  act({ type: "buy", propertyId: "71-49" });
  act({ type: "give", propertyId: "71-49", playerId: guest.id });
  assert.equal(room.properties["71-49"].ownerId, guest.id);
  act({ type: "kick", playerId: guest.id });
  assert.equal(room.properties["71-49"].ownerId, null);
  assert.equal(room.undo, undefined);
  act({ type: "restart" });
  assert.equal(room.players[0].balance, 20000);
  assert.equal(room.dice.length, 0);
  assert.equal(room.undo, undefined);
});
