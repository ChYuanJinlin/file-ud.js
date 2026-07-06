import { describe, expect, it, vi } from "vitest";
import ChunkManager from "..";

class TestChunkManager extends ChunkManager<any> {
  protected getTag(): string {
    return "TestChunkManager";
  }

  protected async computeFileIdentifier(): Promise<string> {
    return "test-file";
  }

  protected async doInit(): Promise<any> {
    return null;
  }

  protected async doChunkTransfer(): Promise<{ data: any; chunkSize: number }> {
    return { data: null, chunkSize: 0 };
  }

  protected async doMergeChunks(): Promise<any> {
    return null;
  }
}

describe("ChunkManager progress", () => {
  it("updates transfer global stats when chunk progress changes", () => {
    const updateGlobalStats = vi.fn();
    const triggerUpdate = vi.fn();
    const file: any = {
      percent: 0,
      proxy: null,
      transfer: {
        updateGlobalStats,
        triggerUpdate,
      },
      getFileSize: () => 100,
    };
    file.proxy = file;

    const manager = new TestChunkManager({ chunkSize: 25 }, file);
    manager.completedChunks = 2;
    manager.totalChunkSize = 50;

    manager.updateProgress();

    expect(file.percent).toBe(50);
    expect(updateGlobalStats).toHaveBeenCalledTimes(1);
    expect(triggerUpdate).toHaveBeenCalledTimes(1);
  });
});
