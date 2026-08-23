import type { ReactNode } from 'react';
import type { DemoState } from '../../config/demo-contract.ts';
import { DEMO_LIBRARY, itemForKind, type DemoItem } from './content.ts';
import type { DemoEvent } from './machine.ts';
import type { DemoShell } from './shell.ts';

const GRADE_BUTTONS: { rating: 1 | 2 | 3 | 4; label: string }[] = [
  { rating: 1, label: 'Again' },
  { rating: 2, label: 'Hard' },
  { rating: 3, label: 'Good' },
  { rating: 4, label: 'Easy' },
];

export function liveRegionText(state: DemoState, item: DemoItem): string {
  return `${item.title}. Stage: ${state.stage}.`;
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  disabledReason,
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <button
      type="button"
      className="demo-btn demo-btn-primary"
      onClick={onClick}
      disabled={disabled}
      aria-label={disabled && disabledReason ? disabledReason : undefined}
      title={disabled && disabledReason ? disabledReason : undefined}
    >
      {children}
    </button>
  );
}

export function StageScreen({
  state,
  dispatch,
}: {
  state: DemoState;
  dispatch: (event: DemoEvent) => void;
}) {
  const item = itemForKind(state.contentKind);

  switch (state.stage) {
    case 'library':
      return (
        <div className="demo-screen" data-stage="library">
          <h3 className="demo-screen-title">Library</h3>
          <ul className="demo-grid">
            {DEMO_LIBRARY.map((entry) => (
              <li key={entry.kind}>
                <button
                  type="button"
                  className="demo-card-btn"
                  onClick={() => dispatch({ type: 'select-kind', kind: entry.kind })}
                >
                  <span className="demo-kind">{entry.kind}</span>
                  <span className="demo-card-title">{entry.title}</span>
                  <span className="demo-muted">{entry.subtitle}</span>
                </button>
              </li>
            ))}
          </ul>
          <PrimaryButton onClick={() => dispatch({ type: 'advance' })}>Open featured article</PrimaryButton>
        </div>
      );
    case 'item':
      return (
        <div className="demo-screen" data-stage="item">
          <p className="demo-kind">{item.kind}</p>
          <h3 className="demo-screen-title">{item.title}</h3>
          <p className="demo-muted">
            {item.author} · {item.subtitle}
          </p>
          <PrimaryButton onClick={() => dispatch({ type: 'advance' })}>Open</PrimaryButton>
        </div>
      );
    case 'reader':
      return (
        <div className="demo-screen" data-stage="reader">
          <h3 className="demo-screen-title">{item.title}</h3>
          {item.mediaCaption ? <p className="demo-media">{item.mediaCaption}</p> : null}
          {item.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <PrimaryButton onClick={() => dispatch({ type: 'advance' })}>
            {item.kind === 'podcast' || item.kind === 'video' ? 'Go to key moment' : 'Find a passage'}
          </PrimaryButton>
        </div>
      );
    case 'passage':
      return (
        <div className="demo-screen" data-stage="passage">
          <h3 className="demo-screen-title">Passage</h3>
          <button type="button" className="demo-hit" onClick={() => dispatch({ type: 'select-passage' })}>
            {item.passage.text}
            <span className="demo-hit-label">{item.passage.hitLabel}</span>
          </button>
        </div>
      );
    case 'explain':
      return (
        <div className="demo-screen" data-stage="explain">
          <h3 className="demo-screen-title">Explain</h3>
          <p>{item.explain}</p>
          <PrimaryButton onClick={() => dispatch({ type: 'advance' })}>Continue</PrimaryButton>
        </div>
      );
    case 'remember-confirm':
      return (
        <div className="demo-screen" data-stage="remember-confirm">
          <h3 className="demo-screen-title">Keep this</h3>
          <p>Turn the selected moment into a recall card.</p>
          <PrimaryButton onClick={() => dispatch({ type: 'remember' })}>Remember this</PrimaryButton>
        </div>
      );
    case 'card':
      return (
        <div className="demo-screen" data-stage="card">
          <h3 className="demo-screen-title">Card preview</h3>
          <p className="demo-kind">{item.card.type}</p>
          <p className="demo-card-front">{item.card.front}</p>
          <PrimaryButton onClick={() => dispatch({ type: 'advance' })}>Review this card</PrimaryButton>
        </div>
      );
    case 'review-prompt':
      return (
        <div className="demo-screen" data-stage="review-prompt">
          <h3 className="demo-screen-title">Review</h3>
          <p className="demo-card-front">{item.card.front}</p>
          {item.card.choices ? (
            <ul className="demo-choices">
              {item.card.choices.map((choice) => (
                <li key={choice}>{choice}</li>
              ))}
            </ul>
          ) : null}
          <PrimaryButton onClick={() => dispatch({ type: 'reveal' })}>Show answer</PrimaryButton>
        </div>
      );
    case 'review-reveal':
      return (
        <div className="demo-screen" data-stage="review-reveal">
          <h3 className="demo-screen-title">Answer</h3>
          <p className="demo-card-front">{item.card.front}</p>
          <p className="demo-card-back">{item.card.back}</p>
          <PrimaryButton onClick={() => dispatch({ type: 'advance' })}>Continue to grades</PrimaryButton>
        </div>
      );
    case 'review-rate':
      return (
        <div className="demo-screen" data-stage="review-rate">
          <h3 className="demo-screen-title">How well did you recall it?</h3>
          <div className="demo-grades">
            {GRADE_BUTTONS.map((grade) => (
              <button
                key={grade.rating}
                type="button"
                className="demo-btn demo-grade"
                onClick={() => dispatch({ type: 'rate', rating: grade.rating })}
              >
                {grade.label}
              </button>
            ))}
          </div>
        </div>
      );
    case 'schedule': {
      const ratingKey = String(state.rating ?? 3) as '1' | '2' | '3' | '4' | '5';
      const interval = item.scheduleDays[ratingKey] ?? item.scheduleDays['3'];
      return (
        <div className="demo-screen" data-stage="schedule">
          <h3 className="demo-screen-title">Next review</h3>
          <p>Next in {interval}.</p>
          <p className="demo-muted">Illustrative schedule, not your algorithm output.</p>
          <PrimaryButton onClick={() => dispatch({ type: 'advance' })}>Finish</PrimaryButton>
        </div>
      );
    }
    case 'complete':
      return (
        <div className="demo-screen" data-stage="complete">
          <h3 className="demo-screen-title">That’s the path</h3>
          <p>Library → read → remember → review. Restart to walk it again.</p>
          <button
            type="button"
            className="demo-btn"
            disabled
            aria-label="Continue is unavailable because the demo is finished. Use Restart to return to the library."
            title="Continue is unavailable because the demo is finished. Use Restart to return to the library."
          >
            Continue
          </button>
          <PrimaryButton onClick={() => dispatch({ type: 'restart' })}>Restart</PrimaryButton>
        </div>
      );
    case 'connect':
      return (
        <div className="demo-screen" data-stage="connect">
          <p>This stage is not on the primary path.</p>
          <PrimaryButton onClick={() => dispatch({ type: 'restart' })}>Back to library</PrimaryButton>
        </div>
      );
    default:
      return (
        <div className="demo-screen">
          <PrimaryButton onClick={() => dispatch({ type: 'restart' })}>Back to library</PrimaryButton>
        </div>
      );
  }
}

export function DemoChrome({
  shell,
  onToggle,
  onRestart,
  onBack,
}: {
  shell: DemoShell;
  onToggle: () => void;
  onRestart: () => void;
  onBack: () => void;
}) {
  return (
    <div className="demo-chrome-controls">
      <div className="demo-toggle" role="group" aria-label="Phone chrome">
        <button
          type="button"
          className="demo-btn"
          aria-pressed={shell === 'ios'}
          onClick={shell === 'ios' ? undefined : onToggle}
          disabled={shell === 'ios'}
          aria-label={shell === 'ios' ? 'iPhone chrome is already showing' : 'Show iPhone chrome'}
        >
          iPhone
        </button>
        <button
          type="button"
          className="demo-btn"
          aria-pressed={shell === 'android'}
          onClick={shell === 'android' ? undefined : onToggle}
          disabled={shell === 'android'}
          aria-label={shell === 'android' ? 'Android chrome is already showing' : 'Show Android chrome'}
        >
          Android
        </button>
      </div>
      <button type="button" className="demo-btn" onClick={onBack}>
        Back
      </button>
      <button type="button" className="demo-btn" onClick={onRestart}>
        Restart
      </button>
    </div>
  );
}

export function PhoneFrame({ shell, children }: { shell: DemoShell; children: ReactNode }) {
  return (
    <div className={`demo-phone demo-phone-${shell}`} data-shell={shell}>
      <div className="demo-status" aria-hidden="true">
        <span>9:41</span>
        <span className="demo-status-icons">{shell === 'ios' ? '●●● LTE' : 'LTE 4G'}</span>
      </div>
      <div className="demo-phone-body">{children}</div>
      {shell === 'ios' ? (
        <div className="demo-home-indicator" aria-hidden="true" />
      ) : (
        <div className="demo-android-nav" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
    </div>
  );
}
