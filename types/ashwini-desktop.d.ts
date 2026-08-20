import type { AppState } from "@/lib/app-state";

declare global {
  interface Window {
    ashwiniDesktop?: {
      isDesktop: true;
      platform: string;
      loadState: () => Promise<AppState | null>;
      saveState: (state: AppState) => Promise<void>;
    };
  }
}

export {};
