WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1000)
INSERT INTO documents (id, collection_id, title, file_path, file_type, tags, content, date_added, date_modified, learning_item_count)
SELECT 'startup-doc-'||n, '00000000-0000-0000-0000-000000000001', 'Fixture '||n,
    '/fixture/'||n||'.html', 'html', '[]', '<p>Disposable startup fixture.</p>', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0 FROM seq;

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<5000)
INSERT INTO learning_items (id, collection_id, document_id, item_type, question, answer, due_date, date_created, date_modified, tags, image_asset_ids)
SELECT 'startup-item-'||n, '00000000-0000-0000-0000-000000000001', 'startup-doc-'||(((n-1)/5)+1),
    'flashcard', 'Fixture question', 'Fixture answer', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '[]', '[]' FROM seq;
