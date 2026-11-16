import MousePointer2 from "lucide-react/dist/esm/icons/mouse-pointer-2";
import Square from "lucide-react/dist/esm/icons/square";
import { useTranslation } from "react-i18next";
import { isWeb } from "@/lib/platform";
import { cx } from "@/utils/cx";
import { useChatStore } from "../store";
import { engineSupportsComputerUse } from "../computer-use";

/** One-turn opt-in next to the composer; an active turn has its own Stop. */
export function ComputerUseControl({ sessionKey, engine, armed, onToggle, onStop }: {
  sessionKey: string;
  engine: string;
  armed: boolean;
  onToggle: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const supported = useChatStore((s) => engineSupportsComputerUse(s.engines, engine));
  const running = useChatStore((s) => s.bySession[sessionKey]?.streaming === true && s.bySession[sessionKey]?.activeComputerUse === true);
  if (isWeb || !engine) return null;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        aria-pressed={armed}
        aria-disabled={!supported}
        aria-label={t("chat.cuaToggle")}
        title={t(supported ? "chat.cuaToggleHint" : "chat.cuaUnsupportedEngine")}
        onClick={() => { if (supported) onToggle(); }}
        className={cx(
          "inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-caption-1-medium outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-status-blue-text",
          !supported ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          armed ? "bg-status-blue-background text-status-blue-text" : "text-text-secondary hover:bg-background-primary-hover",
        )}
      >
        <MousePointer2 className="size-3.5 shrink-0" aria-hidden />
        <span>{t(armed ? "chat.cuaArmed" : "chat.cuaToggle")}</span>
      </button>
      {running && (
        <button type="button" onClick={onStop} title={t("chat.cuaStopHint")}
          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg bg-status-blue-background px-2 text-caption-1-medium text-status-blue-text outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-status-blue-text">
          <Square className="size-3 shrink-0 fill-current" aria-hidden />
          <span>{t("chat.cuaStop")}</span>
        </button>
      )}
    </div>
  );
}
