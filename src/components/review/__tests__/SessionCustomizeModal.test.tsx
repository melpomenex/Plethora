import { describe, it, expect, vi, beforeEach } from 'vitest';
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
