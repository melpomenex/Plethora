import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useAccountStore } from "../stores/accountStore";
import { useCollectionStore } from "../stores/collectionStore";
import { useLanguageProfileStore } from "../stores/languageProfileStore";

export interface LanguageProfileContextValue {
  profileStore: typeof useLanguageProfileStore;
}

const LanguageProfileContext = createContext<LanguageProfileContextValue | null>(null);

/**
 * Loads the profile projection once per account/workspace. Content surfaces
 * still resolve an explicit context by content ID; the provider never turns
 * the active profile into implicit Language Mode.
 */
export function LanguageProfileProvider({ children }: { children: ReactNode }) {
  const accountId = useAccountStore((state) => state.user?.id || "local");
  const workspaceId = useCollectionStore((state) => state.activeCollectionId || "default");
  const setScope = useLanguageProfileStore((state) => state.setScope);

  useEffect(() => {
    void setScope({ accountId, workspaceId });
  }, [accountId, workspaceId, setScope]);

  return (
    <LanguageProfileContext.Provider value={{ profileStore: useLanguageProfileStore }}>
      {children}
    </LanguageProfileContext.Provider>
  );
}

export function useLanguageProfileContext(): LanguageProfileContextValue {
  const context = useContext(LanguageProfileContext);
  if (!context) throw new Error("useLanguageProfileContext must be used within LanguageProfileProvider");
  return context;
}
