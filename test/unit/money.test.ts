import { describe, it, expect } from "bun:test";
import { Money } from "../../src/domain/money";
import {
  InvalidMoneyError,
  CurrencyMismatchError,
} from "../../src/domain/errors";

describe("Money", () => {
  it('cria a partir de "25.00"', () => {
    const m = Money.from({ amount: "25.00", currency: "BRL" });
    expect(m.toString()).toBe("25.00");
  });

  it("rejeita texto vazio", () => {
    expect(() => Money.from({ amount: "", currency: "BRL" })).toThrow(
      InvalidMoneyError,
    );
  });

  it("rejeita 3 casas decimais", () => {
    expect(() => Money.from({ amount: "1.234", currency: "BRL" })).toThrow(
      InvalidMoneyError,
    );
  });
  it("rejeita moeda com 4 digitos", () => {
    expect(() => Money.from({ amount: "12.00", currency: "BRLA" })).toThrow(
      InvalidMoneyError,
    );
  });
  it("rejeita moeda com numero", () => {
    expect(() => Money.from({ amount: "12.00", currency: "123" })).toThrow(
      InvalidMoneyError,
    );
  });
  it("rejeita moeda minuscula", () => {
    expect(() => Money.from({ amount: "12.00", currency: "brl" })).toThrow(
      InvalidMoneyError,
    );
  });
  it("soma 0.10 + 0.20 = 0.30 sem erro de ponto flutuante", () => {
    const a = Money.from({ amount: "0.10", currency: "BRL" });
    const b = Money.from({ amount: "0.20", currency: "BRL" });

    const result = a.add(b);

    expect(result.toString()).toBe("0.30");
  });
  it("diminui 10.00 - 3.50 = 6.50 sem erro de ponto flutuante", () => {
    const a = Money.from({ amount: "10.00", currency: "BRL" });
    const b = Money.from({ amount: "3.50", currency: "BRL" });

    const result = a.subtract(b);
    expect(result.toString()).toBe("6.50");
  });
  it("soma 10.00 BRL + 20.00 USD, rejeita por conta da soma de duas moedas diferentes", () => {
    const a = Money.from({ amount: "10.00", currency: "BRL" });
    const b = Money.from({ amount: "20.00", currency: "USD" });

    expect(() => a.add(b)).toThrow(CurrencyMismatchError);
  });
  it("diminui 20.00 BRL - 10.00 USD, rejeita por conta da subtracao de duas moedas diferentes", () => {
    const a = Money.from({ amount: "20.00", currency: "BRL" });
    const b = Money.from({ amount: "10.00", currency: "USD" });

    expect(() => a.subtract(b)).toThrow(CurrencyMismatchError);
  });
  it("verifica se a e b continua sendo imutavel", () => {
    const a = Money.from({ amount: "10.00", currency: "BRL" });
    const b = Money.from({ amount: "3.50", currency: "BRL" });

    const result = a.add(b);
    expect(a.toString()).toBe("10.00");
    expect(b.toString()).toBe("3.50");
  });
  it("Verifica se dinheiro é 0", () => {
    const result = Money.zero("BRL").isZero();
    expect(result).toBe(true);
  });

  it("Rejeita a palavra banana como moeda", () => {
    expect(() => Money.zero("banana")).toThrow(InvalidMoneyError);
  });

  it("Comparar 10.00 BRL com 10.00 BRL", () => {
    const a = Money.from({ amount: "10.00", currency: "BRL" });
    const b = Money.from({ amount: "10.00", currency: "BRL" });

    const result = a.equals(b);
    expect(result).toBe(true);
  });

  it("Comparar 20.00 BRL com 10.00 BRL", () => {
    const a = Money.from({ amount: "20.00", currency: "BRL" });
    const b = Money.from({ amount: "10.00", currency: "BRL" });

    const result = a.equals(b);
    expect(result).toBe(false);
  });

  it("equals: 10.00 USD não é igual a 10.00 BRL", () => {
    const a = Money.from({ amount: "10.00", currency: "USD" });
    const b = Money.from({ amount: "10.00", currency: "BRL" });

    expect(a.equals(b)).toBe(false);
  });

  it("Devolver o JSON corretamente", () => {
    const a = Money.from({ amount: "25.00", currency: "USD" });

    const result = a.toJSON();
    expect(result).toEqual({ amount: "25.00", currency: "USD" });
  });

  it("Rejeita comparacao de moedas diferentes", () => {
    const a = Money.from({ amount: "20.00", currency: "USD" });
    const b = Money.from({ amount: "10.00", currency: "BRL" });

    expect(() => a.isLessThan(b)).toThrow(CurrencyMismatchError);
  });

  it("Confere se 10.00 é igual a 0", () => {
    const a = Money.from({ amount: "10.00", currency: "USD" });

    expect(a.isZero()).toBe(false);
  });
  it("Confere os valores sao maiores que 0", () => {
    const a = Money.from({ amount: "10.00", currency: "USD" });
    const b = Money.from({ amount: "0.00", currency: "USD" });

    expect(a.isPositive()).toBe(true);
    expect(b.isPositive()).toBe(false);
  });

  it("Confere os valores sao menores que 0", () => {
    const a = Money.from({ amount: "10.00", currency: "USD" }).negate();
    const b = Money.from({ amount: "10.00", currency: "USD" });

    expect(a.isNegative()).toBe(true);
    expect(b.isNegative()).toBe(false);
  });

  it("Confere se 5.00 < 10.00 é true e 10.00 < 5.00 é false", () => {
    const a = Money.from({ amount: "5.00", currency: "USD" });
    const b = Money.from({ amount: "10.00", currency: "USD" });

    expect(a.isLessThan(b)).toBe(true);
    expect(b.isLessThan(a)).toBe(false);
  });

  it("negate inverte o sinal e mantém a moeda", () => {
    const m = Money.from({ amount: "10.00", currency: "BRL" }).negate();

    expect(m.toString()).toBe("-10.00");
    expect(m.currency).toBe("BRL");
  });
});
