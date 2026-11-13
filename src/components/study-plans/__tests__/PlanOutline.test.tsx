import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { PlanOutline } from '../PlanOutline';
import type { StudyPlanVersionNode, PlanPrerequisite } from '../../../types/learningPaths';

describe('PlanOutline', () => {
  afterEach(() => {
    fireEvent.keyDown(document, { key: 'Escape' });
    cleanup();
  });

  const mockNodes: StudyPlanVersionNode[] = [
    {
      nodeId: 'n1',
      title: 'Topic 1: Arithmetic Circuits',
      summary: '',
      learningObjectives: ['Objective 1'],
      conceptId: null,
      conceptLabel: 'Circuits',
      position: 0,
      included: true,
      locked: false,
      userAdded: false,
      userModified: false,
      materialSupport: 'grounded',
      whyHere: null,
      sourceRefIds: [],
    },
    {
      nodeId: 'n2',
      title: 'Topic 2: R1CS Constraints',
      summary: '',
      learningObjectives: ['Objective 2'],
      conceptId: null,
      conceptLabel: 'R1CS',
      position: 1,
      included: true,
      locked: false,
      userAdded: false,
      userModified: false,
      materialSupport: 'grounded',
      whyHere: null,
      sourceRefIds: [],
    },
    {
      nodeId: 'n3_tombstone',
      title: 'Topic 3: Removed Topic',
      summary: '',
      learningObjectives: ['Objective 3'],
      conceptId: null,
      conceptLabel: 'Removed',
      position: -1,
      included: false,
      locked: false,
      userAdded: false,
      userModified: false,
      materialSupport: 'unsupported',
      whyHere: null,
      sourceRefIds: [],
    },
  ];

  // n1 is prerequisite to n2: n1 -> n2
  const mockPrereqs: PlanPrerequisite[] = [
    {
      prerequisiteNodeId: 'n1',
      dependentNodeId: 'n2',
      support: 'user',
      rationale: null,
      sourceRefIds: [],
    },
  ];

  it('renders ordered active topics and removed tombstones', () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();

    render(
      <PlanOutline
        nodes={mockNodes}
        prerequisites={mockPrereqs}
        selectedNodeId="n1"
        onSelectNode={onSelect}
        onChangeNodes={onChange}
      />
    );

    expect(screen.getByText('Topic 1: Arithmetic Circuits')).toBeInTheDocument();
    expect(screen.getByText('Topic 2: R1CS Constraints')).toBeInTheDocument();
    expect(screen.getByText('Topic 3: Removed Topic')).toBeInTheDocument();
  });

  it('disables moves that would place a dependent before its prerequisite', () => {
    const onChange = vi.fn();

    render(
      <PlanOutline
        nodes={mockNodes}
        prerequisites={mockPrereqs}
        selectedNodeId="n2"
        onSelectNode={vi.fn()}
        onChangeNodes={onChange}
      />
    );

    const dependentRow = screen.getByText('Topic 2: R1CS Constraints').closest('[role="listitem"]')!;
    fireEvent.contextMenu(dependentRow);

    const moveEarlier = screen.getByRole('menuitem', { name: 'Move earlier' });
    expect(moveEarlier).toBeDisabled();
    expect(moveEarlier).toHaveAttribute('title', expect.stringMatching(/prerequisites remain first/i));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens a topic menu without selecting it and starts a lesson only after choosing the action', () => {
    const onSelect = vi.fn();
    const onStartLesson = vi.fn();
    render(
      <PlanOutline
        nodes={mockNodes}
        prerequisites={mockPrereqs}
        selectedNodeId="n1"
        onSelectNode={onSelect}
        onChangeNodes={vi.fn()}
        onStartLesson={onStartLesson}
      />
    );

    const row = screen.getByText('Topic 1: Arithmetic Circuits').closest('[role="listitem"]')!;
    fireEvent.contextMenu(row, { clientX: 120, clientY: 80 });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onStartLesson).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Open topic' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Start lesson' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Start lesson' }));
    expect(onStartLesson).toHaveBeenCalledWith('n1');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(row);

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open topic' }));
    expect(onSelect).toHaveBeenCalledWith('n1');
  });

  it('routes Lock and Remove through the node update callback', () => {
    const onChangeNode = vi.fn();
    render(
      <PlanOutline
        nodes={mockNodes}
        prerequisites={mockPrereqs}
        selectedNodeId="n1"
        onSelectNode={vi.fn()}
        onChangeNodes={vi.fn()}
        onChangeNode={onChangeNode}
      />
    );

    const row = screen.getByText('Topic 1: Arithmetic Circuits').closest('[role="listitem"]')!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Lock' }));
    expect(onChangeNode).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'n1', locked: true, userModified: true }));

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from plan' }));
    expect(onChangeNode).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'n1', included: false, position: -1, userModified: true }));
  });

  it('omits editing actions in read-only plans and restores removed topics through the existing handler', () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();
    const { rerender } = render(
      <PlanOutline
        nodes={mockNodes}
        prerequisites={mockPrereqs}
        selectedNodeId="n1"
        onSelectNode={onSelect}
        onChangeNodes={onChange}
        onStartLesson={vi.fn()}
        isReadOnly
      />
    );

    const includedRow = screen.getByText('Topic 1: Arithmetic Circuits').closest('[role="listitem"]')!;
    fireEvent.contextMenu(includedRow);
    expect(screen.getByRole('menuitem', { name: 'Open topic' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Start lesson' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Lock' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Remove from plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Move later' })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    rerender(
      <PlanOutline
        nodes={mockNodes}
        prerequisites={mockPrereqs}
        selectedNodeId="n1"
        onSelectNode={onSelect}
        onChangeNodes={onChange}
      />
    );

    const removedTopic = screen.getByText('Topic 3: Removed Topic').parentElement!;
    fireEvent.contextMenu(removedTopic);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'n3_tombstone', included: true, position: 2 }),
    ]));
  });

  it('blocks moves that would displace a topic locked to its position', () => {
    const lockedNodes = mockNodes.map((node) => node.nodeId === 'n2' ? { ...node, locked: true } : node);
    render(
      <PlanOutline
        nodes={lockedNodes}
        prerequisites={[]}
        selectedNodeId="n1"
        onSelectNode={vi.fn()}
        onChangeNodes={vi.fn()}
      />
    );

    const firstRow = screen.getByText('Topic 1: Arithmetic Circuits').closest('[role="listitem"]')!;
    fireEvent.contextMenu(firstRow);
    const moveLater = screen.getByRole('menuitem', { name: 'Move later' });
    expect(moveLater).toBeDisabled();
    expect(moveLater).toHaveAttribute('title', expect.stringMatching(/locked to position 2/i));
  });

  it('restores removed tombstone topic to outline', () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();

    render(
      <PlanOutline
        nodes={mockNodes}
        prerequisites={mockPrereqs}
        selectedNodeId="n1"
        onSelectNode={onSelect}
        onChangeNodes={onChange}
      />
    );

    const restoreBtn = screen.getByRole('button', { name: /restore/i });
    fireEvent.click(restoreBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'n3_tombstone',
          included: true,
          position: 2,
        }),
      ])
    );
  });
});
