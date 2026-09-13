import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { GameEvent } from "../shared/types";
import type { StoredRoom } from "./engine";
export class Store {
  db: Database.Database;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE, player TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE);`);
  }
  get(code: string): StoredRoom | undefined {
    const row = this.db
      .prepare("SELECT state FROM rooms WHERE code = ?")
      .get(code) as { state: string } | undefined;
    if (!row) return undefined;
    const room: StoredRoom = JSON.parse(row.state);
    // Existing rooms were created with two dice before this setting existed.
    room.diceCount ??= 2;
    room.mode ??= { type: "survival", durationMinutes: 60, targetCash: 30000 };
    room.startedPlayerCount ??= room.players.length;
    if (room.undo) room.undo.status ??= "playing";
    return room;
  }
  save(room: StoredRoom, event?: GameEvent) {
    this.db
      .prepare(
        "INSERT INTO rooms VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET state=excluded.state, updated=excluded.updated",
      )
      .run(room.code, JSON.stringify(room), room.updatedAt);
    if (event)
      this.db
        .prepare("INSERT INTO events VALUES (?, ?, ?)")
        .run(event.id, room.code, JSON.stringify(event));
  }
  atomic<T>(run: () => T): T {
    return this.db.transaction(run).immediate();
  }
}
