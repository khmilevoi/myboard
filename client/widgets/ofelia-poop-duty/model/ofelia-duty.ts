import { withStorageKey } from "@/storage/model/reatom/reatom-storage";
import { WidgetStorage } from "@/storage/model/widget-storage";
import { ServerTime } from "@/shared/timer/model/server-time";
import {
  action,
  atom,
  computed,
  withAsyncData,
  withChangeHook,
  withConnectHook,
  wrap,
} from "@reatom/core";
import z from "zod";

export const DUTY_TIME_ZONE = "Europe/Warsaw" as const;
export const BASE_DUTY_DATE = Temporal.PlainDate.from({
  year: 2026,
  month: 6,
  day: 16,
});
export const DUTY_ROTATION = ["Леша", "Карина"] as const;

export type DutyPerson = (typeof DUTY_ROTATION)[number];
export type Person = DutyPerson;

export type HistoryEventType =
  | "cleaned"
  | "went_into_debt"
  | "forgiven"
  | "cancelled";

export type HistoryEvent = {
  id: string;
  ts: number;
  ip: string;
  date: string;
  type: HistoryEventType;
  actor: Person;
  onBehalfOf?: Person;
  by: Person;
};

export type HistoryEventDraft = Omit<HistoryEvent, "id" | "ts" | "ip">;

export const DEBT_WARNING_THRESHOLD = 7;

export interface OfeliaDutyModelProps {
  storage: WidgetStorage;
  timer: ServerTime;
}

// z.object with explicit keys (vs z.record) enables .partial(), which tolerates
// legacy/partial storage records where some rotation keys may be absent.
const NumberOfDebtsSchema = z
  .object({
    // Keep in sync with DUTY_ROTATION tuple.
    Леша: z.int().nonnegative(),
    Карина: z.int().nonnegative(),
  })
  .partial();
const PersonSchema = z.enum(DUTY_ROTATION);
type NumberOfDebts = z.infer<typeof NumberOfDebtsSchema>;

function getStartOfWeek(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({
    days: date.dayOfWeek - 1,
  });
}

