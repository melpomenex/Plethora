import { useAccountStore } from "../../stores/accountStore";

// Account identifiers stay out of display copy, and progress is never shared between these namespaces.
export function useAudioProfileKey(): string {
  return useAccountStore(state => (state.user?.id ? `account:${state.user.id}` : "local"));
}
