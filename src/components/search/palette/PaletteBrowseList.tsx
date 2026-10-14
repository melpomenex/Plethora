/**
 * Browse-mode catalogue list (Actions / Settings / Library empty-input views,
 * View all, and recent/saved searches). Rows are single-action options with
 * the same keyboard selection contract as search results.
 */

import { optionId } from "./PaletteResults";

export interface PaletteBrowseRow {
  id: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  group: string;
  activate: () => void | Promise<void>;
}

export interface PaletteBrowseListProps {
  rows: PaletteBrowseRow[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onActivate: (row: PaletteBrowseRow) => void;
  listboxId: string;
  emptyState?: React.ReactNode;
}

export function PaletteBrowseList({
  rows,
  selectedIndex,
  onSelect,
  onActivate,
  listboxId,
  emptyState,
}: PaletteBrowseListProps) {
  if (rows.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  return (
    <div
      className="ch-results"
      role="listbox"
      id={listboxId}
      aria-label="Command catalogue"
    >
      {rows.map((row, index) => {
        const prevGroup = index > 0 ? rows[index - 1]?.group : undefined;
        const showGroupHeader = row.group && row.group !== prevGroup;
        const isSelected = index === selectedIndex;
        return (
          <div key={row.id}>
            {showGroupHeader && (
              <div className="ch-group" role="presentation">
                {row.group}
              </div>
            )}
            <div
              id={optionId(listboxId, index)}
              role="option"
              aria-selected={isSelected}
              data-selected={isSelected || undefined}
              className={`ch-result${isSelected ? " ch-result--selected" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onSelect(index)}
              onClick={() => onActivate(row)}
            >
              {row.icon ? (
                <span className="ch-result-icon ch-result-icon--command" aria-hidden="true">
                  {row.icon}
                </span>
              ) : (
                <span className="ch-result-icon ch-result-icon--generic" aria-hidden="true">
                  {row.title[0]?.toUpperCase()}
                </span>
              )}
              <div className="ch-result-body">
                <p className="ch-result-title">
                  <span className="ch-result-title-text">{row.title}</span>
                </p>
                {row.description && (
                  <p className="ch-result-excerpt">{row.description}</p>
                )}
              </div>
              {row.shortcut && <kbd className="ch-kbd">{row.shortcut}</kbd>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
