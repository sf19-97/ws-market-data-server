import { Request, Response } from 'express';
import { MetadataService } from '../../services/metadataService.js';
import { ApiError, sanitizeSymbol } from '../../middleware/validation.js';

/**
 * Controller for metadata API endpoints
 */
export class MetadataController {
  constructor(private metadataService: MetadataService) {}

  /**
   * GET /api/metadata - Get all symbols or specific symbol metadata
   */
  async getMetadata(req: Request, res: Response): Promise<void> {
    const { symbol } = req.query;

    if (symbol) {
      const normalizedSymbol = sanitizeSymbol(symbol as string);
      const metadata = await this.metadataService.getSymbolMetadata(normalizedSymbol);

      if (!metadata) {
        throw new ApiError(404, 'Symbol not found', 'SYMBOL_NOT_FOUND');
      }

      res.json(metadata);
    } else {
      const data = await this.metadataService.getAllSymbols();
      res.json(data);
    }
  }

  /**
   * GET /api/metadata/:symbol - Get specific symbol metadata
   */
  async getSymbolMetadata(req: Request, res: Response): Promise<void> {
    const { symbol } = req.params;
    const normalizedSymbol = sanitizeSymbol(symbol);
    const metadata = await this.metadataService.getSymbolMetadata(normalizedSymbol);

    if (!metadata) {
      throw new ApiError(404, 'Symbol not found', 'SYMBOL_NOT_FOUND');
    }

    res.json(metadata);
  }
}
