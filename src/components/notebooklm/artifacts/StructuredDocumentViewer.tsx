import { useMemo } from "react";
import { MindMapViewer, parseMindMapData } from "./MindMapViewer";

interface StructuredDataRow {
  [key: string]: string | number;
}

/**
 * Renders a structured NotebookLM artifact (mind-map or data-table) that was
 * imported into the library as a document. The structured JSON is carried in
 * `DocumentMetadata.structuredContent`; this component reuses the existing
 * MindMapViewer for mind-maps and renders data-table rows as a table, so an
 * imported artifact is not shown as raw JSON text.
 */
export function StructuredDocumentViewer({
  content,
  title,
}: {
  content: unknown;
  title?: string;
}) {
  const mindMapData = useMemo(() => parseMindMapData(content), [content]);
  const tableRows = useMemo<StructuredDataRow[]>(() => {
    if (!Array.isArray(content)) return [];
    return content.filter(
      (row): row is StructuredDataRow =>
        typeof row === "object" && row !== null && !Array.isArray(row)
    );
  }, [content]);

  if (mindMapData) {
    return <MindMapViewer data={mindMapData} title={title} />;
  }

  if (tableRows.length > 0) {
    const columns = Array.from(
      new Set(tableRows.flatMap((row) => Object.keys(row)))
    );
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="px-4 py-2.5 border-b border-border bg-card flex-shrink-0">
          <h3 className="text-sm font-medium text-foreground truncate" title={title}>
            {title || "Data Table"}
          </h3>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <table className="w-full border-collapse">
            <thead className="bg-muted sticky top-0">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col}
                    className="px-4 py-2 text-left text-sm font-medium text-foreground border-b border-border"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, i) => (
                <tr key={i} className="hover:bg-muted/50">
                  {columns.map((col) => (
                    <td
                      key={col}
                      className="px-4 py-2 text-sm text-foreground border-b border-border"
                    >
                      {String(row[col] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Structured content that fits neither shape: fall back to a readable dump.
  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-4 py-2.5 border-b border-border bg-card flex-shrink-0">
        <h3 className="text-sm font-medium text-foreground truncate" title={title}>
          {title || "Structured Artifact"}
        </h3>
      </div>
      <div className="flex-1 p-6 overflow-auto">
        <pre className="whitespace-pre-wrap text-sm text-foreground bg-muted p-4 rounded-lg">
          {typeof content === "string" ? content : JSON.stringify(content, null, 2)}
        </pre>
      </div>
    </div>
  );
}
