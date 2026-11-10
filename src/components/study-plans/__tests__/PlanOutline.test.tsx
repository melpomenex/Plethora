import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { PlanOutline } from '../PlanOutline';
import type { StudyPlanVersionNode, PlanPrerequisite } from '../../../types/learningPaths';

describe('PlanOutline', () => {
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

  it('shows order_conflict warning when trying to move dependent before prerequisite', () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();

    render(
      <PlanOutline
        nodes={mockNodes}
        prerequisites={mockPrereqs}
        selectedNodeId="n2"
        onSelectNode={onSelect}
        onChangeNodes={onChange}
      />
    );

    // Try to move n2 (position 1) up/earlier (to position 0), but n1 is its prerequisite!
    const moveEarlierButtons = screen.getAllByTitle(/move earlier/i);
    // n2's move earlier button is at index 1
    fireEvent.click(moveEarlierButtons[1]);

    // Should display order conflict alert
    expect(screen.getByRole('alert')).toHaveTextContent(/prerequisites remain first/i);
    expect(onChange).not.toHaveBeenCalled();
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
