import raw from "../properties.json";
import type { PropertyDefinition, Room } from "./types";
export const definitions = raw as PropertyDefinition[];
export const propertyById = Object.fromEntries(
  definitions.map((p) => [p.id, p]),
);
export const money = (n: number) => `¥${n.toLocaleString("zh-CN")}`;
export const groupColors = [
  "#c99877",
  "#d29a45",
  "#73997e",
  "#c76e61",
  "#8397c2",
  "#ba86a6",
  "#79a9b8",
  "#9d91b5",
];
export const groupName = (p: PropertyDefinition) =>
  p.type === "station"
    ? "铁路交通"
    : p.type === "utility"
      ? "公共事业"
      : `第 ${p.colorGroup} 色组`;
export function rentFor(room: Room, id: string, diceTotal?: number): number {
  const def = propertyById[id],
    state = room.properties[id];
  if (!def || !state?.ownerId || state.mortgaged) return 0;
  const owned = definitions.filter(
    (d) =>
      d.type === def.type && room.properties[d.id].ownerId === state.ownerId,
  );
  if (def.type === "station")
    return def.rentByOwnedStationCount![String(owned.length)];
  if (def.type === "utility")
    return (
      (diceTotal ?? room.dice[0]?.total ?? 0) *
      (owned.length === 2
        ? def.rent!.bothUtilitiesDiceMultiplier!
        : def.rent!.singleUtilityDiceMultiplier!)
    );
  if (state.hotel) return def.rent!.hotel!;
  if (state.houses) return def.rent![`house${state.houses}` as "house1"]!;
  const complete = definitions
    .filter((d) => d.colorGroup === def.colorGroup)
    .every((d) => room.properties[d.id].ownerId === state.ownerId);
  return def.rent!.land! * (complete ? 2 : 1);
}
