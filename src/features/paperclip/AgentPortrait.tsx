import { useEffect, useState, type CSSProperties } from "react";
import { BadgeCheck, Bot, Code2, Compass, Cpu, Crown, Megaphone, Palette, ScanSearch, ShieldCheck, Wallet, Workflow } from "lucide-react";
import { paperclipApi, type Agent } from "./api";
import { usePaperclipStore } from "./store";

const palettes = ["bubblegum-sky", "pink-lemonade", "orchid-peach", "coral-mint", "lime-lagoon", "arctic-blue", "solar-flare", "violet-ember", "deep-tide", "coral-current", "golden-hour", "tangerine-cobalt", "electric-grove", "flamingo-jade", "cherry-pop", "turquoise-cherry", "ultraviolet-tide"];
const roleIcons = { ceo: Crown, cto: Cpu, cmo: Megaphone, cfo: Wallet, security: ShieldCheck, engineer: Code2, designer: Palette, pm: Compass, qa: BadgeCheck, devops: Workflow, researcher: ScanSearch, general: Bot };
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const failedUntil = new Map<string, number>();
const queue: (() => void)[] = [];
let active = 0;
function drain() { while (active < 4 && queue.length) queue.shift()!(); }

/** Matches Paperclip's stable legacy palette selection; never random per render. */
export function legacyPalette(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % palettes.length;
  return palettes[hash];
}
export function portraitHue(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 360;
}
function load(key: string, palette: string | null, assetId: string | null, port: number): Promise<string> {
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const flight = pending.get(key);
  if (flight) return flight;
  if ((failedUntil.get(key) ?? 0) > Date.now()) return Promise.reject(new Error("Avatar cooldown"));
  if (queue.length >= 64) return Promise.reject(new Error("Avatar queue is full"));
  const promise = new Promise<string>((resolve, reject) => {
    queue.push(() => {
      ++active;
      Promise.resolve().then(() => paperclipApi.avatar(palette, assetId, port)).then((image) => {
        if (!image.startsWith("data:image/png;base64,")) throw new Error("Unsupported avatar response");
        cache.set(key, image);
        while (cache.size > 128) cache.delete(cache.keys().next().value!);
        resolve(image);
      }).catch((error: unknown) => {
        failedUntil.set(key, Date.now() + 120_000);
        while (failedUntil.size > 128) failedUntil.delete(failedUntil.keys().next().value!);
        reject(error);
      }).finally(() => { pending.delete(key); --active; drain(); });
    });
  });
  pending.set(key, promise); drain();
  return promise;
}

export function AgentPortrait({ agent, visible = true, compact = false }: { agent: Agent; visible?: boolean; compact?: boolean }) {
  const port = usePaperclipStore((s) => s.config?.port ?? 3100);
  const asset = agent.appearance?.customAvatarAssetId ?? null;
  const requestedPalette = agent.appearance?.paletteId;
  const palette = asset ? null : requestedPalette && palettes.includes(requestedPalette) ? requestedPalette : legacyPalette(agent.id);
  const key = `${port}:${asset ?? palette}`;
  const [loaded, setLoaded] = useState<{ key: string; src: string } | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const hue = portraitHue(agent.id);
  const Icon = roleIcons[agent.role as keyof typeof roleIcons] ?? Bot;
  useEffect(() => {
    if (!visible) return;
    let current = true;
    load(key, palette, asset, port).then((src) => { if (current) setLoaded({ key, src }); }, () => {});
    return () => { current = false; };
  }, [key, palette, asset, visible, port]);
  const src = loaded?.key === key ? loaded.src : cache.get(key);
  return <span className={`pc-agent-portrait ${compact ? "pc-agent-portrait-compact" : ""}`} style={{ "--portrait-hue": hue } as CSSProperties} aria-hidden>
    {src && broken !== key ? <img src={src} width={compact ? 24 : 64} height={compact ? 24 : 64} decoding="async" alt="" onError={() => setBroken(key)} /> : <Icon className="pc-portrait-fallback" />}
    {!compact && <span className="pc-portrait-role"><Icon /></span>}
  </span>;
}
