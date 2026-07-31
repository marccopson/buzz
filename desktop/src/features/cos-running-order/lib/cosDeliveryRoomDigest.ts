type JsonRecord = Record<string, unknown>;

function canonicalPythonJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    return JSON.stringify(value).replace(
      /[\u007f-\uffff]/g,
      (character) =>
        `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalPythonJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as JsonRecord).sort(
      ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
    );
    return `{${entries
      .map(
        ([key, item]) =>
          `${canonicalPythonJson(key)}:${canonicalPythonJson(item)}`,
      )
      .join(",")}}`;
  }
  throw new Error("Delivery Room evidence rejected: non-JSON envelope value");
}

export async function cosDeliveryRoomGenerationId(
  input: unknown,
): Promise<string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(
      "Delivery Room evidence rejected: envelope must be an object",
    );
  }
  const candidate = { ...(input as JsonRecord), generationId: "" };
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      "Delivery Room evidence rejected: cryptographic digest verification is unavailable",
    );
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalPythonJson(candidate)),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyCosDeliveryRoomGeneration(
  input: unknown,
): Promise<void> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(
      "Delivery Room evidence rejected: envelope must be an object",
    );
  }
  const expected = (input as JsonRecord).generationId;
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error("Delivery Room evidence rejected: generationId is invalid");
  }
  const actual = await cosDeliveryRoomGenerationId(input);
  if (actual !== expected) {
    throw new Error(
      "Delivery Room evidence rejected: generationId does not match the received content",
    );
  }
}
