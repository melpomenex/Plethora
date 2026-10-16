import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionCustomizeModal, DEFAULT_CUSTOMIZATION } from '../SessionCustomizeModal';
import { useSavedQueueStore } from '../../../stores/savedQueueStore';
import type { SavedQueue } from '../../../types/savedQueue';

vi.mock('../../../lib/i18n', () => ({
  t: (key: string) => {
    const map: Record<string, string> = {
      'savedQueues.saveAsNewQueue': 'Save as New Queue',
      'savedQueues.updateQueue': 'Update Queue',
      'savedQueues.namePlaceholder': 'Queue name (e.g. Today\'s Focus)',
      'sessionCustomize.title': 'Customize Session',
      'sessionCustomize.resetToDefaults': 'Reset to Defaults',
      'sessionCustomize.applyCustomization': 'Apply Customization',
      'common.cancel': 'Cancel',
      'common.save': 'Save',
    };
    return map[key] || key;
  },
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'savedQueues.saveAsNewQueue': 'Save as New Queue',
        'savedQueues.updateQueue': 'Update Queue',
        'savedQueues.namePlaceholder': 'Queue name (e.g. Today\'s Focus)',
        'sessionCustomize.title': 'Customize Session',
        'sessionCustomize.resetToDefaults': 'Reset to Defaults',
        'sessionCustomize.applyCustomization': 'Apply Customization',
        'common.cancel': 'Cancel',
        'common.save': 'Save',
      };
      return map[key] || key;
    },
    language: 'en',
  }),
}));

const mockActiveQueue: SavedQueue = {
  id: 'q-active',
  name: 'Active Focus',
  isDefault: true,
  filters: {
    priorityRange: { min: 20, max: 80 },
    tags: ['Math'],
    categories: [],
    excludeSuspended: true,
  },
  itemTypes: {
    documents: true,
    extracts: true,
    learningItems: false,
  },
  sessionDurationMinutes: 30,
  maxItems: 25,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('SessionCustomizeModal - Saved Queues', () => {
  const onClose = vi.fn();
  const onApply = vi.fn();
  const onSavedQueueCreated = vi.fn();
  const onSavedQueueUpdated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useSavedQueueStore.setState({
      savedQueues: [mockActiveQueue],
      activeQueueId: mockActiveQueue.id,
    });
  });

  it('renders through the shared dialog layer portaled to document.body', () => {
    const { container } = render(
      <SessionCustomizeModal
        isOpen={true}
        onClose={onClose}
        onApply={onApply}
        customization={DEFAULT_CUSTOMIZATION}
        onChange={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.classList.contains('adaptive-dialog-panel')).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    // The layer, not the tab content, owns the dialog: that is what lets the
    // scrim and panel paint above the mobile bottom navigation.
    const layer = dialog.closest('.adaptive-dialog-layer');
    expect(layer).not.toBeNull();
    expect(layer!.parentElement).toBe(document.body);
    expect(container.contains(dialog)).toBe(false);
  });

  it('renders modal with Save as New Queue and Update Queue buttons', () => {
    render(
      <SessionCustomizeModal
        isOpen={true}
        onClose={onClose}
        onApply={onApply}
        customization={DEFAULT_CUSTOMIZATION}
        onChange={vi.fn()}
        availableTags={['Math', 'Science']}
        availableCategories={['Default']}
      />
    );

    expect(screen.getByText('Save as New Queue')).toBeInTheDocument();
    expect(screen.getByText(/Active Focus/i)).toBeInTheDocument();
  });

  it('opens input when clicking Save as New Queue and saves', async () => {
    const createSpy = vi.fn().mockImplementation((input) =>
      Promise.resolve({
        id: 'q-new',
        ...input,
        isDefault: false,
        sortOrder: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      })
    );
    useSavedQueueStore.setState({ createSavedQueue: createSpy });

    render(
      <SessionCustomizeModal
        isOpen={true}
        onClose={onClose}
        onApply={onApply}
        customization={DEFAULT_CUSTOMIZATION}
        onChange={vi.fn()}
        onSavedQueueCreated={onSavedQueueCreated}
        availableTags={['Math', 'Science']}
        availableCategories={['Default']}
      />
    );

    fireEvent.click(screen.getByText('Save as New Queue'));

    const input = screen.getByPlaceholderText(/queue name/i);
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'My Custom Queue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Custom Queue',
        })
      );
    });
    expect(onSavedQueueCreated).toHaveBeenCalled();
  });

  it('updates the active queue when clicking Update Queue', async () => {
    const updateSpy = vi.fn().mockResolvedValue({
      ...mockActiveQueue,
      name: 'Active Focus',
    });
    useSavedQueueStore.setState({ updateSavedQueue: updateSpy });

    render(
      <SessionCustomizeModal
        isOpen={true}
        onClose={onClose}
        onApply={onApply}
        customization={DEFAULT_CUSTOMIZATION}
        onChange={vi.fn()}
        onSavedQueueUpdated={onSavedQueueUpdated}
        availableTags={['Math', 'Science']}
        availableCategories={['Default']}
      />
    );

    const updateBtn = screen.getByText(/Active Focus/i);
    fireEvent.click(updateBtn);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        'q-active',
        expect.objectContaining({
          filters: expect.any(Object),
          itemTypes: expect.any(Object),
        })
      );
    });
    expect(onSavedQueueUpdated).toHaveBeenCalled();
  });
});

