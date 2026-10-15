## Purpose

Provides seamless navigation and article advancement within the RSS unread view, preventing active and newly read articles from prematurely disappearing and halting queue progression.

## ADDED Requirements

### Requirement: Stable unread article list retention during reading
The system SHALL retain the currently selected article and articles read during the active unread session in the article list while the user remains in unread view mode, preventing items from abruptly vanishing beneath the user upon selection.

#### Scenario: Selecting an unread article keeps it visible
- **WHEN** user is in unread view mode and clicks an article in the article list
- **THEN** the article is marked as read and displayed in the reader pane, while remaining visible in the list with read visual styling until the user leaves or explicitly refreshes the view

### Requirement: Forward advancement through unread articles
The system SHALL allow advancing through subsequent articles in the unread queue without snapping selection back to the first article in the feed.

#### Scenario: Advancing past the first unread article
- **WHEN** user finishes the first article and selects or navigates to the next article in the list
- **THEN** the selection successfully updates to the chosen article, reader content displays the chosen article, and selection does not snap back to the initial top article

#### Scenario: Keyboard navigation in unread view
- **WHEN** user uses keyboard shortcuts (such as next/previous article) in unread mode
- **THEN** the reader progresses sequentially down the list of articles without resetting to the top of the feed