export const ofeliaDutyModel = ({ storage, timer }: OfeliaDutyModelProps) => {
  const numberOfDebts = atom<NumberOfDebts | null>(
    null,
    "ofeliaDuty.numberOfDebts",
  ).extend(
    withStorageKey({
      api: storage.shared.server,
      key: "debts",
      schema: NumberOfDebtsSchema,
    }),
  );

  const currentUser = atom<Person>(
    DUTY_ROTATION[0],
    "ofeliaDuty.currentUser",
  ).extend(
    withConnectHook(() => {
      void wrap(storage.shared.client.get("currentUser", PersonSchema)).then(
        (storedUser) => {
          if (storedUser instanceof Error || storedUser === null) return;
          currentUser.set(storedUser);
        },
      );
    }),
    withChangeHook((state) => {
      void wrap(storage.shared.client.set("currentUser", state));
    }),
  );

  const today = computed(() => timer.today(DUTY_TIME_ZONE), "today");

  const startOfWeekOverride = atom<Temporal.PlainDate | null>(
    null,
    "ofeliaDuty.startOfWeekOverride",
  );

  const viewWeekStart = computed<Temporal.PlainDate | null>(() => {
    const override = startOfWeekOverride();
    if (override) return override;
    const currentToday = today();
    return currentToday ? getStartOfWeek(currentToday) : null;
  }, "ofeliaDuty.viewWeekStart");

  const goToNextWeek = action(() => {
    const base = viewWeekStart();
    if (!base) return;
    startOfWeekOverride.set(base.add({ days: 7 }));
  }, "ofeliaDuty.goToNextWeek");

  const goToPrevWeek = action(() => {
    const base = viewWeekStart();
    if (!base) return;
    startOfWeekOverride.set(base.subtract({ days: 7 }));
  }, "ofeliaDuty.goToPrevWeek");

  const goToCurrentWeek = action(() => {
    startOfWeekOverride.set(null);
  }, "ofeliaDuty.goToCurrentWeek");

  const selectedDate = atom<Temporal.PlainDate | null>(
    null,
    "ofeliaDuty.selectedDate",
  );

  // Placeholder until F4 wires the week log behind this port (spec §5).
  const hasReversibleEvent = (_date: Temporal.PlainDate): boolean => true;

  const undoAvailable = computed(() => {
    const currentToday = today();
    const day = selectedDate() ?? currentToday;
    return (
      currentToday != null &&
      day != null &&
      day.equals(currentToday) &&
      hasReversibleEvent(day)
    );
  }, "ofeliaDuty.undoAvailable");

  const debtDays = computed(() => {
    const debts = numberOfDebts();
    const currentToday = today();

    if (!debts || !currentToday) {
      return null;
    }

    return getDebtDays(debts, currentToday).reduce((acc, debtDay) => {
      acc.set(debtDay.date.toString(), debtDay);
      return acc;
    }, new Map<string, DebtDay>());
  }, "ofeliaDuty.debtDays");

  const currentWeek = computed(() => {
    const currentToday = today();
    const weekStart = viewWeekStart();

    if (!currentToday || !weekStart) {
      return null;
    }

    const days = debtDays();

    return Array.from({ length: 7 }, (_, dayOffset) => {
      const date = weekStart.add({ days: dayOffset });
      const duty = getOfeliaDutyByDate(date);

      const debt = days?.get(date.toString()) ?? null;

      return {
        date,
        isToday: date.equals(currentToday),
        day: date.day,
        duty,
        debt: debt?.person ?? null,
      };
    });
  }, "ofeliaDuty.currentWeek");

  const confirmClean = action(async (date?: Temporal.PlainDate) => {
    const currentToday = today()
    if (currentToday == null) return

    const target = date ?? selectedDate() ?? currentToday
    // Use the local atom as the single source of truth (same as goIntoDebt/forgive).
    const debts: Partial<NumberOfDebts> = { ...(numberOfDebts() ?? {}) }
    const debtDay = getDebtDays(debts, currentToday).find((day) =>
      day.date.equals(target),
    )
    const actor = debtDay?.person ?? getOfeliaDutyByDate(target)

    if (debtDay) {
      debts[actor] = Math.max((debts[actor] ?? 0) - 1, 0)
      numberOfDebts.set(normalizeDebts(debts))
    }

    const draft: HistoryEventDraft = {
      date: target.toString(),
      type: 'cleaned',
      actor,
      by: currentUser(),
      ...(debtDay ? { onBehalfOf: getOfeliaDutyByDate(target) } : {}),
    }

    const result = await wrap(
      storage.shared.server.append(historyKey(target), draft),
    )
    if (result instanceof Error) throw result
  }, 'ofeliaDuty.confirmClean').extend(withAsyncData({ status: true }))

  const goIntoDebt = action(async (date?: Temporal.PlainDate) => {
    const currentToday = today();
    if (currentToday == null) return;

    const target = date ?? selectedDate() ?? currentToday;
    const duty = getOfeliaDutyByDate(target);
    const debts: Partial<NumberOfDebts> = { ...(numberOfDebts() ?? {}) };
    debts[duty] = (debts[duty] ?? 0) + 1;
    numberOfDebts.set(normalizeDebts(debts));

    const draft: HistoryEventDraft = {
      date: target.toString(),
      type: "went_into_debt",
      actor: otherPerson(duty),
      onBehalfOf: duty,
      by: currentUser(),
    };

    const result = await wrap(
      storage.shared.server.append(historyKey(target), draft),
    );
    if (result instanceof Error) throw result;
  }, "ofeliaDuty.goIntoDebt").extend(withAsyncData({ status: true }));

  const forgive = action(async (date?: Temporal.PlainDate) => {
    const currentToday = today();
    if (currentToday == null) return;

    const target = date ?? selectedDate() ?? currentToday;
    const debts = { ...(numberOfDebts() ?? {}) };
    const debtor = DUTY_ROTATION.find((person) => (debts[person] ?? 0) > 0);
    if (!debtor) return;

    debts[debtor] = Math.max((debts[debtor] ?? 0) - 1, 0);
    numberOfDebts.set(normalizeDebts(debts));

    const result = await wrap(
      storage.shared.server.append(historyKey(target), {
        date: target.toString(),
        type: "forgiven",
        actor: otherPerson(debtor),
        onBehalfOf: debtor,
        by: currentUser(),
      }),
    );
    if (result instanceof Error) throw result;
  }, "ofeliaDuty.forgive").extend(withAsyncData({ status: true }));

  const undo = action(async (events: HistoryEvent[]) => {
    const currentToday = today()
    if (currentToday == null) return
    if (getDayStatus(events, currentToday) !== 'closed') return

    // `cancelled` re-opens the day status (getDayStatus returns "pending" again)
    // but intentionally does NOT decrement numberOfDebts — the debt was already
    // incurred and the undo only cancels the "closed" marking for today.
    // This keeps the audit log append-only and avoids mutating historical debt counts.
    const result = await wrap(
      storage.shared.server.append(historyKey(currentToday), {
        date: currentToday.toString(),
        type: 'cancelled',
        // effectiveDuty resolves to whoever was responsible on this day
        // (debt assignee if a debt day, otherwise scheduled duty person).
        actor: effectiveDuty(currentToday, numberOfDebts() ?? {}, currentToday),
        by: currentUser(),
      }),
    )
    if (result instanceof Error) throw result
  }, 'ofeliaDuty.undo').extend(withAsyncData({ status: true }))

  return {
    startOfWeekOverride,
    viewWeekStart,
    goToNextWeek,
    goToPrevWeek,
    goToCurrentWeek,
    selectedDate,
    currentUser,
    numberOfDebts,
    debtDays,
    currentWeek,
    undoAvailable,
    confirmClean,
    goIntoDebt,
    forgive,
    undo,
  };
};

