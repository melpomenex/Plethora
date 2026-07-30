import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TabContent } from "../TabContent";

describe("TabContent", () => {
  it("preserves tab component state when switching active tabs", async () => {
    const user = userEvent.setup();

    function StatefulTab() {
      const [value, setValue] = useState("");
      return (
        <input
          aria-label="stateful-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }

    function StaticTab() {
      return <div>static tab</div>;
    }

    const tabs = [
      {
        id: "a",
        title: "A",
        icon: "A",
        type: "documents",
        content: StatefulTab,
        closable: true,
      },
      {
        id: "b",
        title: "B",
        icon: "B",
        type: "queue",
        content: StaticTab,
        closable: true,
      },
    ] as const;

    const { rerender } = render(
      <TabContent tabs={[...tabs]} activeTabId="a" />
    );

    const input = screen.getByLabelText("stateful-input");
    await user.type(input, "resume me");
    expect(screen.getByLabelText("stateful-input")).toHaveValue("resume me");

    rerender(<TabContent tabs={[...tabs]} activeTabId="b" />);
    rerender(<TabContent tabs={[...tabs]} activeTabId="a" />);

    expect(screen.getByLabelText("stateful-input")).toHaveValue("resume me");
  });

  it("re-renders a tab when its immutable data reference changes", () => {
    const renders = vi.fn();
    function DataTab({ value }: { value?: number }) {
      renders(value);
      return <div>{value}</div>;
    }

    const firstData = { value: 1 };
    const firstTab = {
      id: "data",
      title: "Data",
      icon: "D",
      type: "documents",
      content: DataTab,
      closable: true,
      data: firstData,
    } as const;
    const { rerender } = render(<TabContent tabs={[firstTab]} activeTabId="data" />);
    expect(renders).toHaveBeenCalledWith(1);

    rerender(
      <TabContent
        tabs={[{ ...firstTab, data: { value: 2 } }]}
        activeTabId="data"
      />,
    );

    expect(renders).toHaveBeenLastCalledWith(2);
  });
});
