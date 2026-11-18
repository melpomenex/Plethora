import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { GuidedReadingPanel } from '../GuidedReadingPanel';
import {
  BottomControlsGeometryProvider,
  usePublishBottomControls,
} from '../../mobile/BottomControlsGeometry';

const mockTrailState = {
  tabId: 'tab-1',
  status: 'exact' as const,
  saving: false,
  guidedSegment: {
    panelOpen: true,
    entry: {
      item: {
        id: 'item-1',
        planId: 'plan-1',
        versionId: 'ver-1',
        nodeId: 'node-1',
        objectiveIndex: 0,
        segmentId: 'seg-1',
        trailOrder: 1,
        isRequired: true,
        isRemediation: false,
        status: 'pending',
        readingProgress: 0.25,
        plannerRationale: 'Scheduled after prerequisites.',
      },
      node: {
        nodeId: 'node-1',
        title: 'Desire, Reward, and the Anticipation Loop',
        learningObjectives: ['Analyze how notifications sustain attention.'],
      },
      objectiveText: 'Analyze how notifications sustain attention.',
      segment: {
        id: 'seg-1',
        documentId: 'doc-1',
        title: 'The Problem',
        parentSectionLabel: 'II. The Problem',
        estimatedDurationSeconds: 120,
        structuralClass: 'body',
        validationStatus: 'valid',
        startLocator: { textQuote: 'Your dopamine neurotransmitters are being hijacked' },
        endLocator: { textQuote: 'the internet has become the one using you' },
      },
      documentTitle: 'Dopamine Detox',
      estimatedMinutes: 2,
      alternatives: [],
      unmetPrerequisites: [],
    },
    detail: {
      plan: { id: 'plan-1', title: 'Focus' },
      version: { id: 'ver-1', nodes: [{ nodeId: 'node-1', title: 'Desire, Reward, and the Anticipation Loop', learningObjectives: ['Analyze how notifications sustain attention.'] }] },
    },
    overview: {
      trailItems: [
        { id: 'item-1', nodeId: 'node-1', objectiveIndex: 0, segmentId: 'seg-1', trailOrder: 1, isRequired: true, isRemediation: false, status: 'pending', readingProgress: 0.25, plannerRationale: '' },
        { id: 'item-2', nodeId: 'node-2', objectiveIndex: 0, segmentId: 'seg-2', trailOrder: 2, isRequired: true, isRemediation: false, status: 'pending', readingProgress: 0, plannerRationale: '' },
      ],
      segments: [],
      objectiveLinks: [],
      documentTitles: { 'doc-1': 'Dopamine Detox' },
      diagnostics: [],
      eligibility: { eligible: false, requiredCompleted: 0, requiredTotal: 2, checksPassed: 0, blockingReasons: [], testOutAvailable: false },
    },
  },
};

vi.mock('../../../lib/study-plans/reading/trailController', () => ({
  useStudyTrail: (selector: (s: typeof mockTrailState) => unknown) => selector(mockTrailState),
  exitStudyTrail: vi.fn(),
  getGuidedQueueNeighbors: () => ({
    previous: undefined,
    next: { node: { nodeId: 'node-2', title: 'Next Topic' } },
    currentIndex: 0,
    total: 2,
  }),
  moveGuidedSegment: vi.fn(),
  setGuidedPanelOpen: vi.fn(),
  updateGuidedProgress: vi.fn(),
}));

function MobileDockHost({ children }: { children: React.ReactNode }) {
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);

  usePublishBottomControls({
    viewport: { top: 0, height: 800, width: 390, safeTop: 0, safeBottom: 16, keyboardHeight: 0 },
    navRef,
    pillRef,
    pillVisible: true,
    blocked: false,
    fullscreen: false,
  });

  return (
    <>
      <nav
        ref={(el) => {
          (navRef as React.MutableRefObject<HTMLElement | null>).current = el;
          if (el) {
            el.getBoundingClientRect = () =>
              ({ top: 728, bottom: 800, height: 72, left: 0, right: 390, width: 390, x: 0, y: 728, toJSON: () => ({}) } as DOMRect);
          }
        }}
      />
      <button
        ref={(el) => {
          (pillRef as React.MutableRefObject<HTMLButtonElement | null>).current = el;
          if (el) {
            el.getBoundingClientRect = () =>
              ({ top: 676, bottom: 716, height: 40, left: 130, right: 260, width: 130, x: 130, y: 676, toJSON: () => ({}) } as DOMRect);
          }
        }}
      >
        Assistant
      </button>
      {children}
    </>
  );
}

describe('GuidedReadingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the mobile bottom navigation and Assistant pill when BottomControlsGeometry is published', () => {
    render(
      <BottomControlsGeometryProvider>
        <MobileDockHost>
          <GuidedReadingPanel tabId="tab-1" isMobile />
        </MobileDockHost>
      </BottomControlsGeometryProvider>,
    );

    const panel = screen.getByTestId('guided-reading-panel');
    // occupiedTop is 676 on an 800px viewport -> clearance is 800 - 676 + 8 = 132px
    expect(panel.style.bottom).toBe('132px');
    // maxHeight = 800 - 132 - 64 = 604px
    expect(panel.style.maxHeight).toBe('604px');
    expect(panel.className).toContain('bg-background/95');
    expect(panel.className).toContain('backdrop-blur-md');
    expect(panel.className).toContain('inset-x-2');
    expect(panel.className).toContain('rounded-2xl');
  });

  it('uses safe fallback bottom offset on mobile without geometry provider', () => {
    render(<GuidedReadingPanel tabId="tab-1" isMobile />);
    const panel = screen.getByTestId('guided-reading-panel');
    expect(panel.style.bottom).toContain('72px');
    expect(panel.className).toContain('max-h-[60vh]');
  });

  it('renders as a docked side panel on desktop without mobile bottom offset', () => {
    render(<GuidedReadingPanel tabId="tab-1" isMobile={false} />);
    const panel = screen.getByTestId('guided-reading-panel');
    expect(panel.style.bottom).toBe('');
    expect(panel.className).toContain('w-80');
  });
});
