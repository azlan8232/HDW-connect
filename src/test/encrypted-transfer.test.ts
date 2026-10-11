// @vitest-environment node
import { describe, expect, it } from "vitest";
import { encryptTransfer, decryptTransfer } from "../lib/hdw/encrypted-transfer";
import { createTransferFile } from "../lib/hdw/transfer-file";

describe("encrypted Drive transfers", () => {
  it("round trips records without exposing patient text and rejects wrong passwords or tampering", async () => {
    const plain = createTransferFile([{ id: "synthetic-1", name: "SYNTHETIC PATIENT MARKER" }], 6);
    const encrypted = await encryptTransfer(plain, "a strong transfer passphrase");
    expect(encrypted).not.toContain("SYNTHETIC PATIENT MARKER");
    expect(await decryptTransfer(encrypted, "a strong transfer passphrase")).toBe(plain);
    await expect(decryptTransfer(encrypted, "another transfer password")).rejects.toThrow(
      "passphrase",
    );
    const corrupted = JSON.parse(encrypted);
    corrupted.data = Buffer.alloc(32).toString("base64");
    await expect(
      decryptTransfer(JSON.stringify(corrupted), "a strong transfer passphrase"),
    ).rejects.toThrow();
  });
  it("rejects short passphrases and unsupported KDF settings", async () => {
    await expect(encryptTransfer(createTransferFile([], 6), "short")).rejects.toThrow(
      "12 characters",
    );
    await expect(
      decryptTransfer(
        JSON.stringify({ app: "HDW CONNECT encrypted transfer", format: 1, iterations: 1 }),
        "a strong transfer passphrase",
      ),
    ).rejects.toThrow();
  });
});
