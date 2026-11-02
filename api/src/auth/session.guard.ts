import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * N'autorise la route que pour une session ouverte (`steamId` et `userId`).
 * Renvoie 401 sinon : le front redirige alors vers la page de connexion.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.session.steamId && Number.isInteger(request.session.userId)) {
      return true;
    }
    throw new UnauthorizedException('Session Steam requise');
  }
}
