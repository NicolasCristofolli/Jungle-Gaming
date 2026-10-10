import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { DomainError } from '../../domain/errors';
import { ApplicationError } from '../../application/errors';

// código do erro → status HTTP (ver ARCHITECTURE.md)
const STATUS_BY_CODE: Record<string, number> = {
  INVALID_MONEY: 400,
  INVALID_TRANSACTION: 400,
  CURRENCY_MISMATCH: 400,
  WALLET_NOT_FOUND: 404,
  WALLET_ALREADY_EXISTS: 409,
  IDEMPOTENCY_CONFLICT: 409,
};

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (error instanceof ZodError) {
      return res.status(400).json({ code: 'INVALID_PAYLOAD', issues: error.issues });
    }
    if (error instanceof DomainError || error instanceof ApplicationError) {
      const status = STATUS_BY_CODE[error.code] ?? 422;
      return res.status(status).json({ code: error.code, message: error.message });
    }
    if (error instanceof HttpException) {
      return res.status(error.getStatus()).json(error.getResponse());
    }
    // qualquer outra coisa (banco fora do ar, timeout): falha transitória, pode reenviar
    console.error(error);
    return res.status(503).set('Retry-After', '5').json({ code: 'TEMPORARILY_UNAVAILABLE' });
  }
}