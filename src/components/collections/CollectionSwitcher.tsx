import { useState, useRef, useEffect } from 'react';
import {
  Check,
  Download,
  Plus,
  Trash,
  Upload,
} from "@phosphor-icons/react";
import { useCollectionStore } from '../../stores/collectionStore';
import { DEFAULT_COLLECTION_ID } from '../../types/collection';
import { buildCollectionArchive } from '../../utils/collectionArchive';
import { invokeCommand, isTauri, openFilePicker } from '../../lib/tauri';
import { useToast } from '../common/Toast';
import { Menu, type MenuItemSpec } from "../md3";

export function CollectionSwitcher() {
  const collections = useCollectionStore((s) => s.collections);
  const activeCollectionId = useCollectionStore((s) => s.activeCollectionId);
  const dueCounts = useCollectionStore((s) => s.dueCounts);
  const switchCollection = useCollectionStore((s) => s.switchCollection);
  const createCollection = useCollectionStore((s) => s.createCollection);
  const deleteCollection = useCollectionStore((s) => s.deleteCollection);
  const refreshDueCounts = useCollectionStore((s) => s.refreshDueCounts);

  const [isOpen, setIsOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const active = collections.find((c) => c.id === activeCollectionId);

  useEffect(() => {
    refreshDueCounts();
  }, [refreshDueCounts]);

  useEffect(() => {
    if (showCreate && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showCreate]);

  const handleSwitch = async (id: string) => {
    await switchCollection(id);
    setIsOpen(false);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createCollection(newName.trim());
    setNewName('');
    setShowCreate(false);
    setIsOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (confirmDeleteId === id) {
      await deleteCollection(id);
      setConfirmDeleteId(null);
      setIsOpen(false);
    } else {
      setConfirmDeleteId(id);
    }
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { blob, filename } = await buildCollectionArchive({
        scope: 'current',
        activeCollectionId,
        collections,
      });
      if (isTauri()) {
        const [{ save }, { writeFile }] = await Promise.all([
          import('@tauri-apps/plugin-dialog'),
          import('@tauri-apps/plugin-fs'),
        ]);
        const savePath = await save({
          defaultPath: filename,
          filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
        });
        if (!savePath) { setExporting(false); return; }
        const buffer = await blob.arrayBuffer();
        await writeFile(savePath, new Uint8Array(buffer));
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast.success('Export complete', `Exported to ${filename}`);
      setIsOpen(false);
    } catch (err) {
      toast.error('Export failed', err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const files = await openFilePicker({
        multiple: false,
        filters: [{ name: 'Collection Archive', extensions: ['zip'] }],
      });
      if (!files || files.length === 0) { setImporting(false); return; }
      const filePath = (files[0] as string & { path?: string }).path || files[0];
      const result = await invokeCommand<string>('import_collection_archive_merge', { archivePath: filePath });
      await useCollectionStore.getState().loadCollections();
      await refreshDueCounts();
      toast.success('Import complete', result);
      setIsOpen(false);
    } catch (err) {
      toast.error('Import failed', err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex justify-center py-1 px-1 relative">
      <button
        ref={anchorRef}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-2 rounded transition-colors hover:bg-muted"
        title={active?.name || 'Collections'}
      >
        <span className="text-base">{active?.icon || '📁'}</span>
      </button>

      <Menu
        anchorRef={anchorRef}
        open={isOpen}
        onClose={() => { setIsOpen(false); setShowCreate(false); setConfirmDeleteId(null); }}
        label="Collections"
        align="start"
        items={[
          ...collections.map((c): MenuItemSpec => ({
            key: c.id,
            label: c.name,
            onSelect: () => handleSwitch(c.id),
            leading: <span>{c.icon || '📁'}</span>,
            trailing: c.id === activeCollectionId ? <Check className="h-3 w-3 text-primary" /> : (dueCounts[c.id] ?? 0) > 0 ? <span className="text-xs text-primary">{dueCounts[c.id]}</span> : undefined,
          })),
          ...collections.filter((c) => c.id !== DEFAULT_COLLECTION_ID).map((c): MenuItemSpec => ({
            key: `delete-${c.id}`,
            label: confirmDeleteId === c.id ? "Click again to confirm" : `Delete ${c.name}`,
            icon: Trash,
            destructive: true,
            keepOpen: true,
            onSelect: () => handleDelete(c.id),
          })),
          { key: "export", label: exporting ? "Exporting..." : "Export Collection", icon: Download, disabled: exporting || activeCollectionId === DEFAULT_COLLECTION_ID, onSelect: handleExport },
          { key: "import", label: importing ? "Importing..." : "Import Collection", icon: Upload, disabled: importing, onSelect: handleImport },
          { key: "new", label: "New Collection", icon: Plus, keepOpen: true, onSelect: () => { setShowCreate(true); setIsOpen(true); } },
        ]}
        footer={showCreate ? (
          <div className="border-t border-outline-variant p-2" onMouseDown={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') { setShowCreate(false); setNewName(''); }
                }}
                placeholder="Collection name..."
                className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-1 mt-1">
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  className="flex-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
                >
                  Create
                </button>
                <button
                  onClick={() => { setShowCreate(false); setNewName(''); }}
                  className="px-2 py-1 text-xs text-foreground hover:bg-muted rounded"
                >
                  Cancel
                </button>
              </div>
          </div>
        ) : undefined}
      />
    </div>
  );
}
