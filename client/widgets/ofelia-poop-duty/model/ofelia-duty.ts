import { withStorageKey } from "@/storage/model/reatom/reatom-storage";
import { WidgetStorage } from "@/storage/model/widget-storage";
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
}

const NumberOfDebtsSchema = z.record(
  z.enum(DUTY_ROTATION),
  z.int().nonnegative(),
);
type NumberOfDebts = z.infer<typeof NumberOfDebtsSchema>;

function getToday(): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(Date.now())
    .toZonedDateTimeISO(DUTY_TIME_ZONE)
    .toPlainDate();
}

function getStartOfWeek(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({
    days: date.dayOfWeek - 1,
  });
}

export const ofeliaDutyModel = ({ storage }: OfeliaDutyModelProps) => {
  const numberOfDebts = atom<NumberOfDebts | null>(null).extend(
    withStorageKey({
      api: storage.shared.server,
      key: "debts",
      schema: NumberOfDebtsSchema,
    }),
  );

  const startOfWeek = atom<Temporal.PlainDate>(getStartOfWeek(getToday()));

  const goToNextWeek = action(() => {
    startOfWeek.set(startOfWeek().add({ days: 7 }));
  });

  const goToPrevWeek = action(() => {
    startOfWeek.set(startOfWeek().subtract({ days: 7 }));
  });

  const goToCurrentWeek = action(() => {
    startOfWeek.set(getStartOfWeek(getToday()));
  });

  const debtDays = computed(() => {
    const debts = numberOfDebts();

    if (!debts) {
      return null;
    }

    return getDebtDays(debts, getToday()).reduce((acc, debtDay) => {
      acc.set(debtDay.date.toString(), debtDay);
      return acc;
    }, new Map<string, DebtDay>());
  });

  const currentWeek = computed(() => {
    const today = getToday();
    const weekStart = startOfWeek();

    const week = Array.from({ length: 7 }, (_, dayOffset) => {
      const date = weekStart.add({ days: dayOffset });
      const duty = getOfeliaDutyByDate(date);

      const debt = debtDays()?.get(date.toString()) ?? null;

      return {
        date,
        isToday: date.equals(today),
        day: date.day,
        duty,
        debt: debt?.person ?? null,
      };
    });
    return week;
  });

  const inDebt = action(async (person: DutyPerson) => {
    const debts = { ...numberOfDebts() };

    debts[person] = (debts[person] ?? 0) + 1;

    numberOfDebts.set(normalizeDebts(debts));
  }).extend(withAsyncData({ status: true }));

  const forgiveDebt = action(async (person: DutyPerson) => {
    const debts = { ...numberOfDebts() };

    debts[person] = Math.max((debts[person] ?? 0) - 1, 0);

    numberOfDebts.set(normalizeDebts(debts));
  }).extend(withAsyncData({ status: true }));

  return {
    startOfWeek,
    goToNextWeek,
    goToPrevWeek,
    goToCurrentWeek,
    numberOfDebts,
    currentWeek,
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
