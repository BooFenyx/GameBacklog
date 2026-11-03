import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { LIMITE_LECTURE } from './limite-lecture.decorator.js';
import {
  ReadRateLimitService,
  type ReadRateLimitKind,
} from './read-rate-limit.service.js';

/**
 * Applique la limite de lecture de la route (`@LimiteLecture`). Le
 * `SessionGuard` doit passer avant : sans `steamId`, aucune fenêtre n'est
 * ouverte et le 401 reste la responsabilité du guard de session.
 */
@Injectable()
export class LectureRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: ReadRateLimitService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const kind = this.reflector.getAllAndOverride<ReadRateLimitKind>(
      LIMITE_LECTURE,
      [context.getHandler(), context.getClass()],
    );
    if (!kind) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const steamId = request.session.steamId;
    if (!steamId) return true;

    const decision = this.limiter.tryConsume(steamId, kind);
    if (!decision.allowed) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(decision.retryAfterMs / 1000),
      );
      http
        .getResponse<Response>()
        .setHeader('Retry-After', String(retryAfterSeconds));
      throw new HttpException(
        'Limite de requêtes atteinte : réessaie dans un instant.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
