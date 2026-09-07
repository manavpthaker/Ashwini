import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  client: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
}));

vi.mock("@/lib/health-context-import", () => ({ applyHealthContextImport: mocks.apply }));
vi.mock("pg", () => ({
  Client: class {
    connect = mocks.connect;
    end = mocks.end;
    constructor(settings: unknown) {
      mocks.client(settings);
    }
  },
}));

import { parseHealthContextImport } from "@/lib/health-context";
import { runAppleHealthClinicalImport } from "@/scripts/import-apple-health-clinical";

const PRIVATE_VALUE = "SYNTHETIC_PRIVATE_RESULT";
const observation = (id = "synthetic-id") => ({
  resourceType: "Observation",
  id,
  status: "final",
  effectiveDateTime: "2026-08-12T09:00:00Z",
  code: {
    coding: [{ system: "http://loinc.org", code: "synthetic", display: "Synthetic marker" }],
  },
  valueString: PRIVATE_VALUE,
});

let root: string;
let input: string;
let stdout: string;
let stderr: string;

async function fixture(name = "Observation-synthetic.json", resource: unknown = observation()) {
  await writeFile(join(input, name), JSON.stringify(resource), { mode: 0o600 });
}

function report() {
  return JSON.parse(stdout) as Record<string, unknown>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("ASHWINI_POSTGRES_CA", "");
  root = await mkdtemp(join(tmpdir(), "ashwini-synthetic-clinical-"));
  input = join(root, "clinical-records");
  await mkdir(input, { mode: 0o700 });
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  mocks.apply.mockResolvedValue({ sourcesInserted: 1, sourcesUnchanged: 0, entriesInserted: 1 });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("Apple Health clinical import CLI", () => {
  it("defaults to a read-only dry run and reports counts without clinical values", async () => {
    await fixture();
    const original = await readFile(join(input, "Observation-synthetic.json"), "utf8");
    await runAppleHealthClinicalImport([input]);
    expect(report()).toMatchObject({
      mode: "dry-run",
      resources: 1,
      sources: 1,
      entries: 1,
      resourceTypes: { Observation: 1 },
      batches: 1,
      persisted: false,
    });
    expect(stdout).not.toMatch(/SYNTHETIC_PRIVATE_RESULT|synthetic-id|Synthetic marker/);
    expect(stdout).not.toContain(input);
    expect(stderr).toBe("");
    expect(await readdir(root)).toEqual(["clinical-records"]);
    expect(await readdir(input)).toEqual(["Observation-synthetic.json"]);
    expect(await readFile(join(input, "Observation-synthetic.json"), "utf8")).toBe(original);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("prepares schema-valid JSON only inside a new owner-private directory", async () => {
    await fixture();
    const output = join(root, "prepared");
    await runAppleHealthClinicalImport([input, "--prepare", output]);
    expect((await stat(output)).mode & 0o777).toBe(0o700);
    expect((await readdir(output)).sort()).toEqual(["clinical-context-001.json", "report.json"]);
    for (const name of await readdir(output)) {
      expect((await stat(join(output, name))).mode & 0o777).toBe(0o600);
    }
    const payload = JSON.parse(await readFile(join(output, "clinical-context-001.json"), "utf8"));
    expect(parseHealthContextImport(payload)).toEqual(payload);
    expect(payload.sources[0].entries[0].statement).toContain(PRIVATE_VALUE);
    expect(JSON.parse(await readFile(join(output, "report.json"), "utf8"))).toMatchObject({
      entries: 1,
      persisted: false,
    });
    expect(report()).toMatchObject({ mode: "prepare", batches: 1, persisted: false });
    expect(stdout).not.toContain(PRIVATE_VALUE);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("produces deterministic preparations and refuses to overwrite an existing directory", async () => {
    await fixture();
    const first = join(root, "first");
    const second = join(root, "second");
    await runAppleHealthClinicalImport([input, "--prepare", first]);
    const original = await readFile(join(first, "clinical-context-001.json"), "utf8");
    await expect(runAppleHealthClinicalImport([input, "--prepare", first])).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await readFile(join(first, "clinical-context-001.json"), "utf8")).toBe(original);
    await runAppleHealthClinicalImport([input, "--prepare", second]);
    expect(await readFile(join(second, "clinical-context-001.json"), "utf8")).toBe(original);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(["", "[SENSITIVE]"])(
    "requires real connection configuration for --apply (%s)",
    async (url) => {
      await fixture();
      vi.stubEnv("DATABASE_URL", url);
      await expect(runAppleHealthClinicalImport([input, "--apply"])).rejects.toThrow(
        "DATABASE_URL is required",
      );
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.apply).not.toHaveBeenCalled();
      expect(await readdir(root)).toEqual(["clinical-records"]);
    },
  );

  it("requires verified TLS configuration before constructing a remote database client", async () => {
    await fixture();
    vi.stubEnv("DATABASE_URL", "postgres://synthetic:unused@database.example.test/test");
    await expect(runAppleHealthClinicalImport([input, "--apply"])).rejects.toThrow(
      "ASHWINI_POSTGRES_CA is required",
    );
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("applies through the existing idempotent importer and reports confirmed counts only", async () => {
    await fixture();
    vi.stubEnv("DATABASE_URL", "postgres://synthetic:unused@127.0.0.1/test");
    mocks.apply.mockResolvedValue({ sourcesInserted: 0, sourcesUnchanged: 1, entriesInserted: 0 });
    await runAppleHealthClinicalImport([input, "--apply"]);
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(parseHealthContextImport(mocks.apply.mock.calls[0]![1])).toMatchObject({ version: 1 });
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(report()).toMatchObject({
      mode: "apply",
      persisted: true,
      completedBatches: 1,
      sourcesInserted: 0,
      sourcesUnchanged: 1,
      entriesInserted: 0,
    });
    expect(stdout).not.toContain(PRIVATE_VALUE);
  });

  it("sanitizes database failures and closes the connection without claiming persistence", async () => {
    await fixture();
    vi.stubEnv("DATABASE_URL", "postgres://synthetic:unused@127.0.0.1/test");
    mocks.apply.mockRejectedValue(new Error(`Database error containing ${PRIVATE_VALUE}`));
    await expect(runAppleHealthClinicalImport([input, "--apply"])).rejects.toThrow(
      "Clinical import could not be confirmed",
    );
    expect(stderr).toContain("0 batches confirmed committed");
    expect(stderr).not.toContain(PRIVATE_VALUE);
    expect(stdout).toBe("");
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it.each([
    { args: [] },
    { args: ["relative/path"] },
    { args: ["/unused", "--unknown"] },
    { args: ["/unused", "--prepare", "relative"] },
  ])("rejects invalid CLI arguments before side effects: $args", async ({ args }) => {
    await expect(runAppleHealthClinicalImport(args)).rejects.toThrow("Usage:");
    expect(await readdir(root)).toEqual(["clinical-records"]);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("validates every resource before creating preparation output or connecting", async () => {
    await fixture();
    await writeFile(join(input, "Observation-z-invalid.json"), "{ invalid JSON");
    const output = join(root, "must-not-exist");
    await expect(runAppleHealthClinicalImport([input, "--prepare", output])).rejects.toThrow(
      "malformed JSON",
    );
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
    vi.stubEnv("DATABASE_URL", "postgres://synthetic:unused@127.0.0.1/test");
    await expect(runAppleHealthClinicalImport([input, "--apply"])).rejects.toThrow(
      "malformed JSON",
    );
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("rejects a symlink input directory before reading or writing", async () => {
    await fixture();
    const link = join(root, "input-link");
    await symlink(input, link, "dir");
    const output = join(root, "must-not-exist");
    await expect(runAppleHealthClinicalImport([link, "--prepare", output])).rejects.toThrow(
      "not a symlink",
    );
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("rejects recognized resource symlinks and resource-named directories", async () => {
    await fixture();
    const link = join(input, "Observation-link.json");
    await symlink(join(input, "Observation-synthetic.json"), link);
    const output = join(root, "must-not-exist");
    await expect(runAppleHealthClinicalImport([input, "--prepare", output])).rejects.toThrow(
      "bounded regular FHIR JSON files",
    );
    await rm(link);
    await mkdir(link);
    await expect(runAppleHealthClinicalImport([input, "--prepare", output])).rejects.toThrow(
      "bounded regular FHIR JSON files",
    );
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects oversized individual files before creating output", async () => {
    await writeFile(join(input, "Observation-large.json"), Buffer.alloc(1024 * 1024 + 1));
    const output = join(root, "must-not-exist");
    await expect(runAppleHealthClinicalImport([input, "--prepare", output])).rejects.toThrow(
      "bounded regular FHIR JSON files",
    );
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("rejects aggregate input over 16 MiB before creating output", async () => {
    const bounded = JSON.stringify(observation()).padEnd(1024 * 1024, " ");
    await Promise.all(
      Array.from({ length: 17 }, (_, index) =>
        writeFile(join(input, `Observation-${index}.json`), bounded),
      ),
    );
    const output = join(root, "must-not-exist");
    await expect(runAppleHealthClinicalImport([input, "--prepare", output])).rejects.toThrow(
      "exceeds 16 MiB",
    );
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("does not read unrecognized filenames, hidden files, nested files or their symlinks", async () => {
    await fixture();
    await writeFile(join(input, "Observation.json"), "invalid JSON must not be read");
    await writeFile(join(input, ".Observation-hidden.json"), "invalid JSON must not be read");
    await mkdir(join(input, "nested"));
    await writeFile(join(input, "nested", "Observation-nested.json"), "invalid JSON");
    await symlink(join(root, "missing-target"), join(input, "attachment.txt"));
    await runAppleHealthClinicalImport([input]);
    expect(report()).toMatchObject({ resources: 1, includedResources: 1, entries: 1 });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("rejects an input directory with no recognized FHIR files", async () => {
    await writeFile(join(input, "attachment.txt"), "not a clinical resource");
    const output = join(root, "must-not-exist");
    await expect(runAppleHealthClinicalImport([input, "--prepare", output])).rejects.toThrow(
      "No clinical FHIR files found",
    );
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
