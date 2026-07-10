import { afterEach, describe, expect, it, vi } from "vitest";

import Uploader, { defaultConfig } from "../index";
import Downloader, {
  defaultConfig as downloaderDefaultConfig,
} from "../../downloader";

describe("Uploader config", () => {
  afterEach(() => {
    Uploader.setDefaultPlugins([]);
    Uploader.baseConfig = {};
    Downloader.baseConfig = {};
  });

  it("uses single-file mode by default", () => {
    expect(defaultConfig.multiple).toBe(false);
    expect("replace" in (defaultConfig as Record<string, unknown>)).toBe(false);
  });

  it("merges uploader baseConfig after default config", () => {
    const baseAction = vi.fn();

    Uploader.baseConfig = {
      action: baseAction,
      multiple: true,
      accept: [".png"],
    };

    const merged = Uploader.mergeConfig({
      multiple: false,
    });

    expect(merged.action).toBe(baseAction);
    expect(merged.multiple).toBe(false);
    expect(merged.accept).toEqual([".png"]);
    expect(defaultConfig.action).toBe("");
  });

  it("lets uploader instance config override baseConfig", () => {
    const baseAction = vi.fn();
    const instanceAction = vi.fn();

    Uploader.baseConfig = {
      action: baseAction,
      multiple: true,
    };

    const merged = Uploader.mergeConfig({
      action: instanceAction,
    });

    expect(merged.action).toBe(instanceAction);
    expect(merged.multiple).toBe(true);
  });

  it("merges downloader baseConfig after default config", () => {
    const baseAction = vi.fn();

    Downloader.baseConfig = {
      action: baseAction,
      timeout: 12000,
    };

    const merged = Downloader.mergeConfig();

    expect(merged.action).toBe(baseAction);
    expect(merged.timeout).toBe(12000);
    expect(downloaderDefaultConfig.action).toBe("");
  });

  it("initializes shared maps when resetState runs on Object.create instances", () => {
    const uploader = Object.create(Uploader.prototype) as Uploader;
    const downloader = Object.create(Downloader.prototype) as Downloader;

    uploader.resetState();
    downloader.resetState();

    expect(uploader.lastLoadedMap).toBeInstanceOf(Map);
    expect(uploader.pluginSharedData).toBeInstanceOf(Map);
    expect(downloader.lastLoadedMap).toBeInstanceOf(Map);
    expect(downloader.pluginSharedData).toBeInstanceOf(Map);
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

  it("keeps only the latest selected file in single-file mode", () => {
    const oldFile = { fileId: "old", abort: vi.fn() };
    const nextFile = { fileId: "next", index: 99 };
    const uploader = Object.create(Uploader.prototype) as Uploader;

    Object.assign(uploader, {
      files: [oldFile],
      activeFiles: [oldFile],
      loading: true,
      totalPercent: 90,
      totalBytes: 1024,
      transferredBytes: 512,
      totalTransferredBytes: 512,
      transferredFormatSize: "512 B",
      totalFormatSize: "1 KB",
      triggerUpdate: vi.fn(),
    });

    Uploader.fileIndex = 5;
    Uploader.uploadFile = oldFile as any;

    (uploader as any).commitSelectedFile(nextFile, true);

    expect(oldFile.abort).toHaveBeenCalledTimes(1);
    expect(uploader.files).toEqual([nextFile]);
    expect(uploader.activeFiles).toEqual([nextFile]);
    expect(nextFile.index).toBe(0);
    expect(Uploader.uploadFile).toBe(nextFile);
  });

  it("appends selected files in multi-file mode", () => {
    const oldFile = { fileId: "old" };
    const nextFile = { fileId: "next", index: 5 };
    const uploader = Object.create(Uploader.prototype) as Uploader;

    Object.assign(uploader, {
      files: [oldFile],
      activeFiles: [oldFile],
    });

    (uploader as any).commitSelectedFile(nextFile, false);

    expect(uploader.files).toEqual([oldFile, nextFile]);
    expect(uploader.activeFiles).toEqual([oldFile, nextFile]);
    expect(Uploader.uploadFile).toBe(nextFile);
  });

  it("uses the last selected file when single-file mode receives multiple files", () => {
    const files = [
      { name: "first.png" },
      { name: "latest.png" },
    ];
    const uploader = Object.create(Uploader.prototype) as Uploader;

    const selectedFiles = (uploader as any).getFilesForCurrentMode(files, true);

    expect(selectedFiles).toEqual([{ name: "latest.png" }]);
  });

  it("syncs input attributes when config is updated", () => {
    const input = {
      multiple: true,
      accept: ".png",
    };
    const uploader = Object.create(Uploader.prototype) as Uploader;

    Object.assign(uploader, {
      config: {
        multiple: true,
        accept: [".png"],
      },
      inputHTML: input as HTMLInputElement,
    });

    uploader.updateConfig({
      multiple: false,
      accept: [".jpg"],
    });

    expect(input.multiple).toBe(false);
    expect(input.accept).toBe(".jpg");
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
