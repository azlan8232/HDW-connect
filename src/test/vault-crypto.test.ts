import { describe, expect, it } from "vitest";
import {
  createVault,
  parseVaultEnvelope,
  unlockVault,
} from "@/lib/hdw/vault-crypto";
import { createTransferFile, parseTransferFile } from "@/lib/hdw/transfer-file";

describe("encrypted local vault and transfer packages", () => {
  it("keeps record text out of the vault envelope and rejects a wrong passphrase", async () => {
    const marker = "SYNTHETIC-RECORD-PLAINTEXT-MARKER";
    const created = await createVault(
      "Clinician One",
      "a long local passphrase",
      { schema: 5, patients: [{ id: "patient-1", name: marker }], transferInvites: [] },
      5,
    );
    const serialized = JSON.stringify(created.envelope);

    expect(serialized).not.toContain(marker);
    expect(parseVaultEnvelope(serialized).format).toBe(2);
    await expect(
      unlockVault(created.envelope, "Clinician One", "incorrect passphrase"),
    ).rejects.toThrow("incorrect");
    await expect(
      unlockVault(created.envelope, "Clinician One", "a long local passphrase"),
    ).resolves.toMatchObject({
      records: { patients: [{ name: marker }] },
    });
  });

  it("creates an app-formatted transfer file without claiming confidentiality", () => {
    const marker = "SYNTHETIC-TRANSFER-PLAINTEXT-MARKER";
    const bundle = createTransferFile([{ id: "patient-2", name: marker }], 6, "2026-10-06T12:00:00.000Z");
    expect(bundle).toContain(marker);
    expect(bundle).toContain("HDW CONNECT record transfer");
    expect(parseTransferFile(bundle)).toMatchObject({
      schema: 6,
      createdAt: "2026-10-06T12:00:00.000Z",
      records: [{ id: "patient-2", name: marker }],
    });
    expect(() => parseTransferFile("not a transfer file")).toThrow("valid HDW CONNECT transfer file");
  });
});
