"use client";

import { SERVICE_OPTIONS } from "@/lib/domain/services";
import { csvToList, listToCsv } from "@/lib/utils/format";

export interface ServiceCheckboxGroupProps {
  value: string;
  onChange: (csv: string) => void;
  name?: string;
}

export function ServiceCheckboxGroup({
  value,
  onChange,
  name = "target_service",
}: ServiceCheckboxGroupProps) {
  const selected = new Set(csvToList(value));
  const toggle = (option: string) => {
    if (selected.has(option)) selected.delete(option);
    else selected.add(option);
    onChange(listToCsv([...selected]));
  };
  return (
    <>
      {/* hidden field for form submission */}
      <input type="hidden" name={name} value={value} />
      <div className="flex flex-wrap gap-2">
        {SERVICE_OPTIONS.map((opt) => {
          const checked = selected.has(opt);
          return (
            <button
              type="button"
              key={opt}
              onClick={() => toggle(opt)}
              aria-pressed={checked}
              className={
                checked
                  ? "px-3 py-1.5 rounded-full border text-xs font-medium border-blue-600 bg-blue-600 text-white"
                  : "px-3 py-1.5 rounded-full border text-xs font-medium border-input bg-card text-foreground hover:border-ring/50"
              }
            >
              {opt}
            </button>
          );
        })}
      </div>
    </>
  );
}
