import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrivacyCenter } from "../PrivacyCenter";
import { getAllDisclosures } from "../../../lib/privacy/disclosureRegistry";
import {
  acknowledgeCloudAiDisclosure,
  resetCloudAiDisclosure,
} from "../../../lib/privacy/cloudAiDisclosure";

beforeEach(() => {
  localStorage.clear();
  resetCloudAiDisclosure();
});

describe("PrivacyCenter (Change C §4.1)", () => {
  it("renders every registry disclosure grouped by category", () => {
    render(<PrivacyCenter />);
    for (const d of getAllDisclosures()) {
      expect(screen.getByText(d.name)).toBeTruthy();
      expect(screen.getByText(d.description)).toBeTruthy();
    }
    expect(screen.getByTestId("privacy-center")).toBeTruthy();
  });

  it("reflects and resets the cloud-AI disclosure acknowledgment", () => {
    acknowledgeCloudAiDisclosure("byo-key");
    const { unmount } = render(<PrivacyCenter />);
    expect(
      screen.getByText(/Acknowledged for the "bring-your-own-key" provider class/)
    ).toBeTruthy();
    unmount();

    localStorage.clear();
    resetCloudAiDisclosure();
    render(<PrivacyCenter />);
    expect(screen.getByText(/Not shown yet/)).toBeTruthy();
  });

  it("marks non-deletable egress disclosures with a rationale note", () => {
    render(<PrivacyCenter />);
    // store_transactions and web_analytics are the only egress flows with
    // userDeletable=false; each must carry the rationale note.
    expect(
      screen.getAllByText(/cannot be deleted on request because it is required for accounting/)
    ).toHaveLength(2);
  });
});
