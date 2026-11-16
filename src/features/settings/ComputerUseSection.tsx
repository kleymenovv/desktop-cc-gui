import { useCallback, useEffect, useRef, useState } from "react";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/base/buttons/button";
import { Chip } from "@/components/base/chips/chip";
import {
  SettingsCard,
  SettingsRow,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { errorText } from "@/lib/errors";
import { IS_MAC } from "@/lib/platform";
import { ipc, type ComputerUsePermissionStatus } from "@/lib/ipc";
import { useChatStore } from "@/features/chat/store";
import { engineSupportsComputerUse } from "@/features/chat/computer-use";

/**
 * 设置 → 电脑操控: what the computer-use driver needs, how to grant it, and
 * which engines can receive it.
 *
 * A computer-use turn is opt-in per send (the composer pointer button or
 * `/ccgui-cua <task>`), never a global mode: the
 * driver pre-approves machine input, so it must not be reachable from an
 * ordinary message that the user did not mean as a machine command. This
 * page is the setup/status surface that command points at.
 *
 * The virtual pointer is not a setting either — the app draws it for the
 * whole run (src-tauri/src/cu_overlay.rs); the model has no tool that can
 * hide it. The copy says so, because "can I see what it is doing" is the
 * first question this page has to answer.
 */
export function ComputerUseSection() {
  const { t } = useTranslation();
  const engines = useChatStore((s) => s.engines);
  const [status, setStatus] = useState<ComputerUsePermissionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const request = useRef(0);
  const refresh = useActionFeedback({ spin: true });
  const [previewing, setPreviewing] = useState(false);
  const previewCursor = async () => {
    if (previewing) return;
    setPreviewing(true);
    try { await ipc.computerUsePreviewCursor(); }
    catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { if (mounted.current) setPreviewing(false); }
  };

  const refreshStatus = useCallback(async () => {
    if (!mounted.current) return;
    const sequence = ++request.current;
    try {
      const next = await ipc.computerUsePermissionStatus();
      if (mounted.current && request.current === sequence) {
        setStatus(next);
        setError(null);
      }
    } catch (e) {
      if (mounted.current && request.current === sequence) setError(errorText(e));
      throw e;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshStatus().catch(() => {});
    return () => { mounted.current = false; ++request.current; };
  }, [refreshStatus]);

  const openPane = useCallback(
    (kind: "accessibility" | "screenRecording") => {
      void ipc
        .computerUseOpenPermissionSettings(kind)
        .then(() => refreshStatus())
        .catch((e) => setError(errorText(e)));
    },
    [refreshStatus],
  );

  const granted = (ok: boolean | undefined) => (
    <Chip selected={ok === true}>
      {ok ? t("settings.computerUseGranted") : t("settings.computerUseNotGranted")}
    </Chip>
  );

  return (
    <div className="flex w-full flex-col gap-6">
      {error && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {error}
        </p>
      )}

      <div className="flex w-full flex-col gap-2">
        <SettingsSectionLabel>agent-desktop</SettingsSectionLabel>
        <SettingsCard>
          <SettingsRow label={t("settings.computerUseDesktopEngine")}
            description={t("settings.computerUseDesktopEngineDesc")}>
            <Chip selected={status?.agentDesktopAvailable === true}>
              {status ? t(status.agentDesktopAvailable ? "settings.computerUseDesktopReady" : "settings.computerUseDesktopMissing") : t("common.loading")}
              {status?.agentDesktopAvailable && status.agentDesktopVersion ? ` · ${status.agentDesktopVersion}` : ""}
            </Chip>
          </SettingsRow>
          <SettingsRow label={t("settings.computerUseDesktopLifecycle")}
            description={t("settings.computerUseDesktopLifecycleDesc")}>
            <Button variant="secondary" size="small" disabled={refresh.feedback === "running"}
              onClick={() => { void refresh.start(refreshStatus).catch(() => {}); }}>
              <ActionFeedbackIcon icon={RefreshCw} feedback={refresh.feedback} spin />
              {t("settings.computerUseRefresh")}
            </Button>
          </SettingsRow>
        </SettingsCard>
      </div>

      <div className="flex w-full flex-col gap-2">
        <SettingsSectionLabel>{t("settings.computerUsePermissions")}</SettingsSectionLabel>
        <SettingsCard>
          {status && !status.osPermissionsRequired ? (
            <SettingsRow
              label={t("settings.computerUseNoGrantNeeded")}
              description={t("settings.computerUseNoGrantNeededDesc")}
            />
          ) : (
            <>
              <SettingsRow
                label={t("settings.computerUseAccessibility")}
                description={t("settings.computerUseAccessibilityDesc")}
              >
                <div className="flex items-center gap-2">
                  {granted(status?.accessibility)}
                  {IS_MAC && (
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => openPane("accessibility")}
                    >
                      {t("settings.computerUseOpenPane")}
                    </Button>
                  )}
                </div>
              </SettingsRow>
              <SettingsRow
                label={t("settings.computerUseScreenRecording")}
                description={t("settings.computerUseScreenRecordingDesc")}
              >
                <div className="flex items-center gap-2">
                  {granted(status?.screenRecording)}
                  {IS_MAC && (
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => openPane("screenRecording")}
                    >
                      {t("settings.computerUseOpenPane")}
                    </Button>
                  )}
                </div>
              </SettingsRow>
            </>
          )}
        </SettingsCard>
      </div>

      <div className="flex w-full flex-col gap-2">
        <SettingsSectionLabel>{t("settings.computerUseUsage")}</SettingsSectionLabel>
        <SettingsCard>
          <SettingsRow
            label={t("settings.computerUseTrigger")}
            description={t("settings.computerUseTriggerDesc")}
          />
          <SettingsRow
            label={t("settings.computerUseCursor")}
            description={t("settings.computerUseCursorDesc")}
          >
            <Button variant="secondary" size="small" disabled={previewing} onClick={() => void previewCursor()}>
              {t("settings.computerUsePreviewCursor")}
            </Button>
          </SettingsRow>
        </SettingsCard>
      </div>

      <div className="flex w-full flex-col gap-2">
        <SettingsSectionLabel>{t("settings.computerUseEngines")}</SettingsSectionLabel>
        <SettingsCard>
          {engines.map((engine) => (
            <SettingsRow
              key={engine.id}
              label={CLI_DISPLAY_NAMES[engine.id] ?? engine.id}
              labelAdornment={<EngineIcon engine={engine.id} size={14} />}
            >
              <Chip selected={engineSupportsComputerUse(engines, engine.id)}>
                {engineSupportsComputerUse(engines, engine.id)
                  ? t("settings.computerUseEngineSupported")
                  : t("settings.computerUseEngineUnsupported")}
              </Chip>
            </SettingsRow>
          ))}
        </SettingsCard>
        <p className="px-3 text-body-2-regular text-text-secondary">
          {t("settings.computerUseEnginesDesc")}
        </p>
      </div>
    </div>
  );
}
