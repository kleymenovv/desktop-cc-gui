import { Children, Fragment, isValidElement, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Select, SelectItem } from "@/components/base/select/select";
import { usePaperclipStore } from "./store";

interface Choice { value: string; label: ReactNode; text: string; disabled: boolean }
interface Props {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  "aria-label": string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

function textOf(node: ReactNode): string {
  return Children.toArray(node).map((child) => typeof child === "string" || typeof child === "number" ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : "").join("");
}
function choicesOf(children: ReactNode): Choice[] {
  return Children.toArray(children).flatMap((child): Choice[] => {
    if (!isValidElement<{ children?: ReactNode; value?: string; disabled?: boolean }>(child)) return [];
    if (child.type === Fragment) return choicesOf(child.props.children);
    if (child.type !== "option") throw new Error("PaperclipSelect accepts option elements only");
    return [{ value: String(child.props.value ?? ""), label: child.props.children, text: textOf(child.props.children), disabled: !!child.props.disabled }];
  });
}

/** The Paperclip forms use the same accessible menu surface as CC GUI. Native
 * option declarations are data only; no platform select is visible. */
export function PaperclipSelect({ value, onValueChange, children, disabled, required, className, "aria-label": label }: Props) {
  const { t } = useTranslation();
  const busy = usePaperclipStore((s) => !!s.busy);
  const [query, setQuery] = useState("");
  const choices = choicesOf(children);
  const selected = choices.find((choice) => choice.value === value);
  const options = query ? choices.filter((choice) => choice.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())) : choices;
  const key = (choice: string) => choice === "" ? "paperclip-empty-value" : choice;
  return <Select
    aria-label={label}
    selectedKey={required && value === "" ? null : key(value)}
    onSelectionChange={(next) => {
      if (next == null) return;
      onValueChange(next === "paperclip-empty-value" ? "" : String(next));
    }}
    isDisabled={!!disabled || busy}
    isRequired={required}
    size="sm"
    className={`pc-select ${className ?? ""}`}
    triggerClassName="pc-select-trigger"
    popoverClassName="pc-select-popover"
    renderValue={<span className="truncate">{selected?.label ?? t("paperclip.ext.choose")}</span>}
    search={choices.length >= 8 ? { value: query, onChange: setQuery, placeholder: t("paperclip.ext.searchOptions") } : undefined}
    emptyContent={<span className="block px-2 py-3 text-body-2-medium text-text-secondary">{t("paperclip.ext.noMatches")}</span>}
  >
    {options.map((choice) => <SelectItem key={key(choice.value)} id={key(choice.value)} textValue={choice.text} isDisabled={choice.disabled}>
      <span className="flex w-full min-w-0 items-center justify-between gap-3"><span className="truncate">{choice.label}</span>{choice.value === value && <Check className="size-3.5 shrink-0 text-text-primary" aria-hidden />}</span>
    </SelectItem>)}
  </Select>;
}
