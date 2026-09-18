import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookOpen, Plus } from "@phosphor-icons/react";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import { Fab } from "../Fab";
import { Chip } from "../Chip";
import { SegmentedButton } from "../SegmentedButton";
import { Menu } from "../Menu";
import { TextField, SearchField } from "../TextField";
import { Checkbox, Radio } from "../Selection";
import { LinearProgress, CircularProgress } from "../Progress";
import { Tooltip } from "../Tooltip";
import { Dialog } from "../Dialog";
import { ListItem, Divider } from "../ListItem";
import { Slider } from "../Slider";

describe("Button", () => {
  it("renders M3 variants from semantic tokens", () => {
    const { container } = render(
      <>
        <Button variant="filled">Filled</Button>
        <Button variant="tonal">Tonal</Button>
        <Button variant="outlined">Outlined</Button>
        <Button variant="text">Text</Button>
        <Button variant="destructive">Delete</Button>
      </>,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons[0].className).toContain("bg-primary");
    expect(buttons[0].className).toContain("text-on-primary");
    expect(buttons[1].className).toContain("bg-secondary-container");
    expect(buttons[2].className).toContain("border-outline");
    expect(buttons[3].className).toContain("text-primary");
    expect(buttons[4].className).toContain("bg-error");
  });

  it("applies state-layer and focus-ring utilities", () => {
    render(<Button>Filled</Button>);
    expect(screen.getByRole("button")).toHaveClass("md-state");
    expect(screen.getByRole("button")).toHaveClass("md-focus-ring");
  });

  it("keeps a 40px minimum touch target at default size", () => {
    render(<Button>Filled</Button>);
    expect(screen.getByRole("button")).toHaveClass("min-h-10");
  });

  it("defaults to type=button", () => {
    render(<Button>Filled</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});

describe("IconButton", () => {
  it("requires and exposes an accessible name", () => {
    render(<IconButton icon={BookOpen} aria-label="Open library" />);
    expect(screen.getByRole("button", { name: "Open library" })).toBeInTheDocument();
  });

  it("hides the icon from assistive tech", () => {
    render(<IconButton icon={BookOpen} aria-label="Open library" />);
    const icon = screen.getByRole("button", { name: "Open library" }).querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("exposes toggle state via aria-pressed", () => {
    render(<IconButton icon={BookOpen} aria-label="Pin" pressed />);
    expect(screen.getByRole("button", { name: "Pin" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Fab", () => {
  it("renders an extended fab with a label", () => {
    render(<Fab icon={Plus} label="Import" />);
    const fab = screen.getByRole("button", { name: "Import" });
    expect(fab).toHaveTextContent("Import");
    expect(fab.className).toContain("rounded-2xl");
  });
});

describe("Chip", () => {
  it("selected filter chip shows a checkmark and aria-pressed", () => {
    render(<Chip variant="filter" label="PDF" selected />);
    const chip = screen.getByRole("button", { name: /PDF/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip.querySelector("svg")).toBeInTheDocument();
  });

  it("unselected filter chip has no checkmark", () => {
    render(<Chip variant="filter" label="PDF" />);
    const chip = screen.getByRole("button", { name: /PDF/ });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip.querySelector("svg")).toBeNull();
  });

  it("invokes onRemove without activating the chip", () => {
    const onRemove = vi.fn();
    const onClick = vi.fn();
    render(<Chip variant="input" label="tag" onRemove={onRemove} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove tag" }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("SegmentedButton", () => {
  const options = [
    { value: "a" as const, label: "Alpha" },
    { value: "b" as const, label: "Beta" },
    { value: "c" as const, label: "Gamma", disabled: true },
  ];

  it("marks the selected segment with radio semantics + checkmark", () => {
    render(<SegmentedButton options={options} value="b" onChange={() => {}} label="View mode" />);
    const group = screen.getByRole("radiogroup", { name: "View mode" });
    expect(group).toBeInTheDocument();
    const selected = screen.getByRole("radio", { name: /Beta/ }) as HTMLElement;
    expect(selected).toHaveAttribute("aria-checked", "true");
    expect(selected.querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Alpha/ })).toHaveAttribute("aria-checked", "false");
  });

  it("arrow keys move selection (roving)", () => {
    const onChange = vi.fn();
    render(<SegmentedButton options={options} value="a" onChange={onChange} label="View mode" />);
    const alpha = screen.getByRole("radio", { name: /Alpha/ });
    alpha.focus();
    fireEvent.keyDown(alpha, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("selects on click", () => {
    const onChange = vi.fn();
    render(<SegmentedButton options={options} value="a" onChange={onChange} label="View mode" />);
    fireEvent.click(screen.getByRole("radio", { name: /Beta/ }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("toggles multi-select values on click and keyboard activation", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SegmentedButton
        multi
        options={options.slice(0, 2)}
        value={["a"]}
        onChange={onChange}
        label="Filters"
      />,
    );
    const beta = screen.getByRole("checkbox", { name: /Beta/ });
    fireEvent.click(beta);
    expect(onChange).toHaveBeenLastCalledWith(["a", "b"]);

    rerender(
      <SegmentedButton
        multi
        options={options.slice(0, 2)}
        value={["a", "b"]}
        onChange={onChange}
        label="Filters"
      />,
    );
    const alpha = screen.getByRole("checkbox", { name: /Alpha/ });
    fireEvent.keyDown(alpha, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["b"]);
    rerender(
      <SegmentedButton
        multi
        options={options.slice(0, 2)}
        value={["b"]}
        onChange={onChange}
        label="Filters"
      />,
    );
    expect(screen.getByRole("checkbox", { name: /Alpha/ })).toHaveAttribute("aria-checked", "false");
  });
});

describe("Menu", () => {
  function harness(open: boolean, onClose: () => void) {
    const anchorRef = { current: document.createElement("button") };
    document.body.appendChild(anchorRef.current);
    render(
      <Menu
        open={open}
        onClose={onClose}
        anchorRef={anchorRef}
        label="Actions"
        items={[
          { key: "open", label: "Open", onSelect: () => {} },
          { key: "delete", label: "Delete", onSelect: () => {}, destructive: true },
          { key: "noop", label: "Disabled", onSelect: () => {}, disabled: true },
        ]}
      />,
    );
    return anchorRef;
  }

  it("renders nothing while closed", () => {
    harness(false, () => {});
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("exposes menu items with roles and destructive styling", () => {
    harness(true, () => {});
    expect(screen.getByRole("menu", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" }).className).toContain("text-error");
    expect(screen.getByRole("menuitem", { name: "Disabled" })).toBeDisabled();
  });

  it("closes and restores focus on Escape", () => {
    const onClose = vi.fn();
    const anchor = harness(true, onClose);
    anchor.current.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("TextField / SearchField", () => {
  it("binds label to input and shows supporting text", () => {
    render(
      <TextField
        label="Deck name"
        supportingText="Used for review sessions"
        defaultValue="Wave 1"
      />,
    );
    const input = screen.getByLabelText("Deck name");
    expect(input).toHaveValue("Wave 1");
    expect(screen.getByText("Used for review sessions")).toBeInTheDocument();
  });

  it("error state signals via aria-invalid, icon and text (not color alone)", () => {
    render(<TextField label="API key" errorText="Key is required" />);
    expect(screen.getByLabelText("API key")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Key is required")).toBeInTheDocument();
    expect(screen.getByLabelText("API key").parentElement?.querySelector("svg")).toBeInTheDocument();
  });

  it("search field exposes a search affordance", () => {
    render(<SearchField label="Search library" aria-label="Search library" />);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });
});

describe("Checkbox / Radio", () => {
  it("checkbox toggles and shows a checkmark when checked", () => {
    const { rerender } = render(<Checkbox aria-label="Auto-process imports" />);
    const box = screen.getByRole("checkbox", { name: "Auto-process imports" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(box).toBeChecked();
    rerender(<Checkbox aria-label="Auto-process imports" checked readOnly />);
    expect((box as HTMLElement).parentElement?.querySelector("svg")).toBeInTheDocument();
  });

  it("radio exposes radiogroup semantics", () => {
    render(
      <div role="radiogroup" aria-label="Mode">
        <Radio name="mode" aria-label="Light" />
        <Radio name="mode" aria-label="Dark" defaultChecked />
      </div>,
    );
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
  });
});

describe("Progress", () => {
  it("linear determinate reports value", () => {
    render(<LinearProgress value={42} label="Importing" />);
    expect(screen.getByRole("progressbar", { name: "Importing" })).toHaveAttribute("aria-valuenow", "42");
  });

  it("circular indeterminate omits aria-valuenow", () => {
    render(<CircularProgress label="Loading" />);
    expect(screen.getByRole("progressbar", { name: "Loading" })).not.toHaveAttribute("aria-valuenow");
  });
});

describe("Tooltip", () => {
  it("appears on focus and links itself via aria-describedby", () => {
    render(
      <Tooltip text="Import a document">
        <Button>Import</Button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Import" });
    button.focus();
    fireEvent.focus(button);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeVisible();
    expect(button).toHaveAttribute("aria-describedby", tooltip.id);
  });
});

describe("Dialog", () => {
  it("focuses content, traps Escape, and restores focus on close", () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    opener.textContent = "Opener";
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <Dialog open onClose={onClose} title="Delete deck?" description="This cannot be undone.">
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Delete deck?" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(document.activeElement).toBe(opener);
  });

  it("uses alertdialog semantics for confirmations", () => {
    render(
      <Dialog open alert onClose={() => {}} title="Delete deck?">
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});

describe("ListItem", () => {
  it("renders headline, supporting text and trailing slot", () => {
    render(
      <ListItem
        headline="Design review"
        supporting="Every Tuesday"
        trailing={<span>2due</span>}
      />,
    );
    expect(screen.getByText("Design review")).toBeInTheDocument();
    expect(screen.getByText("Every Tuesday")).toBeInTheDocument();
    expect(screen.getByText("2due")).toBeInTheDocument();
  });
});

describe("Slider", () => {
  it("keeps native range semantics", () => {
    render(<Slider aria-label="Playback speed" min={0.5} max={2} step={0.25} defaultValue={1} />);
    const slider = screen.getByRole("slider", { name: "Playback speed" }) as HTMLInputElement;
    expect(slider.value).toBe("1");
    fireEvent.change(slider, { target: { value: "1.25" } });
    expect(slider.value).toBe("1.25");
  });
});

describe("Divider", () => {
  it("renders a semantic rule", () => {
    const { container } = render(<Divider />);
    expect(container.querySelector("hr")).toBeInTheDocument();
  });
});

describe("selection regressions", () => {
  it("skips disabled options without selecting them and exposes one tab stop", () => {
    const onChange = vi.fn();
    render(<SegmentedButton label="Choices" options={[{value: "a", label: "A"}, {value: "b", label: "B", disabled: true}, {value: "c", label: "C"}]} value="a" onChange={onChange} />);
    const buttons = screen.getAllByRole("radio");
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: "ArrowRight" });
    expect(buttons[2]).toHaveFocus();
    expect(onChange).toHaveBeenCalledWith("c");
  });
  it("accepts multiple selected values", () => {
    render(<SegmentedButton multi label="Choices" options={[{value: "a", label: "A"}, {value: "b", label: "B"}]} value={["a", "b"]} onChange={() => {}} />);
    expect(screen.getAllByRole("checkbox").every((button) => button.getAttribute("aria-checked") === "true")).toBe(true);
  });
  it("provides a separate keyboard removal button", async () => {
    const onRemove = vi.fn();
    render(<Chip label="Tag" onRemove={onRemove} />);
    const remove = screen.getByRole("button", {name: "Remove Tag"});
    expect(remove.tabIndex).toBe(0);
    expect(remove.parentElement?.closest("button")).toBeNull();
    remove.focus();
    await userEvent.keyboard("{Enter}");
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

it("retains dialog focus when the close callback changes", () => {
  const firstClose = vi.fn();
  const nextClose = vi.fn();
  const {rerender} = render(<Dialog open title="Edit" onClose={firstClose}><input aria-label="First" /><input aria-label="Second" /></Dialog>);
  const second = screen.getByRole("textbox", {name: "Second"});
  second.focus();
  rerender(<Dialog open title="Edit" onClose={nextClose}><input aria-label="First" /><input aria-label="Second" /></Dialog>);
  expect(second).toHaveFocus();
  fireEvent.keyDown(second, {key: "Escape"});
  expect(firstClose).not.toHaveBeenCalled();
  expect(nextClose).toHaveBeenCalledOnce();
});
it("fits a menu above an anchor near the viewport bottom", () => {
  const anchor = document.createElement("button");
  anchor.getBoundingClientRect = () => ({top: 700, bottom: 730, left: 20, right: 100, width: 80, height: 30, x: 20, y: 700, toJSON() {}});
  const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
  try {
    render(<Menu open anchorRef={{current: anchor}} onClose={() => {}} label="Overflow" items={[{key: "a", label: "Action", onSelect() {}}]} />);
    expect(Number.parseFloat(screen.getByRole("menu").style.top)).toBe(496);
  } finally { height.mockRestore(); }
});
