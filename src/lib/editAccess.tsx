import { createContext, useContext, type ReactNode } from "react";

const EditAccessCtx = createContext(true);

export function EditAccessProvider({ canEdit, children }: { canEdit: boolean; children: ReactNode }) {
  return <EditAccessCtx.Provider value={canEdit}>{children}</EditAccessCtx.Provider>;
}

export function useCanEditItems() {
  return useContext(EditAccessCtx);
}

export function ReadOnlyBanner() {
  const canEdit = useCanEditItems();
  if (canEdit) return null;
  return (
    <div className="read-only-banner" role="status">
      Modo somente leitura — você pode consultar, mas não alterar os dados desta aba.
    </div>
  );
}

export function ReadOnlyFieldset({ children }: { children: ReactNode }) {
  const canEdit = useCanEditItems();
  if (canEdit) return <>{children}</>;
  return (
    <fieldset disabled className="read-only-fieldset">
      {children}
    </fieldset>
  );
}
