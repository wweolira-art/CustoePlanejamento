import { useEffect, useState } from "react";

export type MergedTabPickerItem = {
  key: string;
  label: string;
};

export function useMergedTabSelection(items: MergedTabPickerItem[], initialKey?: string) {
  const [activeKey, setActiveKey] = useState(() => {
    if (initialKey && items.some((item) => item.key === initialKey)) return initialKey;
    return items[0]?.key ?? "";
  });

  useEffect(() => {
    if (initialKey && items.some((item) => item.key === initialKey)) {
      setActiveKey(initialKey);
    }
  }, [initialKey, items]);

  useEffect(() => {
    if (items.length && !items.some((item) => item.key === activeKey)) {
      setActiveKey(items[0]?.key ?? "");
    }
  }, [items, activeKey]);

  const activeItem = items.find((item) => item.key === activeKey) ?? items[0];
  return { activeKey: activeItem?.key ?? "", setActiveKey, activeItem };
}

export function MergedTabPicker({
  items,
  activeKey,
  onChange,
  caption = "Relatório",
}: {
  items: MergedTabPickerItem[];
  activeKey: string;
  onChange: (key: string) => void;
  caption?: string;
}) {
  if (items.length <= 1) return null;

  return (
    <div className="merged-tab-picker-wrap">
      <span className="merged-tab-picker-caption">{caption}</span>
      <div className="kind-toggle merged-report-picker" style={{ paddingBottom: 8, flexWrap: "wrap" }}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`btn ${activeKey === item.key ? "primary" : ""}`}
            onClick={() => onChange(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