type DebtDay = {
  date: Temporal.PlainDate;
  person: DutyPerson;
};

function getDebtDays(
  debts: Partial<NumberOfDebts>,
  startDate: Temporal.PlainDate,
): DebtDay[] {
  if (DUTY_ROTATION.length < 2) {
    return [];
  }

  const days: DebtDay[] = [];
  let currentDate = startDate;

  for (const person of DUTY_ROTATION) {
    let remainingDebt = debts[person] ?? 0;

    while (remainingDebt > 0) {
      const plannedDuty = getOfeliaDutyByDate(currentDate);

      if (plannedDuty !== person) {
        days.push({
          date: currentDate,
          person,
        });

        remainingDebt -= 1;
      }

      currentDate = currentDate.add({ days: 1 });
    }
  }

  return days;
}

export function normalizeDebts(debts: Partial<NumberOfDebts>): NumberOfDebts {
  const values = DUTY_ROTATION.map((person) => debts[person] ?? 0);

  const minDebt = Math.min(...values);

  return DUTY_ROTATION.reduce<NumberOfDebts>(
    (normalized, person) => ({
      ...normalized,
      [person]: (debts[person] ?? 0) - minDebt,
    }),
    {} as NumberOfDebts,
  );
}

export function getOfeliaDutyByDate(date: Temporal.PlainDate): DutyPerson {
  const diffDays = BASE_DUTY_DATE.until(date, { largestUnit: "day" }).days;
  const rotationIndex = positiveModulo(diffDays, DUTY_ROTATION.length);

  return DUTY_ROTATION[rotationIndex];
}

export function weekStartISO(date: Temporal.PlainDate): string {
  return getStartOfWeek(date).toString();
}

export function historyKey(date: Temporal.PlainDate): string {
  return `history:${weekStartISO(date)}`;
}

export function otherPerson(person: Person): Person {
  return DUTY_ROTATION.find((candidate) => candidate !== person) ?? person;
}

export function effectiveDuty(
  date: Temporal.PlainDate,
  debts: Partial<NumberOfDebts>,
  today: Temporal.PlainDate,
): Person {
  const debtDay = getDebtDays(debts, today).find((day) => day.date.equals(date));
  return debtDay?.person ?? getOfeliaDutyByDate(date);
}

export function isDebtDay(
  date: Temporal.PlainDate,
  debts: Partial<NumberOfDebts>,
  today: Temporal.PlainDate,
): boolean {
  return getDebtDays(debts, today).some((day) => day.date.equals(date));
}

export function isOverDebtWarning(
  debts: Partial<NumberOfDebts>,
  person: Person,
): boolean {
  return (debts[person] ?? 0) > DEBT_WARNING_THRESHOLD;
}

export function getDayStatus(
  events: HistoryEvent[],
  date: Temporal.PlainDate,
): "closed" | "pending" {
  const iso = date.toString();
  let closed = false;

  for (const event of events
    .filter((candidate) => candidate.date === iso)
    .sort((a, b) => a.ts - b.ts)) {
    if (event.type === "cleaned" || event.type === "went_into_debt") {
      closed = true;
    } else if (event.type === "cancelled") {
      closed = false;
    }
  }

  return closed ? "closed" : "pending";
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
