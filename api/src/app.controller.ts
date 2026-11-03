import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppService } from './app.service.js';
import { DB, type Db } from './db/db.module.js';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * `GET /api/health` — sonde de disponibilité pour Render.
   * Contrairement à `GET /api`, elle vérifie la dépendance critique : une base
   * injoignable renvoie 503 et déclenche le redéploiement/redémarrage Render.
   */
  @Get('health')
  async health(): Promise<{ status: 'ok' }> {
    try {
      await this.db.$client.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Base de données indisponible');
    }
  }
}
