import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ComponentType } from "react";
import { Route } from "../routes/about";
import { applyTransfer, inspectTransferPackage } from "@/lib/hdw/store";

vi.mock("@/components/hdw/DrivePanel", () => ({
  DrivePanel: () => <div>Drive transfer controls</div>,
}));
vi.mock("@/lib/hdw/store", () => ({
  APP_VERSION: "test",
  useDB: () => ({
    patients: [{ id: "synthetic-1", name: "Synthetic patient", mrn: "TEST" }],
    storageError: null,
    currentUser: { name: "Test clinician", role: "clinician" },
    accounts: [],
  }),
  addClinicianAccount: vi.fn(),
  applyTransfer: vi.fn(),
  createTransferPackage: vi.fn(),
  exportBackup: vi.fn(),
  inspectTransferPackage: vi.fn(),
  previewEncryptedBackup: vi.fn(),
  removeClinicianAccount: vi.fn(),
  restoreEncryptedBackup: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("switches between Drive and manual transfer while retaining the selected patient records", () => {
  const About = Route.options.component as ComponentType;
  render(<About />);
  expect(screen.getByText("Drive transfer controls")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Confirm transfer and download" })).toBeNull();
  const patient = screen.getByRole("checkbox", { name: "Synthetic patient · TEST" });
  fireEvent.click(patient);
  fireEvent.click(screen.getByRole("radio", { name: "Manual transfer" }));
  expect(screen.queryByText("Drive transfer controls")).toBeNull();
  expect(screen.getByRole("button", { name: "Confirm transfer and download" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Receive from file" })).toBeEnabled();
  expect(patient).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "Google Drive" }));
  expect(screen.getByText("Drive transfer controls")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Receive from file" })).toBeEnabled();
  expect(patient).toBeChecked();
});

it("opens the manual receive picker, previews the file, and imports only after confirmation", async () => {
  const preview = {
    createdAt: new Date().toISOString(),
    schema: 6,
    records: [
      { id: "incoming-1", patient: { name: "Incoming patient", mrn: "INCOMING" }, conflict: false },
    ],
  };
  vi.mocked(inspectTransferPackage).mockResolvedValue(
    preview as Awaited<ReturnType<typeof inspectTransferPackage>>,
  );
  vi.mocked(applyTransfer).mockResolvedValue({ added: 1, replaced: 0 });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const About = Route.options.component as ComponentType;
  render(<About />);
  fireEvent.click(screen.getByRole("radio", { name: "Manual transfer" }));
  const input = screen.getByLabelText("Incoming transfer file") as HTMLInputElement;
  const picker = vi.spyOn(input, "click");
  fireEvent.click(screen.getByRole("button", { name: "Receive from file" }));
  expect(picker).toHaveBeenCalled();
  const file = new File(["synthetic-transfer"], "test.hdwtransfer");
  Object.defineProperty(file, "text", { value: async () => "synthetic-transfer" });
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText("Incoming patient · INCOMING");
  expect(inspectTransferPackage).toHaveBeenCalledWith("synthetic-transfer");
  expect(applyTransfer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and import" }));
  await waitFor(() => expect(applyTransfer).toHaveBeenCalledWith(preview, {}));
  expect(await screen.findByText(/Transfer applied: 1 added/)).toBeInTheDocument();
});
