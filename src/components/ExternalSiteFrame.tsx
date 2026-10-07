import { useReportAutoRefresh } from "./indicadores/useReportAutoRefresh";
import { useState } from "react";

export function ExternalSiteFrame({
  url,
  title,
  fill = false,
}: {
  url: string;
  title: string;
  fill?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  useReportAutoRefresh(() => {
    setLoaded(false);
    setRefreshKey((key) => key + 1);
  });

  return (
    <div className={`external-site-frame-wrap${fill ? " external-site-frame-wrap--fill" : ""}`}>
      {!loaded ? <p className="lead external-site-loading">Carregando {title}…</p> : null}
      <iframe
        key={refreshKey}
        className="external-site-frame"
        src={url}
        title={title}
        onLoad={() => setLoaded(true)}
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
