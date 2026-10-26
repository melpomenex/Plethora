import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { BookOpenText, Brain, DotsThree, Lightbulb, ListBullets, Question, Scales, Shapes, TextAlignLeft, Translate, TreeStructure } from '@phosphor-icons/react';
import { useI18n } from '../../lib/i18n';
import { CONTEXT_ACTIONS, actionBlockReason, type ActionId, type ActionParameters, type ActionTarget, type QuizQuestion } from '../../features/assistant/contextActions/model';
import type { TargetResolution } from '../../features/assistant/contextActions/targets';
import type { AssistantScope } from '../../lib/ai/assistant/scopes';

const ICONS = { BookOpenText, Brain, Lightbulb, ListBullets, Question, Scales, Shapes, TextAlignLeft, Translate, TreeStructure };
export const ACTION_CONTROL_CLASS = 'md-state min-h-10 [@media(pointer:coarse)]:min-h-12 rounded-lg px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50';
export function useTargetLabel() {
  const { t } = useI18n();
  return (target?: ActionTarget) => target ? [t(`assistant.actions.target.${target.labelKey}`), target.title, target.locator].filter(Boolean).join(' · ') : t('assistant.actions.noTarget');
}
export interface ContextActionProps {
  resolution: TargetResolution;
  scope: AssistantScope;
  providerReady: boolean;
  cardToolsReady?: boolean;
  busy: boolean;
  onRun: (id: ActionId, target: ActionTarget, parameters?: ActionParameters) => void;
}
function actionLabel(id: ActionId, target: ActionTarget | undefined, t: (key: string) => string) {
  return t(`assistant.actions.${id === 'summarize' && target?.kind === 'conversation' ? 'recap' : id}`);
}
export function ContextActionStrip({ resolution, scope, providerReady, cardToolsReady, busy, onRun, onMore, moreRef, expanded }: ContextActionProps & { onMore: () => void; moreRef: RefObject<HTMLButtonElement | null>; expanded: boolean }) {
  const { t } = useI18n();
  const labelTarget = useTargetLabel();
  const root = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(3);
  useLayoutEffect(() => {
    const measure = () => {
      const width = root.current?.clientWidth ?? 0;
      const items = Array.from(probe.current?.children ?? []) as HTMLElement[];
      if (!width || items.length < 4) return;
      const need = (count: number) => items.slice(0, count).reduce((n, el) => n + el.getBoundingClientRect().width, 0) + items[3].getBoundingClientRect().width + count * 4;
      setFit(need(3) <= width ? 3 : need(2) <= width ? 2 : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (root.current) observer.observe(root.current);
    if (probe.current) observer.observe(probe.current);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [t, resolution.target?.kind]);
  const primary = CONTEXT_ACTIONS.slice(0, 3);
  return <div ref={root} data-assistant-action-strip className="relative min-w-0">
    <div aria-hidden="true" inert className="pointer-events-none absolute inset-0 invisible overflow-hidden"><div ref={probe} className="flex w-max gap-1">
      {primary.map(a => <span key={a.id} className={`${ACTION_CONTROL_CLASS} inline-flex items-center gap-1.5 whitespace-nowrap`}><span className="w-4" />{actionLabel(a.id, resolution.target, t)}</span>)}
      <span className={`${ACTION_CONTROL_CLASS} inline-flex items-center gap-1.5 whitespace-nowrap`}><span className="w-5" />{t('assistant.actions.more')}</span>
    </div></div>
    <div className="flex min-w-0 items-center gap-1">
      {primary.slice(0, fit).map(a => {
        const Icon = ICONS[a.icon as keyof typeof ICONS];
        const name = actionLabel(a.id, resolution.target, t);
        return <button key={a.id} type="button" className={`${ACTION_CONTROL_CLASS} inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap text-on-surface-variant`} disabled={busy || Boolean(actionBlockReason(a, { ...resolution, scope, providerReady, cardToolsReady }))} aria-label={`${name} · ${labelTarget(resolution.target)}`} onClick={() => resolution.target && onRun(a.id, resolution.target)}><Icon size={16} className="shrink-0" aria-hidden="true" /><span>{name}</span></button>;
      })}
      <button ref={moreRef} type="button" className={`${ACTION_CONTROL_CLASS} inline-flex items-center justify-center gap-1.5 text-primary ${fit === 0 ? 'w-full' : ''}`} aria-haspopup="dialog" aria-expanded={expanded} onClick={onMore}><DotsThree size={20} aria-hidden="true" /><span>{t(`assistant.actions.${fit ? 'more' : 'title'}`)}</span></button>
    </div>
  </div>;
}
export function contextActionsMatch(query: string, t: (key: string) => string): boolean {
  return CONTEXT_ACTIONS.some(a => `${a.id} ${t(`assistant.actions.${a.id}`)} ${a.id === "summarize" ? t("assistant.actions.recap") : ""} ${t(`assistant.actions.group.${a.group}`)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
}
export function ContextActionMenu({ resolution, scope, providerReady, cardToolsReady, busy, onRun, onSelectTarget, onSetup, query = '' }: ContextActionProps & { onSelectTarget: (key: string) => void; onSetup: () => void; query?: string }) {
  const { t, locale } = useI18n();
  const labelTarget = useTargetLabel();
  const [translation, setTranslation] = useState<ActionTarget>();
  const [language, setLanguage] = useState<string>(locale);
  const visible = CONTEXT_ACTIONS.filter(a => `${a.id} ${actionLabel(a.id, resolution.target, t)} ${t(`assistant.actions.${a.id}`)} ${a.id === "summarize" ? t("assistant.actions.recap") : ""} ${t(`assistant.actions.group.${a.group}`)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const validTranslation = translation && resolution.target?.key === translation.key && resolution.targets.some(target => target.key === translation.key && target.owner === translation.owner);
  return <section data-assistant-actions-menu aria-label={t('assistant.actions.title')} className="min-w-0 p-2">
    <label className="flex min-h-12 flex-wrap items-center gap-2 text-sm font-medium">
      <span>{t('assistant.actions.use')}</span>
      <select aria-label={t('assistant.actions.use')} value={resolution.mismatch ? '' : resolution.target?.key ?? ''} onChange={e => onSelectTarget(e.target.value)} className="min-h-12 min-w-0 max-w-full flex-1 rounded-lg border border-border bg-surface-container-high px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        {(!resolution.target || resolution.mismatch) && <option value="">{t(`assistant.actions.${resolution.mismatch ? 'chooseTarget' : 'noTarget'}`)}</option>}
        {resolution.targets.map(target => <option key={target.key} value={target.key}>{labelTarget(target)}</option>)}
      </select>
    </label>
    {resolution.mismatch && <p role="status" className="py-2 text-sm text-on-surface-variant">{t('assistant.actions.chooseTarget')}</p>}
    {!providerReady && <button type="button" className={`${ACTION_CONTROL_CLASS} w-full text-primary underline`} onClick={onSetup}>{t('assistant.actions.noProvider')}</button>}
    {translation ? <div className="space-y-2 py-2">
      <label className="block text-sm">{t('assistant.actions.language')}
        <select aria-label={t('assistant.actions.language')} value={language} onChange={e => setLanguage(e.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-border bg-surface-container-high px-2">
          {['en','de','es','fr','ja','zh','ar','hi','it','ko','pt','ru'].map(code => <option key={code} value={code}>{new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code}</option>)}
        </select>
      </label>
      {!validTranslation && <p role="alert" className="text-sm text-on-surface-variant">{t('assistant.actions.targetChanged')}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className={ACTION_CONTROL_CLASS} onClick={() => setTranslation(undefined)}>{t('common.cancel')}</button><button type="button" className={`${ACTION_CONTROL_CLASS} text-primary`} disabled={!validTranslation || busy} onClick={() => validTranslation && onRun('translate', translation, { language })}>{t('assistant.actions.translate')}</button></div>
    </div> : ['understand', 'think', 'study'].map(group => {
      const actions = visible.filter(a => a.group === group);
      return actions.length ? <div key={group} className="pt-3">
        <h3 className="mb-1 text-xs font-medium text-on-surface-variant">{t(`assistant.actions.group.${group}`)}</h3>
        <div className="assistant-context-action-grid">
          {actions.map(a => {
            const target = a.wholeSource ? resolution.fullTarget : resolution.target;
            const reason = actionBlockReason(a, { ...resolution, scope, providerReady, cardToolsReady });
            const Icon = ICONS[a.icon as keyof typeof ICONS];
            const name = actionLabel(a.id, target, t);
            return <div key={a.id} className="min-w-0">
              <button type="button" disabled={busy || Boolean(reason)} className={`${ACTION_CONTROL_CLASS} flex w-full items-center gap-2 py-2 text-start`} aria-label={`${name} · ${labelTarget(target)}${a.outcome === 'cards' ? ` · ${t('assistant.actions.createsCards')}` : ''}`} onClick={() => { if (!target) return; if (a.parameter) setTranslation(target); else onRun(a.id, target); }}><Icon size={20} className="shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{name}</span></button>
              {(reason || a.outcome === 'cards') && <p className="px-2 pb-1 text-xs text-on-surface-variant">{t(`assistant.actions.${reason ?? 'createsCards'}`)}</p>}
            </div>;
          })}
        </div>
      </div> : null;
    })}
  </section>;
}
export function QuizControls({ quiz, retired, busy, onReveal, onNext, onRestart }: { quiz: QuizQuestion; retired: boolean; busy: boolean; onReveal: (part: 'hint' | 'answer') => void; onNext: () => void; onRestart: () => void }) {
  const { t } = useI18n();
  return <div className="mt-2 space-y-2">
    {quiz.hintRevealed && quiz.hint && <p className="text-sm text-on-surface-variant">{quiz.hint}</p>}
    {quiz.answerRevealed && <p className="text-sm text-on-surface">{quiz.answer}</p>}
    <div className="flex flex-wrap gap-1">
      {retired ? <button type="button" className={`${ACTION_CONTROL_CLASS} text-primary`} disabled={busy} onClick={onRestart}>{t('assistant.actions.restartQuiz')}</button> : <>
        {quiz.hint && !quiz.hintRevealed && <button type="button" className={ACTION_CONTROL_CLASS} onClick={() => onReveal('hint')}>{t('assistant.actions.hint')}</button>}
        {!quiz.answerRevealed && <button type="button" className={ACTION_CONTROL_CLASS} onClick={() => onReveal('answer')}>{t('assistant.actions.showAnswer')}</button>}
        <button type="button" className={`${ACTION_CONTROL_CLASS} text-primary`} disabled={busy} onClick={onNext}>{t('assistant.actions.nextQuestion')}</button>
      </>}
    </div>
  </div>;
}
