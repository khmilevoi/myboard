import type { ComponentType } from "react";
import type { ResolvedTheme } from "@/shared/theme/types";
import { WidgetStorage } from "@/storage/model/widget-storage";

export type WidgetMode = "small" | "large";

export type WidgetRuntimeProps = {
  instanceId: string;
  typeId: string;
  mode: WidgetMode;
  theme: ResolvedTheme;
  requestFullscreen: () => void;
  requestClose: () => void;
  reportError: (error: Error) => void;
  storage: WidgetStorage;
};

export type WidgetComponent = ComponentType<WidgetRuntimeProps>;
export type WidgetComponentModule = { default: WidgetComponent };
export type WidgetLoader = () => Promise<WidgetComponentModule>;
