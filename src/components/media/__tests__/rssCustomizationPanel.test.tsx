import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RSSCustomizationPanel } from "../RSSCustomizationPanel";
const success = vi.fn();
vi.mock("../../common/Toast", () => ({ useToast: () => ({ success }) }));
vi.mock("../../../lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
beforeEach(() => success.mockClear());
describe("RSS settings draft", () => {
  it("loads values, preserves fractions, and waits for a save", async () => {
    let resolve!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    render(
      <RSSCustomizationPanel
        isOpen
        onClose={() => {}}
        currentPreferences={{ font_size: 24, line_height: 1.7 }}
        onSave={onSave}
      />
    );
    fireEvent.click(screen.getByText("rssCustomization.reader"));
    expect(screen.getByLabelText("Font Size")).toHaveValue("24");
    fireEvent.change(screen.getByLabelText("Line Height"), { target: { value: "1.9" } });
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave).toHaveBeenCalledWith({ line_height: 1.9 });
    expect(success).not.toHaveBeenCalled();
    resolve();
    await waitFor(() => expect(success).toHaveBeenCalledOnce());
  });
  it("retains failed changes and retries without false success", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    render(
      <RSSCustomizationPanel isOpen onClose={() => {}} currentPreferences={{}} onSave={onSave} />
    );
    fireEvent.click(screen.getByText("rssCustomization.reset"));
    fireEvent.click(screen.getByText("common.save"));
    await screen.findByRole("alert");
    expect(success).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => expect(success).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      keyword_include: "",
      author_blacklist: "",
      font_size: 16,
    });
  });
  it("discards unsaved edits on reopen and changing scope", () => {
    const props = {
      onSave: vi.fn().mockResolvedValue(undefined),
      onClose: () => {},
      currentPreferences: { font_size: 24 },
    };
    const { rerender } = render(<RSSCustomizationPanel {...props} isOpen feedId="a" />);
    fireEvent.click(screen.getByText("rssCustomization.reader"));
    fireEvent.change(screen.getByLabelText("Font Size"), { target: { value: "30" } });
    rerender(<RSSCustomizationPanel {...props} isOpen={false} feedId="a" />);
    rerender(<RSSCustomizationPanel {...props} isOpen feedId="b" />);
    expect(screen.getByLabelText("Font Size")).toHaveValue("24");
  });
  it("keeps card height and image size independent from excerpt length", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <RSSCustomizationPanel
        isOpen
        onClose={() => {}}
        currentPreferences={{ excerpt_length: 180 }}
        onSave={onSave}
      />
    );
    fireEvent.click(screen.getByText("rssCustomization.layout"));
    fireEvent.click(screen.getByText("Tall"));
    fireEvent.click(screen.getByText("Large"));
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave).toHaveBeenCalledWith({
      card_height: "tall",
      show_thumbnails: true,
      thumbnail_size: "large",
    });
  });
  it("uses supported preset actions", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <RSSCustomizationPanel isOpen onClose={() => {}} currentPreferences={{}} onSave={onSave} />
    );
    fireEvent.click(screen.getByText("rssCustomization.sorting"));
    fireEvent.click(screen.getByText("rssCustomization.preset.unread"));
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave).toHaveBeenCalledWith({ sort_by: "read_status", sort_order: "asc" });
  });
});
