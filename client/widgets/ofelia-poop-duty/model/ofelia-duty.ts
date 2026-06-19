import { reatomStorageKey } from "@/storage/model/reatom/reatom-storage";
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

const NumberOfDeptsSchema = z.record(z.enum(DUTY_ROTATION), z.number());
type NumberOfDepts = z.infer<typeof NumberOfDeptsSchema>;

export const ofeliaDutyModel = ({ storage }: OfeliaDutyModelProps) => {
  const numberOfDebts = reatomStorageKey(
    { api: storage.shared.server, key: "debts", schema: NumberOfDeptsSchema },
    "numberOfDebts",
  );

  const startOfWeek = atom<Temporal.PlainDate>(
    Temporal.Instant.fromEpochMilliseconds(Date.now()).toZonedDateTimeISO(DUTY_TIME_ZONE).toPlainDate(),
  );

  const currentWeek = computed(() => {
    const today = Temporal.Instant.fromEpochMilliseconds(Date.now()).toZonedDateTimeISO(DUTY_TIME_ZONE).toPlainDate();
    const weekStart = today.subtract({
      days: today.dayOfWeek - 1,
    });

    const debts = { ...numberOfDebts.value() };
    const debtPersons = DUTY_ROTATION.filter(
      (person) => (debts[person] ?? 0) > 0,
    );

    const calcDebt = (date: Temporal.PlainDate, duty: DutyPerson) => {
      if (debtPersons.length === 0) return null;

      const isTodayOrFuture = Temporal.PlainDate.compare(date, today) >= 0;

      if (!isTodayOrFuture) {
        return null;
      }

      const debtPerson = debtPersons[0];

      const debt = debts[debtPerson] ?? 0;

      if (debt <= 0 || debtPerson === duty) return null;

      debts[debtPerson] = debt - 1;

      if (debts[debtPerson] === 0) {
        debtPersons.shift();
      }

      return debtPerson;
    };

    const week = Array.from({ length: 7 }, (_, dayOffset) => {
      const date = weekStart.add({ days: dayOffset });
      const duty = getOfeliaDutyByDate(date);

      const debt = calcDebt(date, duty);

      return {
        date,
        isToday: date.equals(today),
        day: date.day,
        duty,
        debt,
      };
    });
    return week;
  });

  const inDept = action(async (person: DutyPerson) => {
    const debts = { ...numberOfDebts.value() };

    debts[person] = (debts[person] ?? 0) + 1;

    await storage.shared.server.set("debts", normalizeDepts(debts));
  }).extend(withAsyncData({ status: true }));

  const forgiveDept = action(async (person: DutyPerson) => {
    const debts = { ...numberOfDebts.value() };

    debts[person] = Math.max((debts[person] ?? 0) - 1, 0);

    await storage.shared.server.set("debts", normalizeDepts(debts));
  }).extend(withAsyncData({ status: true }));

  return {
    startOfWeek,
    numberOfDebts,
    currentWeek,
    inDept,
    forgiveDept,
  };
};

export function normalizeDepts(depts: Partial<NumberOfDepts>): NumberOfDepts {
  const values = DUTY_ROTATION.map((person) => depts[person] ?? 0);

  const minDebt = Math.min(...values);

  return DUTY_ROTATION.reduce<NumberOfDepts>(
    (normalized, person) => ({
      ...normalized,
      [person]: (depts[person] ?? 0) - minDebt,
    }),
    {} as NumberOfDepts,
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
