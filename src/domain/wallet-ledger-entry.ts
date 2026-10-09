import { Money } from './money';
import { InvalidLedgerEntryError } from './errors';
import { PROPERTY_DEPS_METADATA } from '@nestjs/common/constants.js';

// Direção do lançamento: dinheiro saindo (DEBIT) ou entrando (CREDIT)
export enum LedgerDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}

// Dados necessárops para criar um lançamento
export interface LedgerEntryProps  {
    id: string;
    walletId: string;
    transactionId: string;
    direction: LedgerDirection;
    money: Money;
    balanceBefore: Money;
    balanceAfter: Money;
    createdAt: Date;
}

export class WalletLedgerEntry {

    private constructor(
        public readonly id: string,
        public readonly walletId: string,         
        public readonly transactionId: string,    
        public readonly direction: LedgerDirection,
        public readonly money: Money,            
        public readonly balanceBefore: Money,    
        public readonly balanceAfter: Money,      
        public readonly createdAt: Date,          
    ){}

    // Cria um lançamento NOVO, validando as regras
    static create(props: LedgerEntryProps): WalletLedgerEntry {
        if (!props.money.isPositive()) {
        throw new InvalidLedgerEntryError(
            `O valor do lançamento deve ser maior que zero: ${props.money.toString()}`,
        );   
        }
        const entry = new WalletLedgerEntry(
            props.id,
            props.walletId,
            props.transactionId,
            props.direction,
            props.money,
            props.balanceBefore,
            props.balanceAfter,
            props.createdAt,
        );
        if (!entry.isBalanced()) {
            throw new InvalidLedgerEntryError(
            `A conta nao fecha: ${props.money.toString()}`,
        );   
        }
        return entry;
    }
    // Reconstrói um lançamento que JÁ ESTÁ no banco: não valida nada, só monta
    static rehydrate(props: LedgerEntryProps): WalletLedgerEntry {
        return new WalletLedgerEntry(
        props.id,
        props.walletId,
        props.transactionId,
        props.direction,
        props.money,
        props.balanceBefore,
        props.balanceAfter,
        props.createdAt,
        );
    }
    // A conta fecha? (antes ± valor === depois)
    isBalanced(): boolean {
        let expected: Money;

        if (this.direction === LedgerDirection.Credit){
            expected = this.balanceBefore.add(this.money);
        } else {
            expected = this.balanceBefore.subtract(this.money);
        }
        return expected.equals(this.balanceAfter);
    }
}
