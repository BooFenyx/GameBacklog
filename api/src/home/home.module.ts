import { Module } from '@nestjs/common';
import { HomeController } from './home.controller.js';
import { HomeService } from './home.service.js';

/**
 * Accueil calculé. Volontairement indépendant : `DbModule` est global et le
 * `SessionGuard` s'utilise par référence de classe. Importer `AuthModule`,
 * `SyncModule` ou `LibraryModule` créerait un cycle inutile.
 */
@Module({
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
