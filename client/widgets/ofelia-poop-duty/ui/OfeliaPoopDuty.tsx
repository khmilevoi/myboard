import { useMemo } from "react";
import { reatomMemo } from "../../../src/shared/reatom/reatom-memo";
import type { WidgetRuntimeProps } from "../../../src/widget-host/model/types";
import { ofeliaDutyModel } from "../model/ofelia-duty";
import { getServerTime } from "../../../src/shared/timer/model/server-time";
import styles from "./ofelia-poop-duty.module.css";

export const OfeliaPoopDuty = reatomMemo<WidgetRuntimeProps>(
  ({ mode, storage }) => {
    const model = useMemo(
      () => ofeliaDutyModel({ storage, timer: getServerTime() }),
      [storage],
    );
    const week = model.currentWeek();

    if (!week) {
      return (
        <section className={mode === "large" ? styles.root : styles.small}>
          <div className={styles.label}>Загрузка...</div>
        </section>
      );
    }

    const todayIndex = week.findIndex((day) => day.isToday);
    const today = todayIndex !== -1 ? week[todayIndex] : week[0];
    const tomorrow = todayIndex !== -1 && todayIndex + 1 < week.length ? week[todayIndex + 1] : week[1];

    if (mode === "large") {
      return (
        <section className={styles.root}>
          <div className={styles.label}>Сегодня</div>
          <h1 className={styles.title}>Кто сегодня убирает какахи Офелии</h1>
          <div className={styles.person}>{today.duty}</div>
          <div className={styles.meta}>Завтра: {tomorrow.duty}</div>
        </section>
      );
    }

    return (
      <section className={styles.small}>
        <div className={styles.label}>Сегодня убирает</div>
        <div className={styles.person}>{today.duty}</div>
        <div className={styles.meta}>Завтра: {tomorrow.duty}</div>
      </section>
    );
  },
  "OfeliaPoopDuty",
);
