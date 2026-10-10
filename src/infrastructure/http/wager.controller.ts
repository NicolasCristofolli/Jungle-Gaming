import { BadRequestException, Body, Controller, Headers, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { number, z } from 'zod';
import {
  SubmitWagerTransactionUseCase,
  type SubmitWagerResult,
} from '../../application/submit-wager-transaction.use-case';
import { WagerTransactionKind, WagerTransactionStatus } from '../../domain/wager-transaction';

const SubmitWagerBody = z.object({
  providerId: z.string().min(1),
  externalTransactionId: z.string().min(1),
  playerId: z.string().uuid(),
  walletId: z.string().uuid(),
  roundId: z.string().min(1),
  gameId: z.string().min(1),
  kind: z.nativeEnum(WagerTransactionKind),   // só aceita os valores do enum
  money: z.object({ amount: z.string(), currency: z.string() }),
  referenceExternalTransactionId: z.string().optional(),
});

@Controller('wagering/transactions')
export class WagerController {
  constructor(private readonly submitWager: SubmitWagerTransactionUseCase) {}

  @Post()
  async submit(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,   // permite escolher o status da resposta
  ) {
    // o enunciado diz que o header é OBRIGATÓRIO
    if (!idempotencyKey) {
      throw new BadRequestException({ code: 'MISSING_IDEMPOTENCY_KEY' });
    }

    const input = SubmitWagerBody.parse(body);
    const result = await this.submitWager.execute({ ...input, idempotencyKey });

    res.status(statusFor(result));
    return result;
  }
}

// VOCÊ FAZ: escolhe o status HTTP de acordo com o resultado (tabela acima)
function statusFor(result: SubmitWagerResult): number {
    if (result.idempotentReplay) {
        return 200
    }
    if (result.status === WagerTransactionStatus.Rejected) {
        return 422
    }
    if (result.status === WagerTransactionStatus.PendingReference) {
        return 202
    }
    return 201

}