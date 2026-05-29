import ChunkManager from "../chunkManager";
import TransferFile from "../transfer/TransferFile";
import { ChunkOptions } from "../types";

export default class DownloadChunkManager extends ChunkManager {
  constructor(chunkOptions: ChunkOptions, file: TransferFile) {
    super(chunkOptions, file);
  }
}
