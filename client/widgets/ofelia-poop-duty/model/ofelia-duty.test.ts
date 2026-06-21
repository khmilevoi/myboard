import { context } from "@reatom/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeTimer } from "../../../src/shared/timer/model/fakes";
import type { StorageApi } from "../../../src/storage/model/types";
import type { WidgetStorage } from "../../../src/storage/model/widget-storage";
import { ofeliaDutyModel } from "./ofelia-duty";

function createStorage(): WidgetStorage {
  const api: StorageApi = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => {}),
  };

  return {
    instance: { client: api, server: api },
    shared: { client: api, server: api },
  };
}

afterEach(() => {
  context.reset();
});

describe("ofeliaDutyModel server time", () => {
  it("returns null projections and blocks actions before the first sync", async () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer(),
    });
    model.numberOfDebts.set({ Леша: 0, Карина: 0 });

    expect(model.viewWeekStart()).toBeNull();
    expect(model.currentWeek()).toBeNull();
    expect(model.debtDays()).toBeNull();

    await model.inDebt("Леша");
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 });
  });

  it("derives the week from server today once synced", () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: Temporal.PlainDate.from("2026-06-16") }),
    });
    model.numberOfDebts.set({ Леша: 0, Карина: 0 });

    const week = model.currentWeek();
    expect(week).not.toBeNull();
    expect(week?.find((day) => day.isToday)?.date.toString()).toBe(
      "2026-06-16",
    );
    expect(model.viewWeekStart()?.toString()).toBe("2026-06-15");
  });

  it("changes the debt count when synced", async () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: Temporal.PlainDate.from("2026-06-16") }),
    });
    model.numberOfDebts.set({ Леша: 0, Карина: 0 });

    await model.inDebt("Карина");
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 1 });
  });

  it("navigates weeks via the override and resets to the current week", () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: Temporal.PlainDate.from("2026-06-16") }),
    });

    model.goToNextWeek();
    expect(model.viewWeekStart()?.toString()).toBe("2026-06-22");

    model.goToPrevWeek();
    expect(model.viewWeekStart()?.toString()).toBe("2026-06-15");

    model.goToNextWeek();
    model.goToCurrentWeek();
    expect(model.viewWeekStart()?.toString()).toBe("2026-06-15");
  });

  it("selects a day and resolves the default to today", () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: Temporal.PlainDate.from("2026-06-16") }),
    });

    expect(model.selectedDate()).toBeNull();

    model.selectedDate.set(Temporal.PlainDate.from("2026-06-15"));
    expect(model.selectedDate()?.toString()).toBe("2026-06-15");
  });

  it("allows undo only when the selected day equals server today", () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: Temporal.PlainDate.from("2026-06-16") }),
    });

    // default selection (null) resolves to today -> available
    expect(model.undoAvailable()).toBe(true);

    model.selectedDate.set(Temporal.PlainDate.from("2026-06-15"));
    expect(model.undoAvailable()).toBe(false);

    model.selectedDate.set(Temporal.PlainDate.from("2026-06-16"));
    expect(model.undoAvailable()).toBe(true);
  });

  it("blocks undo before the first sync", () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer(),
    });

    expect(model.undoAvailable()).toBe(false);
  });
});
