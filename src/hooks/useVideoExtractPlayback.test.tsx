import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useVideoExtractPlayback } from './useVideoExtractPlayback';
import type { VideoExtract } from '../api/video-extracts';

const mocks = vi.hoisted(() => ({ mark: vi.fn(), toast: { error: vi.fn() } }));
vi.mock('../api/video-extracts', () => ({ markVideoExtractSeen: mocks.mark }));
vi.mock('../components/common/Toast', () => ({ useToast: () => mocks.toast }));
const extract = { id: 'segment', document_id: 'video', start_time: 10, end_time: 20 } as VideoExtract;
beforeEach(() => { vi.clearAllMocks(); mocks.mark.mockResolvedValue(extract); });

it('records seen once only after a playing sample inside the selected segment', async () => {
  const { result } = renderHook(() => useVideoExtractPlayback('video'));
  act(() => result.current.select(extract));
  expect(mocks.mark).not.toHaveBeenCalled();
  act(() => { result.current.confirm(0); result.current.confirm(NaN); });
  expect(mocks.mark).not.toHaveBeenCalled();
  act(() => { result.current.confirm(10); result.current.confirm(11); });
  await waitFor(() => expect(mocks.mark).toHaveBeenCalledTimes(1));
  expect(mocks.mark).toHaveBeenCalledWith('segment');
});

it('does not mark failed playback or stale selections after changing documents', () => {
  const { result, rerender } = renderHook(({ id }) => useVideoExtractPlayback(id), { initialProps: { id: 'video' } });
  act(() => { result.current.select(extract); result.current.cancel(); result.current.confirm(10); });
  expect(mocks.mark).not.toHaveBeenCalled();
  act(() => result.current.select(extract));
  rerender({ id: 'another' });
  act(() => result.current.confirm(10));
  expect(mocks.mark).not.toHaveBeenCalled();
});

it('keeps a persistence failure visible and permits reopening to retry', async () => {
  mocks.mark.mockRejectedValueOnce(new Error('Local disk unavailable'));
  const { result } = renderHook(() => useVideoExtractPlayback('video'));
  act(() => { result.current.select(extract); result.current.confirm(10); });
  await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Local disk unavailable'));
  act(() => { result.current.select(extract); result.current.confirm(10); });
  await waitFor(() => expect(mocks.mark).toHaveBeenCalledTimes(2));
});
