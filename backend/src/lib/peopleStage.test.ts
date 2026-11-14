import { describe, expect, it } from "vitest";
import { stageOf, usefulness } from "./peopleStage";

const now = new Date("2026-11-14T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("stageOf", () => {
  it("hooked beats everything: 4+ days in the last 2 weeks", () => {
    expect(stageOf({ createdAt: daysAgo(3), lastSeenAt: daysAgo(0), activeAgo: [0, 1, 2, 3] }, now)).toBe("hooked");
  });
  it("new in the first week", () => {
    expect(stageOf({ createdAt: daysAgo(2), lastSeenAt: daysAgo(2), activeAgo: [2] }, now)).toBe("new");
  });
  it("never came back after signing up", () => {
    expect(stageOf({ createdAt: daysAgo(20), lastSeenAt: new Date(daysAgo(20).getTime() + 60_000), activeAgo: [] }, now)).toBe("never");
  });
  it("regular, drifting, quiet by last seen", () => {
    expect(stageOf({ createdAt: daysAgo(40), lastSeenAt: daysAgo(3), activeAgo: [3, 12] }, now)).toBe("regular");
    expect(stageOf({ createdAt: daysAgo(40), lastSeenAt: daysAgo(10), activeAgo: [10] }, now)).toBe("drifting");
    expect(stageOf({ createdAt: daysAgo(60), lastSeenAt: daysAgo(30), activeAgo: [] }, now)).toBe("quiet");
  });
});

describe("usefulness", () => {
  it("rewards coming back most, capped at 100", () => {
    const light = usefulness({ activeAgo: [0], bills: 1, imports: 0, payments: 0, groups: 1, chats: 0, personal: 0 });
    const heavy = usefulness({ activeAgo: [...Array(20).keys()], bills: 40, imports: 15, payments: 8, groups: 4, chats: 20, personal: 20 });
    expect(light).toBe(6);
    expect(heavy).toBe(100);
  });
});
