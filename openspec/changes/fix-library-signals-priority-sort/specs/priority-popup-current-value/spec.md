## ADDED Requirements

### Requirement: Priority popup seeds from the document's actual current priority
The Alt+P priority popup SHALL open pre-populated with the target document's actual current priority value, including when that value is explicitly `0`, in every surface it is reachable from (Document view, Queue, and Documents library rows in Compact/List/Grid).

#### Scenario: Popup seeds with a non-zero explicit priority
- **WHEN** the user presses Alt+P on a document whose priority was previously explicitly set to a non-zero value
- **THEN** the popup SHALL open with that value pre-filled

#### Scenario: Popup seeds with an explicit zero priority
- **WHEN** the user presses Alt+P on a document whose priority was previously explicitly set to `0`
- **THEN** the popup SHALL open with `0` pre-filled, not the neutral default of `50`

#### Scenario: Popup seeds with the neutral default only for a genuinely untouched document
- **WHEN** the user presses Alt+P on a document whose priority has never been explicitly set by the user
- **THEN** the popup SHALL open with the neutral default value of `50`

#### Scenario: Consistent seeding across all reachable surfaces
- **WHEN** the user presses Alt+P from Document view, from Queue, or from a Documents library row
- **THEN** the popup SHALL seed from the same current-priority value in all three surfaces for the same document
