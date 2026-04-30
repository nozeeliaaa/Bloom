import { describe, expect, it } from "vitest";
import { createCtx } from "../bloomie-session.js";

describe("createCtx", () => {
  it("keeps one-shot timers separate from background intervals", () => {
    const ctx = createCtx();
    expect(ctx.timers).toBeInstanceOf(Set);
    expect(ctx.backgroundIntervals).toBeInstanceOf(Set);
    expect(ctx.timers).not.toBe(ctx.backgroundIntervals);
  });
});

