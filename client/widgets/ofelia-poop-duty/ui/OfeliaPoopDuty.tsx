import { useMemo } from "react";
import { reatomMemo } from "../../../src/shared/reatom/reatom-memo";
import type { WidgetRuntimeProps } from "../../../src/widget-host/model/types";
import { ofeliaDutyModel } from "../model/ofelia-duty";
import styles from "./ofelia-poop-duty.module.css";

export const OfeliaPoopDuty = reatomMemo<WidgetRuntimeProps>(
  ({ mode, storage }) => {
    const model = useMemo(() => ofeliaDutyModel({ storage }), [storage]);

    if (mode === "large") {
      return (
        <section className={styles.root}>
          <div className={styles.label}>Сегодня</div>
          <h1 className={styles.title}>Кто сегодня убирает какахи Офелии</h1>
        </section>
      );
    }

    return (
      <section className={styles.small}>
        <div className={styles.label}>Сегодня убирает</div>
      </section>
    );
  },
  "OfeliaPoopDuty",
);
