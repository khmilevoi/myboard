import { context, wrap } from "@reatom/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeTimer } from "../../../src/shared/timer/model/fakes";
import type { StorageApi } from "../../../src/storage/model/types";
import type { WidgetStorage } from "../../../src/storage/model/widget-storage";
import {
  DEBT_WARNING_THRESHOLD,
  effectiveDuty,
  getDayStatus,
  historyKey,
  isDebtDay,
  isOverDebtWarning,
  ofeliaDutyModel,
  otherPerson,
  weekStartISO,
} from "./ofelia-duty";
import type { HistoryEvent } from "./ofelia-duty";

function createStorage(overrides: Partial<StorageApi> = {}): WidgetStorage {
  const api: StorageApi = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  };

  return {
    instance: { client: api, server: api },
    shared: { client: api, server: api },
  };
}

const D = (iso: string) => Temporal.PlainDate.from(iso);

const ev = (overrides: Partial<HistoryEvent> = {}): HistoryEvent => ({
  id: "event-1",
  ts: 1,
  ip: "127.0.0.1",
  date: "2026-06-16",
  type: "cleaned",
  actor: "Леша",
  by: "Леша",
  ...overrides,
});

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

    await model.goIntoDebt();
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

describe("ofeliaDutyModel.currentUser", () => {
  it("defaults to the first roster member", () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer(),
    });

    expect(model.currentUser()).toBe("Леша");
  });

  it("loads a persisted value from shared.client on connect", async () => {
    const storage = createStorage({
      get: (async () => "Карина") as StorageApi["get"],
    });
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer(),
    });

    await context.start(async () => {
      const off = model.currentUser.subscribe(() => {});
      const check = wrap(() => expect(model.currentUser()).toBe("Карина"));

      await vi.waitFor(() => check());
      off();
    });
  });

  it("persists the selection to shared.client on change", async () => {
    const storage = createStorage();
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer(),
    });

    await context.start(async () => {
      const off = model.currentUser.subscribe(() => {});
      model.currentUser.set("Карина");

      const check = wrap(() =>
        expect(storage.shared.client.set).toHaveBeenCalledWith(
          "currentUser",
          "Карина",
        ),
      );

      await vi.waitFor(() => check());
      off();
    });
  });
});

describe("ofeliaDutyModel.confirmClean", () => {
  it("on a plain day appends cleaned with no debt change", async () => {
    const storage = createStorage();
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D("2026-06-16") }),
    });

    model.numberOfDebts.set({ Леша: 0, Карина: 0 });
    await context.start(async () => {
      await model.confirmClean(D("2026-06-17"));
    });

    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 });
    expect(storage.shared.server.append).toHaveBeenCalledWith(
      "history:2026-06-15",
      {
        date: "2026-06-17",
        type: "cleaned",
        actor: "Карина",
        by: "Леша",
      },
    );
  });

  it("on a debt-payment day decrements the debtor and records the creditor", async () => {
    const storage = createStorage();
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D("2026-06-16") }),
    });

    model.numberOfDebts.set({ Леша: 0, Карина: 1 });
    model.currentUser.set("Карина");
    await model.confirmClean(D("2026-06-16"));

    await vi.waitFor(() =>
      expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 }),
    );
    expect(storage.shared.server.append).toHaveBeenCalledWith(
      "history:2026-06-15",
      {
        date: "2026-06-16",
        type: "cleaned",
        actor: "Карина",
        onBehalfOf: "Леша",
        by: "Карина",
      },
    );
  });

  it("defaults the date to today when no selected date is set", async () => {
    const storage = createStorage();
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D("2026-06-16") }),
    });

    model.numberOfDebts.set({ Леша: 0, Карина: 0 });
    await context.start(async () => {
      await model.confirmClean();
    });

    expect(storage.shared.server.append).toHaveBeenCalledWith(
      "history:2026-06-15",
      expect.objectContaining({ date: "2026-06-16" }),
    );
  });
});

describe("ofeliaDutyModel.goIntoDebt", () => {
  it("adds a debt to the day duty and records who covered", async () => {
    const storage = createStorage();
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D("2026-06-16") }),
    });

    model.currentUser.set("Карина");
    model.numberOfDebts.set({ Леша: 0, Карина: 0 });

    await context.start(async () => {
      await model.goIntoDebt(D("2026-06-16"));
    });

    expect(model.numberOfDebts()).toEqual({ Леша: 1, Карина: 0 });
    expect(storage.shared.server.append).toHaveBeenCalledWith(
      "history:2026-06-15",
      {
        date: "2026-06-16",
        type: "went_into_debt",
        actor: "Карина",
        onBehalfOf: "Леша",
        by: "Карина",
      },
    );
  });
});

describe("ofelia-duty selectors", () => {
  it("otherPerson returns the partner", () => {
    expect(otherPerson("Леша")).toBe("Карина");
    expect(otherPerson("Карина")).toBe("Леша");
  });

  it("weekStartISO/historyKey use the Monday of the date week", () => {
    expect(weekStartISO(D("2026-06-16"))).toBe("2026-06-15");
    expect(historyKey(D("2026-06-17"))).toBe("history:2026-06-15");
  });

  it("effectiveDuty / isDebtDay reflect projected debt days", () => {
    const debts = { Леша: 0, Карина: 1 };
    const today = D("2026-06-16");
    expect(isDebtDay(D("2026-06-16"), debts, today)).toBe(true);
    expect(effectiveDuty(D("2026-06-16"), debts, today)).toBe("Карина");
    expect(isDebtDay(D("2026-06-17"), {}, today)).toBe(false);
    expect(effectiveDuty(D("2026-06-17"), {}, today)).toBe("Карина");
  });

  it("isOverDebtWarning fires strictly above the threshold", () => {
    expect(DEBT_WARNING_THRESHOLD).toBe(7);
    expect(isOverDebtWarning({ Леша: 7 }, "Леша")).toBe(false);
    expect(isOverDebtWarning({ Леша: 8 }, "Леша")).toBe(true);
  });

  it("getDayStatus closes on cleaned/went_into_debt and reopens on cancelled", () => {
    const date = D("2026-06-16");
    expect(getDayStatus([], date)).toBe("pending");
    expect(getDayStatus([ev({ type: "forgiven" })], date)).toBe("pending");
    expect(getDayStatus([ev({ type: "cleaned" })], date)).toBe("closed");
    expect(getDayStatus([ev({ type: "went_into_debt" })], date)).toBe("closed");
    expect(
      getDayStatus(
        [ev({ ts: 1, type: "cleaned" }), ev({ ts: 2, type: "cancelled" })],
        date,
      ),
    ).toBe("pending");
    expect(
      getDayStatus(
        [
          ev({ ts: 1, type: "cleaned" }),
          ev({ ts: 2, type: "cancelled" }),
          ev({ ts: 3, type: "cleaned" }),
        ],
        date,
      ),
    ).toBe("closed");
    expect(getDayStatus([ev({ date: "2026-06-17", type: "cleaned" })], date)).toBe(
      "pending",
    );
  });
});
