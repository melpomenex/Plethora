import { useEffect, type RefObject } from 'react';
import { registerOverlayDismissal } from '../../lib/overlayStack';

/** Actions menus close before their owning sheet and return to a non-editable trigger. */
export function useAssistantMenuDismissal(open: boolean, container: RefObject<HTMLElement | null>, anchor: RefObject<HTMLButtonElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const dismiss = () => { onClose(); anchor.current?.focus(); };
    const unregister = registerOverlayDismissal(dismiss, { priority: 70 });
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation(); dismiss();
    };
    const outside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (container.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside);
    return () => {
      unregister(); document.removeEventListener('keydown', keydown);
      document.removeEventListener('mousedown', outside); document.removeEventListener('touchstart', outside);
    };
  }, [open, container, anchor, onClose]);
}