/**
 * The phone/desktop split below is driven by the presentation mode, which in
 * jsdom falls back to "compact-desktop" because the Tauri globals exist in the
 * test environment. Stub the hook so each surface variant is asserted
 * deterministically; the real phone presentation is covered by the browser
 * check in `src/visual/session-customize.visual.spec.ts`.
 */
const presentationMode = vi.hoisted(() => ({ current: "desktop" }));
vi.mock("../../../contexts/PresentationContext", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../contexts/PresentationContext")>();
  return {
    ...actual,
    usePresentation: () => ({
      ...actual.readPresentationState(),
      mode: presentationMode.current,
      setDisplayMode: () => {},
    }),
  };
});

describe('SessionCustomizeModal - action area layout', () => {
  const renderModal = () =>
    render(
      <SessionCustomizeModal
        isOpen={true}
        onClose={vi.fn()}
        onApply={vi.fn()}
        customization={DEFAULT_CUSTOMIZATION}
        onChange={vi.fn()}
      />
    );

  beforeEach(() => {
    useSavedQueueStore.setState({
      savedQueues: [mockActiveQueue],
      activeQueueId: mockActiveQueue.id,
    });
  });

  afterEach(() => {
    presentationMode.current = "desktop";
  });

  it('keeps a full-width primary action above a 44px secondary row on a phone', () => {
    presentationMode.current = "phone";
    renderModal();

    const apply = screen.getByRole('button', { name: 'Apply Customization' });
    expect(apply.className).toContain('w-full');
    expect(apply.className).toContain('min-h-12');

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.className).toContain('w-full');

    const reset = screen.getByRole('button', { name: 'Reset to Defaults' });
    expect(reset.className).toContain('min-h-11');
    expect(screen.getByText('Save as New Queue').closest('button')!.className).toContain('min-h-11');

    // Reading order stays: secondary actions first, then Cancel, then Apply.
    const footer = document.querySelector('.adaptive-dialog-footer')!;
    const labels = Array.from(footer.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(labels).toEqual([
      'Reset to Defaults',
      'Save as New Queue',
      expect.stringContaining('Update Queue'),
      'Cancel',
      'Apply Customization',
    ]);
  });

  it('keeps the single desktop action row', () => {
    presentationMode.current = "desktop";
    renderModal();

    const apply = screen.getByRole('button', { name: 'Apply Customization' });
    expect(apply.className).not.toContain('w-full');

    const footer = document.querySelector('.adaptive-dialog-footer')!;
    const labels = Array.from(footer.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(labels[0]).toBe('Reset to Defaults');
    expect(labels[labels.length - 1]).toBe('Apply Customization');
  });

  it('keeps the queue name entry out of the scrolling body', () => {
    presentationMode.current = "phone";
    renderModal();

    fireEvent.click(screen.getByText('Save as New Queue'));
    const input = screen.getByPlaceholderText(/queue name/i);

    expect(document.querySelector('.adaptive-dialog-footer')!.contains(input)).toBe(true);
    expect(document.querySelector('.adaptive-dialog-body')!.contains(input)).toBe(false);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
