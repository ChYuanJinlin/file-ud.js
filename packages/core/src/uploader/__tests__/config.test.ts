import { afterEach, describe, expect, it, vi } from "vitest";

import Uploader, { defaultConfig } from "../index";

describe("Uploader config", () => {
  afterEach(() => {
    Uploader.setDefaultPlugins([]);
  });

  it("uses single-file mode by default", () => {
    expect(defaultConfig.multiple).toBe(false);
    expect("replace" in (defaultConfig as Record<string, unknown>)).toBe(false);
  });

  it("inherits global default plugins when initialized", () => {
    const plugin = {
      name: "default-test-plugin",
      priority: 10,
    };
    const uploader = Object.create(Uploader.prototype) as Uploader;

    Uploader.setDefaultPlugins([plugin as any]);
    (uploader as any).init();

    expect(uploader.getPlugin("default-test-plugin")).toBe(plugin);
  });

  it("ignores limit in single-file mode", () => {
    const uploader = Object.create(Uploader.prototype) as Uploader;

    Object.assign(uploader, {
      config: {
        limit: 0,
        multiple: false,
      },
      files: [{}],
    });

    const validation = (uploader as any).validateFile(
      { name: "logo.png", size: 1024 } as File,
      {} as any,
    );

    expect(validation.valid).toBe(true);
  });

  it("keeps limit checks strict in multi-file mode", () => {
    const uploader = Object.create(Uploader.prototype) as Uploader;

    Object.assign(uploader, {
      config: {
        limit: 1,
        multiple: true,
      },
      files: [{}],
    });

    const validation = (uploader as any).validateFile(
      { name: "logo.png", size: 1024 } as File,
      {} as any,
    );

    expect(validation.valid).toBe(false);
  });

  it("clearFiles resets file lists and aggregate transfer state", () => {
    const abort = vi.fn();
    const uploader = Object.create(Uploader.prototype) as Uploader;

    Object.assign(uploader, {
      files: [{ abort }],
      activeFiles: [{}],
      loading: true,
      totalPercent: 78,
      totalBytes: 1024,
      transferredBytes: 512,
      totalTransferredBytes: 512,
      transferredFormatSize: "512 B",
      totalFormatSize: "1 KB",
      triggerUpdate: vi.fn(),
    });

    Uploader.fileIndex = 3;
    Uploader.uploadFile = {} as any;
    Uploader.objectUrls = ["blob:test"];

    uploader.clearFiles();

    expect(abort).toHaveBeenCalledTimes(1);
    expect(uploader.files).toEqual([]);
    expect(uploader.activeFiles).toEqual([]);
    expect(uploader.loading).toBe(false);
    expect(uploader.totalPercent).toBe(0);
    expect(uploader.totalBytes).toBe(0);
    expect(uploader.transferredBytes).toBe(0);
    expect(uploader.totalTransferredBytes).toBe(0);
    expect(uploader.transferredFormatSize).toBe("0 B");
    expect(uploader.totalFormatSize).toBe("0 B");
    expect(Uploader.fileIndex).toBe(0);
    expect(Uploader.uploadFile).toBeNull();
    expect(Uploader.objectUrls).toEqual([]);
    expect(uploader.triggerUpdate).toHaveBeenCalledTimes(1);
  });
});
