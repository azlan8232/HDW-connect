import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DrivePanel } from "../components/hdw/DrivePanel";
import { createTransferFile } from "../lib/hdw/transfer-file";

const { createPackage } = vi.hoisted(() => ({ createPackage: vi.fn() }));
vi.mock("@/lib/hdw/store", () => ({ createTransferPackage: createPackage, exportBackup: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.google;
});

describe("Drive transfer without a passphrase", () => {
  it("uploads selected records and retrieves them for review without asking for a password", async () => {
    const contents = createTransferFile([{ id: "synthetic-1", name: "Synthetic patient" }], 6);
    createPackage.mockResolvedValue(contents);
    let login: ((response: { credential: string }) => void) | undefined;
    window.google = {
      accounts: {
        id: {
          initialize: (options) => {
            login = options.callback;
          },
          renderButton: () => {},
          disableAutoSelect: () => {},
        },
      },
    };
    const file = {
      id: "file-1",
      name: "hdw-transfer.hdwtransfer",
      createdTime: new Date().toISOString(),
      appProperties: { kind: "transfer" },
      webViewLink: "https://drive.google.com/file/d/file-1/view",
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("action=config")) return Response.json({ clientId: "test-client" });
      if (url.includes("action=session"))
        return Response.json({ email: "staff@gmail.com", administrator: false });
      if (url.includes("action=list")) return Response.json({ files: [file] });
      if (url.includes("action=upload")) {
        expect(JSON.parse(String(init?.body))).toEqual({ kind: "transfer", contents });
        return Response.json(file, { status: 201 });
      }
      if (url.includes("action=download")) return Response.json({ kind: "transfer", contents });
      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetchMock);
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
    const receive = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <DrivePanel selectedIds={["synthetic-1"]} onTransfer={receive} onBackup={() => {}} />,
    );
    await waitFor(() => expect(login).toBeDefined());
    expect(
      screen.getByRole("button", { name: "Confirm transfer to Google Drive (1)" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Receive from Google Drive" })).toBeDisabled();
    await act(async () => {
      login!({ credential: "google-token" });
    });
    expect(container.querySelector('input[type="password"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer to Google Drive (1)" }));
    await screen.findByText(/Patient transfer saved to Drive/);
    expect(
      screen.getByRole("link", { name: "Open uploaded file in Google Drive" }),
    ).toHaveAttribute("href", file.webViewLink);
    expect(createPackage).toHaveBeenCalledWith(["synthetic-1"]);
    fireEvent.click(screen.getByRole("button", { name: "Receive from Google Drive" }));
    await waitFor(() => expect(screen.queryByText("Working…")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Receive on this device" }));
    await waitFor(() => expect(receive).toHaveBeenCalledWith(contents));
    expect(prompt).not.toHaveBeenCalled();
  });
});

it("requires owner connection before transfer and posts the popup code only to the backend", async () => {
  let login: ((response: { credential: string }) => void) | undefined;
  let authorize: ((response: { code?: string; error?: string }) => void) | undefined;
  const popup = vi.fn();
  window.google = {
    accounts: {
      id: {
        initialize: (options) => {
          login = options.callback;
        },
        renderButton: () => {},
        disableAutoSelect: () => {},
      },
      oauth2: {
        initCodeClient: (options) => {
          authorize = options.callback;
          return { requestCode: popup };
        },
      },
    },
  };
  let connected = false;
  const network = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("action=config")) return Response.json({ clientId: "owner-client" });
    if (url.includes("action=session"))
      return Response.json({
        email: "admin@gmail.com",
        administrator: true,
        ownerMode: true,
        ownerConnected: connected,
        ownerSetupReady: true,
        ownerEmail: "wadhdw25.hkl@moh.gov.my",
      });
    if (url.includes("action=connect-owner")) {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer administrator-token",
        "X-HDW-Owner-Connect": "1",
      });
      expect(JSON.parse(String(init?.body))).toEqual({ code: "one-time-code" });
      connected = true;
      return Response.json({ connected: true });
    }
    if (url.includes("action=list")) return Response.json({ files: [] });
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("fetch", network);
  render(
    <DrivePanel selectedIds={["synthetic-1"]} onTransfer={async () => {}} onBackup={() => {}} />,
  );
  await waitFor(() => expect(login).toBeDefined());
  await act(async () => {
    login!({ credential: "administrator-token" });
  });
  expect(
    screen.getByRole("button", { name: "Confirm transfer to Google Drive (1)" }),
  ).toBeDisabled();
  expect(network.mock.calls.some(([url]) => url.includes("action=list"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Connect folder owner" }));
  expect(popup).toHaveBeenCalled();
  await act(async () => {
    authorize!({ code: "one-time-code" });
  });
  await screen.findByText(/Folder owner connected. You can now transfer/);
  expect(
    screen.getByRole("button", { name: "Confirm transfer to Google Drive (1)" }),
  ).toBeEnabled();
});
