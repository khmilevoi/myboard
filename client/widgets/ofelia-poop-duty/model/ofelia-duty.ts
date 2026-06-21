import { withStorageKey } from "@/storage/model/reatom/reatom-storage";
import { WidgetStorage } from "@/storage/model/widget-storage";
import { ServerTime } from "@/shared/timer/model/server-time";
import { action, atom, computed, withAsyncData } from "@reatom/core";
import z from "zod";

export const DUTY_TIME_ZONE = "Europe/Warsaw" as const;
export const BASE_DUTY_DATE = Temporal.PlainDate.from({
  year: 2026,
  month: 6,
  day: 16,
});
export const DUTY_ROTATION = ["Леша", "Карина"] as const;

export type DutyPerson = (typeof DUTY_ROTATION)[number];

export interface OfeliaDutyModelProps {
  storage: WidgetStorage;
  timer: ServerTime;
}

const NumberOfDebtsSchema = z.record(
  z.enum(DUTY_ROTATION),
  z.int().nonnegative(),
);
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

  const inDebt = action(async (person: DutyPerson) => {
    if (today() == null) return;

    const debts = { ...numberOfDebts() };

    debts[person] = (debts[person] ?? 0) + 1;

    numberOfDebts.set(normalizeDebts(debts));
  }, "ofeliaDuty.inDebt").extend(withAsyncData({ status: true }));

  const forgiveDebt = action(async (person: DutyPerson) => {
    if (today() == null) return;

    const debts = { ...numberOfDebts() };

    debts[person] = Math.max((debts[person] ?? 0) - 1, 0);

    numberOfDebts.set(normalizeDebts(debts));
  }, "ofeliaDuty.forgiveDebt").extend(withAsyncData({ status: true }));

  return {
    startOfWeekOverride,
    viewWeekStart,
    goToNextWeek,
    goToPrevWeek,
    goToCurrentWeek,
    selectedDate,
    numberOfDebts,
    debtDays,
    currentWeek,
    undoAvailable,
    inDebt,
    forgiveDebt,
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

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
